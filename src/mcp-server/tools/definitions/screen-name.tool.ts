/**
 * @fileoverview `sanctions_screen_name` — the 80% entry point. Screens a name
 * against all loaded watchlists (OFAC SDN + Consolidated, EU, UK, UN, India
 * UAPA, India FEO/NIA, UAE Local) at once, alias- and fuzzy-aware, and returns scored potential
 * matches with source provenance. This is decision support, NOT a compliance
 * determination: a hit is a candidate to verify against the official source, and
 * an empty result is never a clearance.
 * @module mcp-server/tools/definitions/screen-name.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getScreeningService } from '@/services/screening/screening-service.js';
import { SOURCE_CODE_ENUM, SOURCE_CODES, SOURCE_LABELS } from '@/services/screening/types.js';
import { SCREENING_CAVEAT } from './_shared.js';

const SOURCE_ENUM = z.enum(SOURCE_CODE_ENUM);

const ATTRIBUTE_SIGNAL_ENUM = z.enum(['match', 'mismatch', 'not_provided', 'not_on_record']);

const AttributeCheckSchema = z
  .object({
    dob: ATTRIBUTE_SIGNAL_ENUM.describe(
      'match = DOB agrees (corroborating) · mismatch = DOB conflicts (exculpatory — likely different person) · not_on_record = list entry has no DOB · not_provided = caller did not supply a DOB.',
    ),
    nationality: ATTRIBUTE_SIGNAL_ENUM.describe(
      'match = nationality agrees · mismatch = nationality conflicts · not_on_record = list entry has no nationality · not_provided = caller did not supply a nationality.',
    ),
    identifier: ATTRIBUTE_SIGNAL_ENUM.describe(
      'Best signal across all supplied identifiers. match = a passport/ID number exactly matches the list entry (near-decisive) · mismatch = the list entry carries identifiers but none match the supplied ones (exculpatory) · not_on_record = list entry has no identifiers · not_provided = caller supplied no identifiers.',
    ),
  })
  .describe(
    'Corroboration/exculpation signals for the attributes the caller supplied. Present only when at least one of dateOfBirth, nationality, or identifiers was provided. A mismatch on a field the list entry publishes is the strongest exculpatory signal — it means the listed person and the queried person are very likely different individuals.',
  );

const HitSchema = z
  .object({
    source: SOURCE_ENUM.describe('Which watchlist this candidate is on — its provenance.'),
    sourceLabel: z.string().describe('Human-readable name of the source list.'),
    sourceEntryId: z
      .string()
      .describe("The list's own entry ID — pass to sanctions_get_designation for the full record."),
    entityType: z
      .enum(['person', 'organization', 'vessel', 'aircraft', 'unknown'])
      .describe('Entity classification as published by the source.'),
    primaryName: z.string().describe('Primary published name of the designated entity.'),
    matchedName: z.string().describe('The specific name or alias string that matched the query.'),
    matchedNameType: z
      .enum(['primary', 'aka', 'fka', 'low-quality-aka'])
      .describe('Provenance of the matched name: primary, a.k.a., f.k.a., or a low-quality a.k.a.'),
    matchType: z
      .enum(['exact', 'strong', 'approximate'])
      .describe(
        'exact = normalized name equality; strong = all query tokens present; approximate = fuzzy/phonetic.',
      ),
    score: z
      .number()
      .optional()
      .describe(
        'Raw Jaro-Winkler similarity (0–1) for approximate hits only — a real measurement, not a confidence verdict. Absent for exact/strong hits.',
      ),
    queryTokenCoverage: z
      .object({
        covered: z
          .number()
          .int()
          .describe(
            "Query tokens individually matched by one of this candidate's tokens at the applied score floor.",
          ),
        total: z.number().int().describe('Total tokens in the normalized query.'),
      })
      .optional()
      .describe(
        'How much of the query this candidate explains, as a literal token count — a second real measurement, never folded into score. It is the tie-break applied after score, because one shared exact token pins several candidates at the same score. Absent for exact/strong hits.',
      ),
    program: z
      .string()
      .optional()
      .describe('Sanctioning program / regime, when published by the source.'),
    designationDate: z
      .string()
      .optional()
      .describe('Designation date as published, when available.'),
    attributeCheck: AttributeCheckSchema.optional(),
  })
  .describe('One potential match — a candidate to verify, never a determination.');

export const screenNameTool = tool('sanctions_screen_name', {
  title: 'sanctions-screening-mcp-server: screen name',
  description:
    'Screen a name (person, company, vessel, aircraft) against all loaded sanctions watchlists at once — OFAC SDN + Consolidated, EU, UK, UN, India UAPA, India FEO/NIA, and UAE Local — alias- and fuzzy-aware. Returns scored potential matches with the source list, sanctioning program, designation date, and the matched alias. Strict mode (default) matches exact-normalized then all-tokens-present; fuzzy mode (or auto when strict is empty) adds Jaro-Winkler and phonetic matching and labels hits approximate with a raw 0–1 similarity score plus the count of query tokens the candidate covers, which orders candidates that tie on score. Results are paged: totalAvailable and hasMore report matches beyond the returned page, and nextOffset retrieves them. This is a screening AID for a human/compliance review, NOT a compliance determination: a hit means "review this candidate against the official source," and an empty result never means "cleared."',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  auth: ['tool:sanctions:read'],
  input: z.object({
    name: z
      .string()
      .min(1)
      .describe('The name to screen (person, organization, vessel, or aircraft).'),
    entityType: z
      .enum(['any', 'person', 'organization', 'vessel', 'aircraft'])
      .default('any')
      .describe('Restrict to one entity class, or "any" (default) to screen across all.'),
    matchMode: z
      .enum(['strict', 'fuzzy'])
      .default('strict')
      .describe(
        'strict (default): exact-normalized then all-tokens-present. fuzzy: also scored Jaro-Winkler + phonetic. Strict auto-falls-back to fuzzy when it finds nothing.',
      ),
    minScore: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Score floor for fuzzy hits (0–1), applied uniformly to every fuzzy candidate regardless of how it was matched (Jaro-Winkler, token, or phonetic). No hit below this score is returned. Applies to fuzzy mode only; defaults to the server's configured floor.",
      ),
    customerRef: z
      .string()
      .optional()
      .describe(
        'Your internal customer identifier. When provided, hits that an analyst has already cleared for this customer via sanctions_clear_hit are automatically suppressed — the false-positive memory. The same Mohammed Al-Rashid will not re-queue every day once cleared.',
      ),
    dateOfBirth: z
      .string()
      .optional()
      .describe(
        'Date of birth to cross-check against the designation record — ISO 8601 (YYYY-MM-DD), year-month (YYYY-MM), or year only (YYYY). When provided, each hit gains an attributeCheck.dob signal: match corroborates the name hit; mismatch is exculpatory (the listed person and the queried person are very likely different individuals).',
      ),
    nationality: z
      .string()
      .optional()
      .describe(
        'Country of nationality or citizenship — country name, demonym (e.g. "Jordanian"), or ISO-2 code (e.g. "JO"). When provided, each hit gains an attributeCheck.nationality signal.',
      ),
    identifiers: z
      .array(
        z.object({
          value: z.string().min(1).describe('Passport number, national ID, or other document value.'),
          type: z
            .string()
            .optional()
            .describe('Document type (e.g. "Passport", "National ID"). Omit when unknown.'),
        }),
      )
      .optional()
      .describe(
        'Passport or national-ID numbers to cross-check. An exact match against a designation identifier is near-decisive; a mismatch where the list entry carries identifiers is strongly exculpatory.',
      ),
    sources: z
      .array(SOURCE_ENUM)
      .optional()
      .describe('Restrict to specific source lists. Omit to screen all loaded lists.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe('Maximum number of potential matches to return in one page.'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based index of the first potential match to return. Re-call with the returned nextOffset to page through every match when hasMore is true; an offset past the end returns an empty page, not an error.',
      ),
  }),
  output: z.object({
    hits: z
      .array(HitSchema)
      .describe(
        'Potential matches, ranked by match type, then score, then how much of the query each candidate explains.',
      ),
    caveat: z
      .string()
      .describe(
        'Decision-support caveat — this is a screening aid, not a compliance determination.',
      ),
  }),
  enrichment: {
    normalizedQuery: z.string().describe('The name as the server folded it for matching.'),
    matchModeUsed: z
      .string()
      .describe('The match mode actually applied (strict may auto-upgrade to fuzzy on empty).'),
    totalCount: z.number().describe('Number of potential matches returned in this page.'),
    totalAvailable: z
      .number()
      .describe(
        'Potential matches available across all pages, before limit and offset were applied.',
      ),
    totalAvailableBasis: z
      .enum(['exact', 'lower_bound'])
      .describe(
        'How to read totalAvailable: exact = the complete strict match set; lower_bound = a bounded scan produced it (every fuzzy pass, and any strict pass that hit the raw-row scan cap), so more may exist.',
      ),
    hasMore: z
      .boolean()
      .describe('True when potential matches remain beyond this page — re-call with nextOffset.'),
    nextOffset: z
      .number()
      .optional()
      .describe('The offset to request next. Present only when hasMore is true.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when no candidate matched — how to broaden, and what an empty result does NOT mean — or when the requested offset sits past the end of the result set.',
      ),
    clearedHitsCount: z
      .number()
      .int()
      .optional()
      .describe(
        'Number of hits suppressed because an analyst previously cleared them for this customer (via sanctions_clear_hit). Only present when customerRef was supplied.',
      ),
    listVersion: z
      .string()
      .optional()
      .describe(
        'ISO 8601 timestamp of the last complete sanctions list sync used to produce this result. Record alongside your decision for audit reproducibility.',
      ),
    matcherVersion: z
      .string()
      .describe(
        'Server version — a proxy for the matcher version. Record alongside listVersion so any decision can be re-derived in an audit.',
      ),
  },
  errors: [
    {
      reason: 'mirror_not_ready',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The sanctions mirror has never completed an initial sync.',
      retryable: true,
      recovery:
        'Run the mirror:init lifecycle script to load the sanctions lists, then retry; check sanctions_list_sources for readiness.',
    },
  ],

  async handler(input, ctx) {
    const svc = getScreeningService();
    if (!(await svc.sanctionsReady())) {
      throw ctx.fail('mirror_not_ready', 'The local sanctions mirror is not yet populated.', {
        ...ctx.recoveryFor('mirror_not_ready'),
      });
    }

    const sources = input.sources && input.sources.length > 0 ? input.sources : [...SOURCE_CODES];
    const result = await svc.screenName(
      {
        query: input.name,
        entityType: input.entityType,
        matchMode: input.matchMode,
        ...(input.minScore !== undefined ? { minScore: input.minScore } : {}),
        ...(input.customerRef ? { customerRef: input.customerRef } : {}),
        ...(input.dateOfBirth ? { dateOfBirth: input.dateOfBirth } : {}),
        ...(input.nationality ? { nationality: input.nationality } : {}),
        ...(input.identifiers?.length
          ? {
              identifiers: input.identifiers.map((i) => ({
                value: i.value,
                ...(i.type ? { type: i.type } : {}),
              })),
            }
          : {}),
        sources,
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );

    const hasMore = input.offset + result.hits.length < result.totalAvailable;
    ctx.enrich({
      normalizedQuery: result.normalizedQuery,
      matchModeUsed: result.modeUsed,
      totalAvailable: result.totalAvailable,
      totalAvailableBasis: result.totalAvailableBasis,
      hasMore,
      ...(hasMore ? { nextOffset: input.offset + result.hits.length } : {}),
      ...(result.clearedHitsCount !== undefined
        ? { clearedHitsCount: result.clearedHitsCount }
        : {}),
      ...(result.listVersion ? { listVersion: result.listVersion } : {}),
      matcherVersion: result.matcherVersion,
    });
    ctx.enrich.total(result.hits.length);
    // An empty page has two very different causes; conflating them would either
    // hide an out-of-range offset or read a paging artifact as "nothing is listed".
    if (result.totalAvailable === 0) {
      ctx.enrich.notice(
        `No potential match for "${input.name}" across the selected lists (mode: ${result.modeUsed}). ` +
          'This is NOT a clearance — the entity may be listed under a name variant the mirror does not index, ' +
          'or under a transliteration. Try matchMode:"fuzzy", a broader name, or verify directly against the official source.',
      );
    } else if (result.hits.length === 0) {
      ctx.enrich.notice(
        `Offset ${input.offset} is past the end of this result set — ${result.totalAvailable} potential match(es) are available. Re-request from offset 0 and page forward with nextOffset.`,
      );
    }

    return {
      hits: result.hits.map((h) => ({
        source: h.source,
        sourceLabel: SOURCE_LABELS[h.source],
        sourceEntryId: h.sourceEntryId,
        entityType: h.entityType,
        primaryName: h.primaryName,
        matchedName: h.matchedName,
        matchedNameType: h.matchedNameType,
        matchType: h.matchType,
        ...(h.score !== undefined ? { score: h.score } : {}),
        ...(h.queryTokenCoverage ? { queryTokenCoverage: h.queryTokenCoverage } : {}),
        ...(h.program ? { program: h.program } : {}),
        ...(h.designationDate ? { designationDate: h.designationDate } : {}),
        ...(h.attributeCheck ? { attributeCheck: h.attributeCheck } : {}),
      })),
      caveat: SCREENING_CAVEAT,
    };
  },

  format: (result) => {
    const lines: string[] = [];
    if (result.hits.length === 0) {
      lines.push('**No potential matches found.**');
    } else {
      lines.push(
        `**${result.hits.length} potential match(es)** — candidates to verify, not determinations:\n`,
      );
      for (const h of result.hits) {
        const scoreStr = h.score !== undefined ? ` · score ${h.score.toFixed(3)}` : '';
        const cov = h.queryTokenCoverage;
        const coverStr = cov ? ` · covers ${cov.covered}/${cov.total} query tokens` : '';
        lines.push(`### ${h.primaryName} — ${h.matchType}${scoreStr}${coverStr}`);
        lines.push(
          `**List:** ${h.sourceLabel} (\`${h.source}\`) | **Entry ID:** ${h.sourceEntryId} | **Type:** ${h.entityType}`,
        );
        lines.push(`**Matched on:** "${h.matchedName}" (${h.matchedNameType})`);
        if (h.program) lines.push(`**Program:** ${h.program}`);
        if (h.designationDate) lines.push(`**Designated:** ${h.designationDate}`);
        if (h.attributeCheck) {
          const ac = h.attributeCheck;
          const fmt = (label: string, sig: string) => {
            const icon =
              sig === 'match' ? '✓' : sig === 'mismatch' ? '✗' : '–';
            return `${icon} ${label}: ${sig}`;
          };
          lines.push(
            `**Attribute check:** ${fmt('DOB', ac.dob)} · ${fmt('Nationality', ac.nationality)} · ${fmt('Identifier', ac.identifier)}`,
          );
        }
        lines.push('');
      }
    }
    lines.push(`> ${result.caveat}`);
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
