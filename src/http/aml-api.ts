import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getScreeningService } from '@/services/screening/screening-service.js';
import type { AttributeCheck } from '@/services/screening/types.js';
import { SOURCE_LABELS, type SourceCode } from '@/services/screening/types.js';

const PORT = Number(process.env.AML_API_PORT ?? 3011);
const HOST = process.env.AML_API_HOST ?? '127.0.0.1';
const API_KEY = process.env.AML_API_KEY;

const SOURCE_CODES: SourceCode[] = [
  'ofac_sdn',
  'ofac_consolidated',
  'eu',
  'uk',
  'un',
  'india_uapa',
  'india_watchlist',
  'uae_local',
];

interface ScreenPersonRequest {
  name: string;
  /** ISO 8601 date of birth (YYYY-MM-DD), year-month (YYYY-MM), or year only (YYYY). */
  dateOfBirth?: string;
  /** Country name, demonym ("Jordanian"), or ISO-2 code ("JO"). */
  nationality?: string;
  /**
   * Passport number shorthand — equivalent to passing
   * `identifiers: [{ type: "Passport", value: "..." }]`.
   * An exact match against the designation record scores 100 immediately.
   */
  passportNumber?: string;
  /**
   * National ID number shorthand — equivalent to passing
   * `identifiers: [{ type: "National ID", value: "..." }]`.
   */
  nationalId?: string;
  /**
   * Additional document numbers when you have more than one identifier
   * or a non-standard document type.
   */
  identifiers?: Array<{ type?: string; value: string }>;
  /**
   * Opaque customer identifier. When provided, hits previously cleared by an
   * analyst via `sanctions_clear_hit` are suppressed from results.
   */
  customerRef?: string;
  /** 'strict' (default) or 'fuzzy'. Strict does NOT auto-fall back to fuzzy. */
  matchMode?: 'strict' | 'fuzzy';
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Compute a backward-compatible match score (0–100) from attributeCheck signals.
 * Keeps the same scale the calling app already uses for decision thresholds while
 * using the improved per-attribute checks instead of the old manual comparison.
 *
 * Scale:
 *   identifier match                    → 100 (near-decisive — passport/ID exact match)
 *   name (exact/strong) + DOB + country → 100
 *   name (exact/strong) + DOB           →  80
 *   name (exact/strong) + country       →  60
 *   name match only                     →  40
 *   approximate name only               →  20
 *   no attributes supplied              →  40 / 20 based on match type (same as name-only)
 */
function computeMatchScore(
  matchType: string,
  attributeCheck: AttributeCheck | undefined,
): number {
  if (attributeCheck?.identifier === 'match') return 100;
  const nameStrong = matchType === 'exact' || matchType === 'strong';
  const dobMatch = attributeCheck?.dob === 'match';
  const nationalityMatch = attributeCheck?.nationality === 'match';
  if (nameStrong && dobMatch && nationalityMatch) return 100;
  if (nameStrong && dobMatch) return 80;
  if (nameStrong && nationalityMatch) return 60;
  if (nameStrong) return 40;
  return 20; // approximate
}

function apiKeyValid(req: IncomingMessage, key: string): boolean {
  const fromXApiKey = headerValue(req.headers['x-api-key']) ?? '';
  const authHeader = headerValue(req.headers['authorization']) ?? '';
  const fromBearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  return (fromXApiKey || fromBearer) === key;
}

async function screenPerson(input: ScreenPersonRequest) {
  const svc = getScreeningService();

  if (!(await svc.sanctionsReady())) {
    throw new Error('Sanctions mirror is not ready');
  }

  // Merge shorthand fields (passportNumber, nationalId) with the identifiers
  // array so callers can use whichever form is most convenient.
  const identifiers: Array<{ type: string; value: string }> = [
    ...(input.passportNumber ? [{ type: 'Passport', value: input.passportNumber }] : []),
    ...(input.nationalId ? [{ type: 'National ID', value: input.nationalId }] : []),
    ...(input.identifiers ?? []).map((id) => ({ type: id.type ?? 'ID', value: id.value })),
  ];

  const matchMode = input.matchMode ?? 'strict';
  
  const result = await svc.screenName(
    {
      query: input.name,
      entityType: 'person',
      matchMode,
      // Production REST must not auto-upgrade empty strict → fuzzy: a near-miss
      // spelling (e.g. "Malya" vs "Mallya") otherwise floods with unranked OFAC
      // token noise. Callers who want fuzzy pass matchMode: "fuzzy" explicitly.
      autoFallback: false,
      sources: SOURCE_CODES,
      limit: 100,
      offset: 0,
      ...(input.dateOfBirth ? { dateOfBirth: input.dateOfBirth } : {}),
      ...(input.nationality ? { nationality: input.nationality } : {}),
      ...(identifiers.length ? { identifiers } : {}),
      ...(input.customerRef ? { customerRef: input.customerRef } : {}),
    },
    {} as never,
  );

  const matches = result.hits.map((hit) => {
    const matchScore = computeMatchScore(hit.matchType, hit.attributeCheck);
    return {
      source: SOURCE_LABELS[hit.source],
      sourceCode: hit.source,
      sourceEntryId: hit.sourceEntryId,
      matchedName: hit.matchedName,
      primaryName: hit.primaryName,
      matchType: hit.matchType,
      // matchScore: 0–100, same scale as before — use this for decision thresholds.
      // Now computed from attributeCheck signals rather than manual comparison.
      matchScore,
      ...(hit.score !== undefined ? { fuzzyScore: hit.score } : {}),
      ...(hit.designationDate ? { designationDate: hit.designationDate } : {}),
      ...(hit.program ? { program: hit.program } : {}),
      // attributeCheck is present when dateOfBirth / nationality / identifiers
      // were supplied. Signals: match | mismatch | not_on_record | not_provided.
      // mismatch on a field the list entry publishes = likely a different person.
      ...(hit.attributeCheck ? { attributeCheck: hit.attributeCheck } : {}),
    };
  });

  const overallMatchScore =
    matches.length === 0 ? 0 : Math.max(...matches.map((m) => m.matchScore));

  return {
    status: matches.length > 0 ? 'potential_match' : 'no_match',
    matchScore: overallMatchScore,
    // Audit trail: record alongside every decision for compliance reproducibility.
    listVersion: result.listVersion,
    matcherVersion: result.matcherVersion,
    ...(result.clearedHitsCount !== undefined
      ? { clearedHitsCount: result.clearedHitsCount }
      : {}),
    matches,
  };
}

/**
 * Path only (no query string). Deploy / Compose healthchecks hit GET /healthz
 * on this port (3011), not the MCP server on 3010.
 */
function requestPath(url: string | undefined): string {
  if (!url) return '/';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

export function startAmlApi(): void {
  if (!API_KEY) {
    console.warn(
      'AML_API_KEY is not set; POST /api/aml/screen-person is unauthenticated (backward-compatible mode)',
    );
  }

  const server = createServer(async (req, res) => {
    try {
      const path = requestPath(req.url);

      // Liveness only — no API key. Mirror readiness is reported but does not
      // fail the check so deploy succeeds before mirror:init has run.
      if (req.method === 'GET' && (path === '/healthz' || path === '/health')) {
        let mirrorReady = false;
        try {
          mirrorReady = await getScreeningService().sanctionsReady();
        } catch {
          mirrorReady = false;
        }
        return json(res, 200, {
          status: 'ok',
          service: 'aml-api',
          mirrorReady,
        });
      }

      if (req.method === 'POST' && path === '/api/aml/screen-person') {
        if (API_KEY && !apiKeyValid(req, API_KEY)) {
          return json(res, 401, { error: 'Unauthorized' });
        }

        const body = await readBody(req);
        let input: ScreenPersonRequest;
        try {
          input = JSON.parse(body.toString('utf8')) as ScreenPersonRequest;
        } catch {
          return json(res, 400, { error: 'Invalid JSON request body' });
        }

        if (!input.name || typeof input.name !== 'string') {
          return json(res, 400, { error: 'name is required' });
        }

        return json(res, 200, await screenPerson(input));
      }

      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      console.error('AML API error:', error);
      return json(res, 500, {
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`AML API listening at http://${HOST}:${PORT}`);
  });
}
