/**
 * @fileoverview India UAPA (MHA) and UAE Local Terrorist List (EOCN) ingesters.
 * Official portals do not expose a stable bulk XML feed suitable for the
 * streaming XML spine (MHA publishes HTML/PDF schedules; UAE EOCN Excel is
 * behind a WAF), so these sources harvest OpenSanctions FollowTheMoney JSONL
 * exports of those same official lists and map each target entity onto
 * {@link NormalizedDesignation}. Override `INDIA_UAPA_URL` / `UAE_LOCAL_URL` to
 * point at your own mirror of the JSONL files.
 * @module services/screening/india-uae-ingest
 */

import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import { fetchWithTimeout, requestContextService, withRetry } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '@/config/server-config.js';
import {
  isUsableName,
} from '@/services/screening/ingest-validation.js';
import type {
  SanctionsIngester,
  DeferredDesignationFields,
} from '@/services/screening/sanctions-ingest.js';
import { createHarvestState } from '@/services/screening/sanctions-ingest.js';
import type {
  AddressRecord,
  DobRecord,
  EntityType,
  IdentifierRecord,
  NameRecord,
  NormalizedDesignation,
  SourceCode,
} from '@/services/screening/types.js';

/** Browser-style UA — some CDNs reject bare clients. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const HEADERS_TIMEOUT_MS = 120_000;

/** Prefer a source-local referent when OpenSanctions has one. */
const LOCAL_ID_PREFIX: Record<'india_uapa' | 'uae_local', string> = {
  india_uapa: 'in-mha-',
  uae_local: 'ae-lt-',
};

interface FtmEntity {
  id?: string;
  caption?: string;
  schema?: string;
  target?: boolean;
  referents?: string[];
  properties?: Record<string, unknown>;
}

function asStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim() : String(v).trim()))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function mapEntityType(schema: string | undefined): EntityType {
  switch (schema) {
    case 'Person':
      return 'person';
    case 'Organization':
    case 'Company':
      return 'organization';
    case 'Vessel':
      return 'vessel';
    case 'Airplane':
      return 'aircraft';
    default:
      return 'unknown';
  }
}

function resolveEntryId(
  entity: FtmEntity,
  source: 'india_uapa' | 'uae_local',
): string | undefined {
  const prefix = LOCAL_ID_PREFIX[source];
  const local = (entity.referents ?? []).find((r) => r.startsWith(prefix));
  if (local) return local;
  return entity.id?.trim() || undefined;
}

function buildNames(props: Record<string, unknown>, caption?: string): NameRecord[] {
  const primaryCandidates = asStringList(props.name);
  const aliases = asStringList(props.alias);
  const primary =
    primaryCandidates.find((n) => isUsableName(n)) ??
    (isUsableName(caption) ? caption : undefined);
  if (!primary) return [];

  const seen = new Set<string>([primary.toLowerCase()]);
  const names: NameRecord[] = [{ name: primary, nameType: 'primary' }];

  for (const name of [...primaryCandidates, ...aliases]) {
    if (!isUsableName(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push({ name, nameType: 'aka' });
  }
  return names;
}

function buildDobs(props: Record<string, unknown>): DobRecord[] {
  const dates = asStringList(props.birthDate);
  const places = asStringList(props.birthPlace);
  const len = Math.max(dates.length, places.length);
  if (len === 0) return [];
  const out: DobRecord[] = [];
  for (let i = 0; i < len; i++) {
    const date = dates[i];
    const place = places[i];
    if (!date && !place) continue;
    out.push({
      ...(date ? { date } : {}),
      ...(place ? { place } : {}),
    });
  }
  return out;
}

function buildAddresses(props: Record<string, unknown>): AddressRecord[] {
  return asStringList(props.address).map((full) => {
    const countries = asStringList(props.country);
    return {
      full,
      ...(countries[0] ? { country: countries[0] } : {}),
    };
  });
}

function buildIdentifiers(props: Record<string, unknown>): IdentifierRecord[] {
  const out: IdentifierRecord[] = [];
  for (const value of asStringList(props.passportNumber)) {
    out.push({ type: 'Passport', value });
  }
  for (const value of asStringList(props.idNumber)) {
    out.push({ type: 'National ID', value });
  }
  for (const value of asStringList(props.registrationNumber)) {
    out.push({ type: 'Registration Number', value });
  }
  return out;
}

/**
 * Map one FollowTheMoney target entity onto a normalized designation, or null
 * when the record has no stable id / usable name (counted by the caller).
 */
export function normalizeFtmEntity(
  entity: FtmEntity,
  source: 'india_uapa' | 'uae_local',
): NormalizedDesignation | null {
  if (!entity.target) return null;
  const entityType = mapEntityType(entity.schema);
  if (entityType === 'unknown' && entity.schema !== 'Person') {
    // Skip Sanction / Identification / Address nodes — only person/org/vessel targets.
    if (entity.schema !== 'Organization' && entity.schema !== 'Company' && entity.schema !== 'Vessel' && entity.schema !== 'Airplane') {
      return null;
    }
  }

  const sourceEntryId = resolveEntryId(entity, source);
  if (!sourceEntryId) return null;

  const props = entity.properties ?? {};
  const names = buildNames(props, entity.caption);
  if (names.length === 0) return null;

  const primaryName = names[0]!.name;
  const program = asStringList(props.programId)[0];
  const remarks = asStringList(props.notes)[0];

  return {
    id: `${source}:${sourceEntryId}`,
    source,
    sourceEntryId,
    entityType: entityType === 'unknown' ? mapEntityType(entity.schema) : entityType,
    primaryName,
    ...(program ? { program } : {}),
    payload: {
      aliases: names,
      addresses: buildAddresses(props),
      datesOfBirth: buildDobs(props),
      identifiers: buildIdentifiers(props),
      nationalities: asStringList(props.nationality),
      ...(remarks ? { remarks } : {}),
    },
  };
}

async function fetchJsonlText(
  url: string,
  signal: AbortSignal,
  source: string,
): Promise<string> {
  const reqCtx = requestContextService.createRequestContext({ operation: `harvest:${source}` });
  return withRetry(
    async () => {
      const response = await fetchWithTimeout(url, HEADERS_TIMEOUT_MS, reqCtx, {
        signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'application/json, application/x-ndjson, text/plain, */*',
        },
        redirect: 'follow',
      });
      if (!response.ok) {
        throw serviceUnavailable(`${source} returned HTTP ${response.status}.`);
      }
      const text = await response.text();
      if (!text.trim()) {
        throw serviceUnavailable(`${source} returned an empty body.`);
      }
      if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
        throw serviceUnavailable(`${source} returned HTML instead of JSONL — likely rate-limited.`);
      }
      return text;
    },
    { operation: `harvest:${source}`, baseDelayMs: 2000, signal },
  );
}

function buildJsonlIngester(spec: {
  source: 'india_uapa' | 'uae_local';
  url: () => string;
}): SanctionsIngester {
  let state = createHarvestState();
  let accepted = 0;

  return {
    source: spec.source,
    url: spec.url,
    deferredFields: (): DeferredDesignationFields => state.deferredFields,
    report: () => ({ source: spec.source, accepted, rejected: state.rejections }),
    async *harvest(signal) {
      state = createHarvestState();
      accepted = 0;
      const text = await fetchJsonlText(spec.url(), signal, spec.source);
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let entity: FtmEntity;
        try {
          entity = JSON.parse(trimmed) as FtmEntity;
        } catch {
          continue;
        }
        if (!entity.target) continue;
        if (
          entity.schema !== 'Person' &&
          entity.schema !== 'Organization' &&
          entity.schema !== 'Company' &&
          entity.schema !== 'Vessel' &&
          entity.schema !== 'Airplane'
        ) {
          continue;
        }

        const sourceEntryId = resolveEntryId(entity, spec.source);
        if (!sourceEntryId) {
          state.rejections.missingIdentifier += 1;
          continue;
        }
        const designation = normalizeFtmEntity(entity, spec.source);
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

/** India UAPA (MHA banned organisations + individual terrorists). */
export function buildIndiaUapaIngester(): SanctionsIngester {
  return buildJsonlIngester({
    source: 'india_uapa',
    url: () => getServerConfig().indiaUapaUrl,
  });
}

/** UAE Local Terrorist List (EOCN / Cabinet Decision under UNSCR 1373). */
export function buildUaeLocalIngester(): SanctionsIngester {
  return buildJsonlIngester({
    source: 'uae_local',
    url: () => getServerConfig().uaeLocalUrl,
  });
}

/** Re-export SourceCode for callers that only need the new codes. */
export type IndiaUaeSourceCode = Extract<SourceCode, 'india_uapa' | 'uae_local'>;
