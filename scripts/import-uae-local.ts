/**
 * @fileoverview One-shot importer: reads the official UAE EOCN Local Terrorist
 * List PDF and overwrites the `UAE_LOCAL_RECORDS` array in `uae-local-data.ts`.
 *
 * Usage:
 *   bun run scripts/import-uae-local.ts <path-to-pdf>
 *
 * Run this whenever EOCN publishes an updated list. Commit the regenerated
 * `uae-local-data.ts`; the next `bun run mirror:refresh` picks up the changes.
 *
 * PDF column layout (tab-separated, as extracted by pdfjs):
 *
 * Individuals (19 columns):
 *   0  serial | 1 classification | 2 nationality | 3 family-arabic | 4 family-latin
 *   5  fullname-arabic | 6  fullname-latin | 7  DOB | 8  POB
 *   9  alias-arabic | 10 street | 11 city | 12 doc-country | 13 doc-type
 *   14 doc-number | 15 doc-issuer | 16 doc-issue-date | 17 doc-expiry
 *   18 legal-basis
 *
 * Entities (5 columns):
 *   0  serial | 1 classification | 2 english-name | 3 arabic-name | 4 legal-basis
 * @module scripts/import-uae-local
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface UaeLocalRecord {
  id: string;
  name: string;
  aliases: string[];
  type: 'person' | 'organization';
  dob?: string;
  nationality?: string;
  passportNumber?: string;
  legalBasis?: string;
}

// ─── Arabic → English nationality map ─────────────────────────────────────────

const NATIONALITY_MAP: Record<string, string> = {
  'قطر': 'Qatar',  'ﻗﻄﺮ': 'Qatar',
  'الأردن': 'Jordan',  'اﻷردن': 'Jordan',
  'العراق': 'Iraq',   'العﺮاق': 'Iraq',
  'اليمن': 'Yemen',
  'السعودية': 'Saudi Arabia',
  'مصر': 'Egypt',
  'الكويت': 'Kuwait',
  'البحرين': 'Bahrain',
  'عمان': 'Oman',
  'ليبيا': 'Libya',
  'سوريا': 'Syria',
  'تونس': 'Tunisia',
  'المغرب': 'Morocco',
  'السودان': 'Sudan',
  'الصومال': 'Somalia',
  'أفغانستان': 'Afghanistan',
  'باكستان': 'Pakistan',
  'فلسطين': 'Palestine',
  'لبنان': 'Lebanon',
  'الجزائر': 'Algeria',
  'الإمارات': 'UAE',  'اﻹمارات': 'UAE',
  'إيران': 'Iran',
  'تركيا': 'Turkey',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Remove Unicode bidirectional control characters. */
function clean(s: string): string {
  return s.replace(/[‎‏‪-‮⁦-⁩ﹰ-﻿]/g, '').trim();
}

/** Parse M/D/YYYY or MM/DD/YYYY → YYYY-MM-DD. Returns undefined for "-" or blanks. */
function parseDate(raw: string): string | undefined {
  const s = clean(raw);
  if (!s || s === '-') return undefined;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const [, mo, dy, yr] = m;
  return `${yr}-${mo!.padStart(2, '0')}-${dy!.padStart(2, '0')}`;
}

/** Extract Cabinet Decision reference from the legal-basis column. */
function parseLegalBasis(raw: string): string | undefined {
  const s = clean(raw);
  const m = s.match(/\((\d{1,3})\).*?(\d{4})/);
  if (!m) return undefined;
  return `Cabinet Decision No. ${m[1]} of ${m[2]}`;
}

/** Map Arabic nationality string to English. */
function parseNationality(arabic: string): string | undefined {
  const s = clean(arabic);
  return NATIONALITY_MAP[s] ?? undefined;
}

/** True when the classification column marks an entity/organisation. */
function isEntityClassification(col: string): boolean {
  // pdfjs renders Arabic with some font substitutions; we check for the
  // distinguishing Arabic roots: كيان (entity) or تنظيم (organisation/group).
  // شخص (person) shares none of these roots.
  return col.includes('كيان') || col.includes('تنظيم');
}

// ─── Main parser ──────────────────────────────────────────────────────────────

async function parsePdf(pdfPath: string): Promise<UaeLocalRecord[]> {
  const { PDFParse } = await import('pdf-parse');
  const buf = readFileSync(pdfPath);
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();

  const records: UaeLocalRecord[] = [];
  let personSerial = 0;
  let entitySerial = 0;

  for (const rawLine of result.text.split('\n')) {
    const cols = rawLine.split('\t').map(c => clean(c));
    if (cols.length < 5) continue;

    // First column must be a serial number (1-3 digits)
    if (!/^\d{1,3}$/.test(cols[0]!)) continue;

    const classification = cols[1] ?? '';
    const isEntity = isEntityClassification(classification);

    if (isEntity) {
      // Entity/organisation: col 2 = English name, col 3 = Arabic name, col 4 = legal basis
      const englishName = cols[2] ?? '';
      if (!englishName || englishName === '-') continue;

      // Some entities have multiple names separated by a colon (e.g. "CANVAS : CENTER FOR...")
      const parts = englishName.split(/\s*:\s*/).map(p => p.trim()).filter(Boolean);
      const [primary, ...aliases] = parts;
      if (!primary) continue;

      entitySerial += 1;
      const legalBasis = parseLegalBasis(cols[4] ?? '');

      records.push({
        id: `UAE-E-${String(entitySerial).padStart(3, '0')}`,
        name: primary,
        aliases,
        type: 'organization',
        ...(legalBasis ? { legalBasis } : {}),
      });
    } else {
      // Individual: col 4 = family name Latin, col 6 = full name Latin
      //             col 7 = DOB, col 2 = nationality (Arabic), col 14 = doc number
      //             col 18 = legal basis
      const familyNameLatin = clean(cols[4] ?? '');
      const fullNameLatin   = clean(cols[6] ?? '');
      if (!fullNameLatin || fullNameLatin === '-') continue;

      personSerial += 1;
      const dob = parseDate(cols[7] ?? '');
      const nationality = parseNationality(cols[2] ?? '');
      const docNumber = clean(cols[14] ?? '');
      const passportNumber =
        docNumber && docNumber !== '-' ? docNumber : undefined;
      const legalBasis = parseLegalBasis(cols[18] ?? '');

      // Family name is a useful alias when it differs from the full name
      const aliases =
        familyNameLatin && familyNameLatin !== fullNameLatin && familyNameLatin !== '-'
          ? [familyNameLatin]
          : [];

      records.push({
        id: `UAE-P-${String(personSerial).padStart(3, '0')}`,
        name: fullNameLatin,
        aliases,
        type: 'person',
        ...(dob ? { dob } : {}),
        ...(nationality ? { nationality } : {}),
        ...(passportNumber ? { passportNumber } : {}),
        ...(legalBasis ? { legalBasis } : {}),
      });
    }
  }

  return records;
}

// ─── Code generation ──────────────────────────────────────────────────────────

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function recordToTs(r: UaeLocalRecord): string {
  const lines: string[] = ['  {'];
  lines.push(`    id: '${escapeStr(r.id)}',`);
  lines.push(`    name: '${escapeStr(r.name)}',`);
  lines.push(`    aliases: [${r.aliases.map(a => `'${escapeStr(a)}'`).join(', ')}],`);
  lines.push(`    type: '${r.type}',`);
  if (r.dob)            lines.push(`    dob: '${r.dob}',`);
  if (r.nationality)    lines.push(`    nationality: '${escapeStr(r.nationality)}',`);
  if (r.passportNumber) lines.push(`    passportNumber: '${escapeStr(r.passportNumber)}',`);
  if (r.legalBasis)     lines.push(`    legalBasis: '${escapeStr(r.legalBasis)}',`);
  lines.push('  },');
  return lines.join('\n');
}

function generateDataFile(
  records: UaeLocalRecord[],
  pdfPath: string,
  version: string,
): string {
  const persons  = records.filter(r => r.type === 'person');
  const entities = records.filter(r => r.type === 'organization');

  return `/**
 * @fileoverview UAE Local Terrorist List (EOCN) — bundled static records.
 *
 * The official source is the UAE Executive Office for Control and
 * Non-Proliferation (EOCN) at eocn.gov.ae, which publishes the list under
 * Cabinet Decision No. 83 of 2021 and subsequent amendments. The site is
 * protected by a WAF that prevents automated fetching, so this list is
 * maintained as a curated static dataset.
 *
 * HOW TO UPDATE
 * 1. Obtain the current Excel/PDF from the official EOCN portal.
 * 2. Run: bun run scripts/import-uae-local.ts <path-to-new-pdf>
 * 3. Commit the regenerated file.
 * 4. Re-run \`bun run mirror:refresh\` to ingest.
 *
 * Generated from: ${pdfPath}
 * Persons: ${persons.length} | Entities: ${entities.length} | Total: ${records.length}
 * @module services/screening/uae-local-data
 */

/** Snapshot date of the last manual update to this file (ISO 8601). */
export const UAE_LOCAL_VERSION = '${version}';

/** Provenance URL — the official EOCN page operators should check for updates. */
export const UAE_LOCAL_SOURCE_URL = 'https://www.eocn.gov.ae/en/CrimesPrevention/LocalTerroristList';

export type UaeEntityType = 'person' | 'organization';

export interface UaeLocalRecord {
  id: string;
  name: string;
  aliases: string[];
  type: UaeEntityType;
  dob?: string;
  nationality?: string;
  passportNumber?: string;
  legalBasis?: string;
}

export const UAE_LOCAL_RECORDS: readonly UaeLocalRecord[] = [
${records.map(recordToTs).join('\n')}
];
`;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: bun run scripts/import-uae-local.ts <path-to-pdf>');
    process.exit(1);
  }

  const resolved = resolve(pdfPath);
  console.log(`Parsing ${resolved} …`);

  const records = await parsePdf(resolved);
  const persons  = records.filter(r => r.type === 'person');
  const entities = records.filter(r => r.type === 'organization');
  console.log(`Extracted: ${persons.length} persons, ${entities.length} entities`);

  if (records.length === 0) {
    console.error('No records extracted — check PDF format.');
    process.exit(1);
  }

  const today   = new Date().toISOString().slice(0, 10);
  const outPath = resolve('src/services/screening/uae-local-data.ts');
  writeFileSync(outPath, generateDataFile(records, resolved, today));
  console.log(`Written: ${outPath}`);
  console.log('Next step: bun run mirror:refresh (or mirror:load-india-uae) to ingest.');
}

main().catch(err => {
  console.error('import-uae-local failed:', err);
  process.exit(1);
});
