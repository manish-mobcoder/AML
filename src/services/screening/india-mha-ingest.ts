/**
 * @fileoverview India UAPA ingester — fetches the MHA Banned Organizations
 * page at mha.gov.in, discovers the current PDF links, downloads each PDF,
 * and parses the numbered-list entries into NormalizedDesignation records.
 *
 * Data flows directly from the official MHA source; no third-party data
 * intermediary is involved. Two PDFs are published on that page:
 *  - List of Terrorist Organisations (UAPA 1st Schedule)
 *  - List of Unlawful Associations (UAPA Section 3)
 * Both are parsed. The unlawful-associations PDF uses sub-items `(i)`, `(ii)`
 * etc. for entries that cover multiple distinct organisations — each sub-item
 * becomes its own designation so individual names remain searchable.
 * @module services/screening/india-mha-ingest
 */

import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import { fetchWithTimeout, requestContextService, withRetry } from '@cyanheads/mcp-ts-core/utils';
import { isUsableName } from '@/services/screening/ingest-validation.js';
import type {
  DeferredDesignationFields,
  SanctionsIngester,
} from '@/services/screening/sanctions-ingest.js';
import { createHarvestState } from '@/services/screening/sanctions-ingest.js';
import type { NameRecord, NormalizedDesignation } from '@/services/screening/types.js';

const MHA_BANNED_ORGS_PAGE =
  'https://www.mha.gov.in/en/divisionofmha/counter-terrorism-and-counter-radicalization-division/Banned-Organizations';
const MHA_BASE_URL = 'https://www.mha.gov.in';
const SOURCE = 'india_uapa' as const;
const HEADERS_TIMEOUT_MS = 60_000;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Boilerplate phrases that appear in the PDFs but are not part of the name.
const BOILERPLATE = [
  /,?\s+and all its manifestations(\s+and front organ[is]ations?)?\b/gi,
  /,?\s+all its formations and front organ[is]ations?\b/gi,
  /,?\s+and front organ[is]ations?\b/gi,
  /,?\s+and all its formations\b/gi,
  /,?\s+and its political wing.*$/gi,
  /,?\s+and its armed wing.*$/gi,
  /,?\s+also called.*$/gi,
  /,?\s+namely[-–]\s*$/gi,
];

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function fetchBytes(url: string, signal: AbortSignal): Promise<Buffer> {
  const reqCtx = requestContextService.createRequestContext({ operation: 'harvest:india_uapa' });
  return withRetry(
    async () => {
      const res = await fetchWithTimeout(url, HEADERS_TIMEOUT_MS, reqCtx, {
        signal,
        headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' },
        redirect: 'follow',
      });
      if (!res.ok) {
        throw serviceUnavailable(`india_uapa: ${url} returned HTTP ${res.status}`);
      }
      return Buffer.from(await res.arrayBuffer());
    },
    { operation: 'harvest:india_uapa', baseDelayMs: 2000, signal },
  );
}

/**
 * Fetch the MHA Banned Organizations page and return the absolute URLs of all
 * PDF files linked under `/sites/default/files/`. Deduplicates by URL.
 */
async function fetchMhaPdfUrls(signal: AbortSignal): Promise<string[]> {
  const buf = await fetchBytes(MHA_BANNED_ORGS_PAGE, signal);
  const html = buf.toString('utf-8');
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of html.matchAll(/href="(\/sites\/default\/files\/[^"]+\.pdf)"/gi)) {
    const path = match[1];
    if (!path) continue;
    const full = `${MHA_BASE_URL}${path}`;
    if (!seen.has(full)) {
      seen.add(full);
      urls.push(full);
    }
  }
  if (urls.length === 0) {
    throw serviceUnavailable(
      'india_uapa: no PDF links found on MHA Banned Organizations page — the page structure may have changed',
    );
  }
  return urls;
}

// ─── PDF text extraction ──────────────────────────────────────────────────────

async function extractPdfText(buf: Buffer): Promise<string> {
  // Dynamic import — keeps the pdf-parse bundle out of the startup path.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  return result.text;
}

// ─── Text parsing ─────────────────────────────────────────────────────────────

/** Strip PDF-page headers / column-header lines from extracted text. */
function stripHeaders(text: string): string {
  return text
    .split('\n')
    .filter(
      (line) =>
        !/^\s*(S\.|Sl\.|Name of (Terrorist|Unlawful)|LIST\s+OF|SECTION\s+\d|SCHEDULE|UNLAWFUL ACTIVITIES|under sub-section|\*+\s*$)/i.test(
          line,
        ),
    )
    .join('\n');
}

/** Remove boilerplate trailing phrases that are not part of the entity name. */
function cleanName(raw: string): string {
  let s = raw;
  for (const pat of BOILERPLATE) {
    s = s.replace(pat, '');
  }
  return s
    .replace(/[.\s,;]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Extract abbreviations written as `(ABC)` within a name string and return
 * them as additional alias candidates. Parenthetical phrases that are
 * descriptive rather than abbreviations (contain spaces, are long) are skipped.
 */
function extractAbbreviations(name: string): string[] {
  const abbrevs: string[] = [];
  for (const match of name.matchAll(/\(([A-Z][A-Z0-9\s\-]{0,10})\)/g)) {
    const cand = match[1]?.trim();
    if (cand && !cand.includes(' ')) abbrevs.push(cand);
  }
  return abbrevs;
}

/**
 * Build name records from a raw text fragment: split on `/` to get the primary
 * and alias candidates, clean each, add any abbreviations as extra aliases.
 */
function buildNameRecords(raw: string): NameRecord[] {
  const parts = raw
    .split('/')
    .map((p) => cleanName(p))
    .filter((p) => isUsableName(p));

  if (parts.length === 0) return [];

  const seen = new Set<string>();
  const records: NameRecord[] = [];

  const addIfNew = (name: string, nameType: NameRecord['nameType']) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    records.push({ name, nameType });
  };

  const [primary, ...rest] = parts;
  if (!primary) return [];
  addIfNew(primary, 'primary');
  for (const a of extractAbbreviations(primary)) addIfNew(a, 'aka');
  for (const alias of rest) {
    addIfNew(alias, 'aka');
    for (const a of extractAbbreviations(alias)) addIfNew(a, 'aka');
  }
  return records;
}

/**
 * Collect numbered top-level entries from the PDF text. Each entry starts with
 * `\d+.` at the beginning of a (possibly indented) line; continuation lines
 * (indented, not starting a new number) are joined back to the entry.
 */
function collectNumberedEntries(text: string): string[] {
  const clean = stripHeaders(text);
  const entries: string[] = [];
  let current: string | null = null;

  for (const line of clean.split('\n')) {
    const trimmed = line.trimEnd();
    const topMatch = trimmed.match(/^\s{0,4}\d+\.\s+(.*)/);
    if (topMatch) {
      if (current !== null) entries.push(current.trim());
      current = topMatch[1] ?? '';
    } else if (current !== null) {
      const inner = trimmed.trim();
      if (inner) current += ' ' + inner;
    }
  }
  if (current !== null) entries.push(current.trim());
  return entries.filter(Boolean);
}

/**
 * Split a numbered entry that contains Roman-numeral sub-items `(i)`, `(ii)`
 * etc. into the parent phrase and the individual sub-item texts.
 * Returns `null` when no sub-items are detected (the entry is a plain listing).
 */
function splitSubItems(entry: string): { parent: string; subItems: string[] } | null {
  // Match Roman numeral sub-items: (i), (ii), (iii), (iv), (v), (vi), (vii)
  const subItemPattern = /\(\s*(i{1,3}|iv|vi{0,3}|ix|x)\s*\)/gi;
  const splitPoints: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = subItemPattern.exec(entry)) !== null) {
    splitPoints.push(m.index);
  }
  if (splitPoints.length < 2) return null;

  const parent = cleanName(entry.slice(0, splitPoints[0]).replace(/,?\s*namely[-–]?\s*$/, ''));
  const subItems: string[] = [];
  for (let i = 0; i < splitPoints.length; i++) {
    const start = splitPoints[i]!;
    const end = splitPoints[i + 1] ?? entry.length;
    // Strip the `(i)` label itself
    const raw = entry.slice(start, end).replace(/^\(\s*[ivxlcdm]+\s*\)\s*/i, '').trim();
    subItems.push(raw);
  }
  return { parent, subItems };
}

/**
 * Build a single `NormalizedDesignation` from a name fragment, or null when
 * the fragment produces no usable name.
 */
function buildDesignation(
  raw: string,
  idKey: string,
  program: string,
): NormalizedDesignation | null {
  const names = buildNameRecords(raw);
  if (names.length === 0) return null;
  const primaryName = names[0]!.name;
  return {
    id: `${SOURCE}:${idKey}`,
    source: SOURCE,
    sourceEntryId: idKey,
    entityType: 'organization',
    primaryName,
    program,
    payload: {
      aliases: names,
      addresses: [],
      datesOfBirth: [],
      identifiers: [],
      nationalities: [],
    },
  };
}

/** Parse a single PDF's text into NormalizedDesignation records. */
function parseMhaPdf(text: string, program: 'UAPA-TERRORIST' | 'UAPA-UNLAWFUL'): NormalizedDesignation[] {
  const entries = collectNumberedEntries(text);
  const results: NormalizedDesignation[] = [];
  const prefix = program === 'UAPA-TERRORIST' ? 'mha-t' : 'mha-u';

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const entryNum = i + 1;

    const split = splitSubItems(entry);
    if (split) {
      // Parent designation
      const parent = buildDesignation(split.parent, `${prefix}-${entryNum}`, program);
      if (parent) results.push(parent);

      // One designation per sub-item
      for (let j = 0; j < split.subItems.length; j++) {
        const sub = buildDesignation(
          split.subItems[j]!,
          `${prefix}-${entryNum}-${j + 1}`,
          program,
        );
        if (sub) results.push(sub);
      }
    } else {
      const d = buildDesignation(entry, `${prefix}-${entryNum}`, program);
      if (d) results.push(d);
    }
  }
  return results;
}

// ─── Ingester factory ─────────────────────────────────────────────────────────

/**
 * Determine whether a PDF URL is likely the "Terrorist Organisations" list or
 * the "Unlawful Associations" list, based on keywords in the filename.
 */
function classifyPdfUrl(url: string): 'UAPA-TERRORIST' | 'UAPA-UNLAWFUL' | null {
  const lower = url.toLowerCase();
  if (lower.includes('terrorist') || lower.includes('list4') || lower.includes('listterror')) {
    return 'UAPA-TERRORIST';
  }
  if (lower.includes('unlawful') || lower.includes('listunlawful')) {
    return 'UAPA-UNLAWFUL';
  }
  return null;
}

/** India UAPA (MHA) — fetches official PDFs from mha.gov.in directly. */
export function buildIndiaMhaIngester(): SanctionsIngester {
  let state = createHarvestState();
  let accepted = 0;

  return {
    source: SOURCE,
    url: () => MHA_BANNED_ORGS_PAGE,
    deferredFields: (): DeferredDesignationFields => state.deferredFields,
    report: () => ({ source: SOURCE, accepted, rejected: state.rejections }),

    async *harvest(signal: AbortSignal) {
      state = createHarvestState();
      accepted = 0;

      const pdfUrls = await fetchMhaPdfUrls(signal);

      for (const url of pdfUrls) {
        const program = classifyPdfUrl(url);
        if (!program) continue; // skip unrecognised PDFs (certificates, logos etc.)

        const buf = await fetchBytes(url, signal);
        const text = await extractPdfText(buf);
        const designations = parseMhaPdf(text, program);

        for (const d of designations) {
          if (!d.primaryName || !isUsableName(d.primaryName)) {
            state.rejections.unusableName += 1;
            continue;
          }
          accepted += 1;
          yield d;
        }
      }
    },
  };
}
