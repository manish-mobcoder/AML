/**
 * @fileoverview Local India FEO / NIA most-wanted ingester. Harvests the
 * bundled curated records (not a live ED/NIA bulk feed) onto
 * {@link NormalizedDesignation} so they share the same mirror + matcher as
 * OFAC/EU/UK/UN/UAPA.
 * @module services/screening/india-watchlist-ingest
 */

import { isUsableName } from '@/services/screening/ingest-validation.js';
import {
  INDIA_WATCHLIST_RECORDS,
  type IndiaWatchlistRecord,
} from '@/services/screening/india-watchlist-data.js';
import type {
  DeferredDesignationFields,
  SanctionsIngester,
} from '@/services/screening/sanctions-ingest.js';
import { createHarvestState } from '@/services/screening/sanctions-ingest.js';
import type { NameRecord, NormalizedDesignation } from '@/services/screening/types.js';

const SOURCE = 'india_watchlist' as const;

const PROVENANCE_URL =
  'bundled:india-watchlist (India FEO + NIA Most Wanted — curated, not a live bulk feed)';

function buildNames(record: IndiaWatchlistRecord): NameRecord[] {
  if (!isUsableName(record.name)) return [];
  const seen = new Set<string>([record.name.toLowerCase()]);
  const names: NameRecord[] = [{ name: record.name, nameType: 'primary' }];
  for (const alias of record.aliases) {
    if (!isUsableName(alias)) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push({ name: alias, nameType: 'aka' });
  }
  return names;
}

/** Map one curated row onto the shared designation schema, or null if unusable. */
export function normalizeIndiaWatchlistRecord(
  record: IndiaWatchlistRecord,
): NormalizedDesignation | null {
  const names = buildNames(record);
  if (names.length === 0) return null;
  const primaryName = names[0]!.name;

  return {
    id: `${SOURCE}:${record.id}`,
    source: SOURCE,
    sourceEntryId: record.id,
    entityType: 'person',
    primaryName,
    program: record.category,
    legalBasis: record.source,
    payload: {
      aliases: names,
      addresses: [],
      datesOfBirth:
        record.dob || record.place_of_birth
          ? [
              {
                ...(record.dob ? { date: record.dob } : {}),
                ...(record.place_of_birth ? { place: record.place_of_birth } : {}),
              },
            ]
          : [],
      identifiers: [],
      nationalities: record.nationality ? [record.nationality] : [],
      remarks: `Curated ${record.category}. Verify against ${record.source_url}`,
    },
  };
}

/** Bundled India FEO + NIA most-wanted list. */
export function buildIndiaWatchlistIngester(): SanctionsIngester {
  let state = createHarvestState();
  let accepted = 0;

  return {
    source: SOURCE,
    url: () => PROVENANCE_URL,
    deferredFields: (): DeferredDesignationFields => state.deferredFields,
    report: () => ({ source: SOURCE, accepted, rejected: state.rejections }),
    async *harvest(_signal: AbortSignal) {
      state = createHarvestState();
      accepted = 0;
      for (const record of INDIA_WATCHLIST_RECORDS) {
        if (!record.id) {
          state.rejections.missingIdentifier += 1;
          continue;
        }
        const designation = normalizeIndiaWatchlistRecord(record);
        if (!designation) {
          state.rejections.unusableName += 1;
          continue;
        }
        accepted += 1;
        yield designation;
      }
    },
  };
}
