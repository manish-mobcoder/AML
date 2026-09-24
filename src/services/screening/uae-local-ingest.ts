/**
 * @fileoverview UAE Local Terrorist List ingester — reads from the bundled
 * static records in `uae-local-data.ts` and maps each onto
 * {@link NormalizedDesignation}. The EOCN portal is protected by a WAF so
 * the list is maintained as a curated static dataset; see `uae-local-data.ts`
 * for update instructions.
 * @module services/screening/uae-local-ingest
 */

import { isUsableName } from '@/services/screening/ingest-validation.js';
import type {
  DeferredDesignationFields,
  SanctionsIngester,
} from '@/services/screening/sanctions-ingest.js';
import { createHarvestState } from '@/services/screening/sanctions-ingest.js';
import type {
  DobRecord,
  IdentifierRecord,
  NameRecord,
  NormalizedDesignation,
} from '@/services/screening/types.js';
import {
  UAE_LOCAL_RECORDS,
  UAE_LOCAL_SOURCE_URL,
  UAE_LOCAL_VERSION,
  type UaeLocalRecord,
} from '@/services/screening/uae-local-data.js';

const SOURCE = 'uae_local' as const;
const PROGRAM = 'UAE-LOCAL-TERRORIST';

function buildNames(record: UaeLocalRecord): NameRecord[] {
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

function buildIdentifiers(record: UaeLocalRecord): IdentifierRecord[] {
  const out: IdentifierRecord[] = [];
  if (record.passportNumber) {
    out.push({ type: 'Passport', value: record.passportNumber });
  }
  return out;
}

function buildDobs(record: UaeLocalRecord): DobRecord[] {
  if (!record.dob) return [];
  return [{ date: record.dob }];
}

export function normalizeUaeLocalRecord(
  record: UaeLocalRecord,
): NormalizedDesignation | null {
  const names = buildNames(record);
  if (names.length === 0) return null;

  return {
    id: `${SOURCE}:${record.id}`,
    source: SOURCE,
    sourceEntryId: record.id,
    entityType: record.type,
    primaryName: names[0]!.name,
    program: PROGRAM,
    ...(record.legalBasis ? { legalBasis: record.legalBasis } : {}),
    payload: {
      aliases: names,
      addresses: [],
      datesOfBirth: buildDobs(record),
      identifiers: buildIdentifiers(record),
      nationalities: record.nationality ? [record.nationality] : [],
      remarks: `UAE EOCN Local Terrorist List. Verify against ${UAE_LOCAL_SOURCE_URL} (dataset version ${UAE_LOCAL_VERSION})`,
    },
  };
}

/** Bundled UAE Local Terrorist List (EOCN). */
export function buildUaeLocalIngester(): SanctionsIngester {
  let state = createHarvestState();
  let accepted = 0;

  return {
    source: SOURCE,
    url: () => `bundled:uae-local (EOCN Local Terrorist List — version ${UAE_LOCAL_VERSION})`,
    deferredFields: (): DeferredDesignationFields => state.deferredFields,
    report: () => ({ source: SOURCE, accepted, rejected: state.rejections }),

    async *harvest(_signal: AbortSignal) {
      state = createHarvestState();
      accepted = 0;

      for (const record of UAE_LOCAL_RECORDS) {
        if (!record.id) {
          state.rejections.missingIdentifier += 1;
          continue;
        }
        const designation = normalizeUaeLocalRecord(record);
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
