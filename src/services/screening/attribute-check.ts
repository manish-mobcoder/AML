/**
 * @fileoverview Attribute-level corroboration/exculpation checks for sanctions
 * screening hits. When a caller supplies a date of birth, nationality, or
 * identifier alongside a name query, these functions compare the supplied
 * values against what the designation record publishes and return a signal
 * per attribute.
 *
 * The signals feed the decision layer — they are never collapsed into a single
 * score here. `mismatch` on an attribute the list entry DOES publish is
 * exculpatory (likely a different person); `match` corroborates the name hit.
 * `not_on_record` is neutral: the source simply did not publish the field.
 * @module services/screening/attribute-check
 */

import type {
  AttributeCheck,
  AttributeQuery,
  AttributeSignal,
  DobRecord,
  IdentifierRecord,
} from '@/services/screening/types.js';

// ─── Nationality normalisation ────────────────────────────────────────────────

/** Adjective / demonym → canonical country name (lowercase). */
const DEMONYM_MAP: Record<string, string> = {
  afghan: 'afghanistan', afghani: 'afghanistan',
  algerian: 'algeria',
  american: 'united states',
  bahraini: 'bahrain',
  bangladeshi: 'bangladesh',
  british: 'united kingdom',
  chinese: 'china',
  egyptian: 'egypt',
  emirati: 'united arab emirates',
  french: 'france',
  german: 'germany',
  indian: 'india',
  indonesian: 'indonesia',
  iranian: 'iran',
  iraqi: 'iraq',
  jordanian: 'jordan',
  kuwaiti: 'kuwait',
  lebanese: 'lebanon',
  libyan: 'libya',
  malaysian: 'malaysia',
  moroccan: 'morocco',
  omani: 'oman',
  pakistani: 'pakistan',
  palestinian: 'palestine',
  qatari: 'qatar',
  russian: 'russia',
  'saudi arabian': 'saudi arabia',
  saudi: 'saudi arabia',
  somali: 'somalia',
  sudanese: 'sudan',
  syrian: 'syria',
  tunisian: 'tunisia',
  turkish: 'turkey',
  yemeni: 'yemen',
};

/** ISO-2 / common abbreviation → canonical country name (lowercase). */
const ABBREV_MAP: Record<string, string> = {
  ae: 'united arab emirates', uae: 'united arab emirates',
  af: 'afghanistan',
  bh: 'bahrain',
  bd: 'bangladesh',
  cn: 'china',
  eg: 'egypt',
  fr: 'france',
  gb: 'united kingdom', uk: 'united kingdom',
  id: 'indonesia',
  in: 'india',
  iq: 'iraq',
  ir: 'iran',
  jo: 'jordan',
  kw: 'kuwait',
  lb: 'lebanon',
  ly: 'libya',
  ma: 'morocco',
  om: 'oman',
  pk: 'pakistan',
  ps: 'palestine',
  qa: 'qatar',
  ru: 'russia',
  sa: 'saudi arabia',
  so: 'somalia',
  sd: 'sudan',
  sy: 'syria',
  tn: 'tunisia',
  tr: 'turkey',
  us: 'united states', usa: 'united states',
  ye: 'yemen',
};

function normaliseNationality(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return DEMONYM_MAP[lower] ?? ABBREV_MAP[lower] ?? lower;
}

function nationalitiesOverlap(a: string, b: string): boolean {
  const na = normaliseNationality(a);
  const nb = normaliseNationality(b);
  // Treat substring matches too: "United Arab Emirates" ↔ "UAE"
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ─── DOB helpers ──────────────────────────────────────────────────────────────

/** Extract a 4-digit year from any date string. */
function extractYear(s: string): number | undefined {
  const m = s.match(/\b(1[89]\d{2}|20\d{2})\b/);
  return m ? parseInt(m[1]!, 10) : undefined;
}

/**
 * Normalise a date string to YYYY-MM-DD when the parts are unambiguous, else
 * return the raw trimmed string (comparison still works at year level).
 */
function normaliseDate(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  // M/D/YYYY or MM/DD/YYYY — US format common in OFAC/MHA sources
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  return raw.trim();
}

// ─── Per-attribute checks ─────────────────────────────────────────────────────

export function checkDob(supplied: string | undefined, records: DobRecord[]): AttributeSignal {
  if (!supplied?.trim()) return 'not_provided';

  const withDate = records.filter((r) => r.date);
  if (withDate.length === 0) return 'not_on_record';

  const suppYear = extractYear(supplied);
  if (!suppYear) return 'not_on_record'; // unparseable — treat as missing

  const suppNorm = normaliseDate(supplied);

  for (const rec of withDate) {
    const recNorm = normaliseDate(rec.date!);
    // Exact full-date match
    if (suppNorm.length === 10 && recNorm.length === 10 && suppNorm === recNorm) return 'match';

    const recYear = extractYear(rec.date!);
    if (!recYear) continue;
    // Year agrees within ±1 (typos, hijri/gregorian offsets, year-range entries)
    if (Math.abs(suppYear - recYear) <= 1) return 'match';
  }

  // All records with parseable years are >1 year away — check if any are >2 years
  const allFarOff = withDate.every((rec) => {
    const y = extractYear(rec.date!);
    return y !== undefined && Math.abs(suppYear - y) > 2;
  });

  return allFarOff ? 'mismatch' : 'match';
}

export function checkNationality(
  supplied: string | undefined,
  nationalities: string[],
): AttributeSignal {
  if (!supplied?.trim()) return 'not_provided';
  if (nationalities.length === 0) return 'not_on_record';

  for (const nat of nationalities) {
    if (nationalitiesOverlap(supplied, nat)) return 'match';
  }
  return 'mismatch';
}

export function checkIdentifiers(
  supplied: AttributeQuery['identifiers'],
  stored: IdentifierRecord[],
): AttributeSignal {
  if (!supplied?.length) return 'not_provided';
  if (stored.length === 0) return 'not_on_record';

  // Normalise: uppercase, strip whitespace and hyphens
  const norm = (v: string) => v.toUpperCase().replace(/[\s\-]/g, '');
  const normType = (t: string) => t.toLowerCase().replace(/[\s\-_]/g, '');

  for (const s of supplied) {
    const sv = norm(s.value);
    for (const r of stored) {
      if (norm(r.value) !== sv) continue;
      // Values match — if both carry a type, they must be compatible
      if (s.type && r.type && normType(s.type) !== normType(r.type)) {
        // e.g. "passport" vs "national id" — genuinely different documents
        // Allow common synonyms
        const st = normType(s.type);
        const rt = normType(r.type);
        const passportTerms = ['passport', 'passprt', 'traveldocument'];
        const idTerms = ['nationalid', 'nationalidentity', 'identitycard', 'idcard', 'idnumber'];
        const sameClass =
          (passportTerms.some((t) => st.includes(t)) && passportTerms.some((t) => rt.includes(t))) ||
          (idTerms.some((t) => st.includes(t)) && idTerms.some((t) => rt.includes(t)));
        if (!sameClass) continue;
      }
      return 'match';
    }
  }
  return 'mismatch';
}

// ─── Composite check ──────────────────────────────────────────────────────────

export function computeAttributeCheck(
  query: AttributeQuery,
  payload: { datesOfBirth: DobRecord[]; nationalities: string[]; identifiers: IdentifierRecord[] },
): AttributeCheck {
  return {
    dob: checkDob(query.dateOfBirth, payload.datesOfBirth),
    nationality: checkNationality(query.nationality, payload.nationalities),
    identifier: checkIdentifiers(query.identifiers, payload.identifiers),
  };
}

export function hasAttributeQuery(q: AttributeQuery): boolean {
  return !!(q.dateOfBirth ?? q.nationality ?? q.identifiers?.length);
}
