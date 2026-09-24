/**
 * @fileoverview FATF (Financial Action Task Force) jurisdiction risk data —
 * bundled static dataset. FATF meets four times per year and publishes updated
 * lists at each plenary. This file should be refreshed after each plenary.
 *
 * Two lists are maintained:
 *  - CALL_FOR_ACTION: Jurisdictions with strategic AML/CFT deficiencies that
 *    pose significant risk to the international financial system. Formerly the
 *    "black list". The strongest FATF signal — enhanced due diligence and
 *    counter-measures apply.
 *  - INCREASED_MONITORING: Jurisdictions actively working with FATF to address
 *    deficiencies. Formerly the "grey list". Requires enhanced due diligence.
 *
 * HOW TO UPDATE
 * After each FATF plenary (February, June, October, February):
 * 1. Check https://www.fatf-gafi.org/en/topics/high-risk-and-other-monitored-jurisdictions.html
 * 2. Update the arrays below and bump FATF_DATA_VERSION to the plenary date.
 *
 * Note: FATF and the FATF-GAFI website are behind Cloudflare, so automated
 * scraping is not possible — this is a manually maintained bundled dataset.
 * @module services/screening/fatf-data
 */

/** ISO 8601 date of the last manual update (FATF plenary date). */
export const FATF_DATA_VERSION = '2024-06-28';

/** FATF jurisdiction risk classification. */
export type FatfStatus =
  /** Highest risk — counter-measures apply. */
  | 'call_for_action'
  /** Elevated risk — enhanced due diligence required. */
  | 'increased_monitoring'
  /** Not on either FATF list. */
  | 'not_listed';

export interface FatfEntry {
  /** Country name as published by FATF. */
  country: string;
  /** Common alternate names / spellings for lookup. */
  aliases: string[];
  /** ISO 3166-1 alpha-2 code. */
  iso2: string;
  status: FatfStatus;
  /** FATF statement or reason summary. */
  detail: string;
}

// ─── Call for Action (formerly Black List) ────────────────────────────────────

export const FATF_CALL_FOR_ACTION: readonly FatfEntry[] = [
  {
    country: 'Democratic People\'s Republic of Korea',
    aliases: ['North Korea', 'DPRK', 'Korea, Democratic People\'s Republic of'],
    iso2: 'KP',
    status: 'call_for_action',
    detail:
      'FATF calls on members and urges all jurisdictions to apply effective counter-measures. DPRK has failed to engage with FATF and has not committed to the FATF standards.',
  },
  {
    country: 'Iran',
    aliases: ['Islamic Republic of Iran', 'Iran, Islamic Republic of'],
    iso2: 'IR',
    status: 'call_for_action',
    detail:
      'FATF calls on its members and urges all jurisdictions to apply effective counter-measures to protect the international financial system from the money laundering and terrorist financing risks emanating from Iran.',
  },
  {
    country: 'Myanmar',
    aliases: ['Burma'],
    iso2: 'MM',
    status: 'call_for_action',
    detail:
      'Added October 2023. Myanmar has failed to implement its FATF Action Plan and has not made the required progress. FATF calls for enhanced counter-measures.',
  },
];

// ─── Increased Monitoring (formerly Grey List) ────────────────────────────────

export const FATF_INCREASED_MONITORING: readonly FatfEntry[] = [
  {
    country: 'Algeria',
    aliases: [],
    iso2: 'DZ',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2023.',
  },
  {
    country: 'Angola',
    aliases: [],
    iso2: 'AO',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since June 2023.',
  },
  {
    country: 'Bulgaria',
    aliases: [],
    iso2: 'BG',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since October 2023.',
  },
  {
    country: 'Burkina Faso',
    aliases: [],
    iso2: 'BF',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2023.',
  },
  {
    country: 'Cameroon',
    aliases: [],
    iso2: 'CM',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since October 2023.',
  },
  {
    country: 'Croatia',
    aliases: [],
    iso2: 'HR',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2023.',
  },
  {
    country: 'Democratic Republic of the Congo',
    aliases: ['DRC', 'Congo, Democratic Republic of the', 'Congo DR'],
    iso2: 'CD',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since October 2022.',
  },
  {
    country: 'Haiti',
    aliases: [],
    iso2: 'HT',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since June 2020.',
  },
  {
    country: 'Kenya',
    aliases: [],
    iso2: 'KE',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2024.',
  },
  {
    country: 'Mali',
    aliases: [],
    iso2: 'ML',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2021.',
  },
  {
    country: 'Monaco',
    aliases: [],
    iso2: 'MC',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2024.',
  },
  {
    country: 'Mozambique',
    aliases: [],
    iso2: 'MZ',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since October 2022.',
  },
  {
    country: 'Namibia',
    aliases: [],
    iso2: 'NA',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2024.',
  },
  {
    country: 'Nigeria',
    aliases: [],
    iso2: 'NG',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2023.',
  },
  {
    country: 'Philippines',
    aliases: [],
    iso2: 'PH',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since June 2021.',
  },
  {
    country: 'Senegal',
    aliases: [],
    iso2: 'SN',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2024.',
  },
  {
    country: 'South Africa',
    aliases: [],
    iso2: 'ZA',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since October 2023.',
  },
  {
    country: 'South Sudan',
    aliases: [],
    iso2: 'SS',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2024.',
  },
  {
    country: 'Syria',
    aliases: ['Syrian Arab Republic'],
    iso2: 'SY',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2010.',
  },
  {
    country: 'Tanzania',
    aliases: ['United Republic of Tanzania'],
    iso2: 'TZ',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2024.',
  },
  {
    country: 'Türkiye',
    aliases: ['Turkey'],
    iso2: 'TR',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since October 2021.',
  },
  {
    country: 'Uganda',
    aliases: [],
    iso2: 'UG',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since October 2020.',
  },
  {
    country: 'Venezuela',
    aliases: ['Venezuela, Bolivarian Republic of'],
    iso2: 'VE',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since June 2024.',
  },
  {
    country: 'Vietnam',
    aliases: ['Viet Nam'],
    iso2: 'VN',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2023.',
  },
  {
    country: 'Yemen',
    aliases: [],
    iso2: 'YE',
    status: 'increased_monitoring',
    detail: 'Under increased monitoring since February 2010.',
  },
];

// ─── Lookup index ─────────────────────────────────────────────────────────────

const ALL_ENTRIES: readonly FatfEntry[] = [
  ...FATF_CALL_FOR_ACTION,
  ...FATF_INCREASED_MONITORING,
];

/**
 * Look up a jurisdiction's FATF status by country name, alias, or ISO-2 code.
 * Case-insensitive. Returns `null` when the jurisdiction is not on either list.
 */
export function lookupFatfJurisdiction(query: string): FatfEntry | null {
  const q = query.toLowerCase().trim();
  for (const entry of ALL_ENTRIES) {
    if (entry.country.toLowerCase() === q) return entry;
    if (entry.iso2.toLowerCase() === q) return entry;
    if (entry.aliases.some((a) => a.toLowerCase() === q)) return entry;
    // Partial match for long names
    if (entry.country.toLowerCase().includes(q) && q.length >= 4) return entry;
  }
  return null;
}
