/**
 * @fileoverview One-shot loader for India UAPA + UAE Local into an existing
 * sanctions mirror without re-harvesting OFAC/EU/UK/UN. Useful after adding
 * the new sources. Full refreshes (`bun run mirror:refresh`) also pick them up.
 *
 * Usage: `bun run scripts/mirror-load-india-uae.ts`
 * @module scripts/mirror-load-india-uae
 */

import {
  buildIndiaUapaIngester,
  buildUaeLocalIngester,
} from '@/services/screening/india-uae-ingest.js';
import { buildIndiaWatchlistIngester } from '@/services/screening/india-watchlist-ingest.js';
import type { NormalizedDesignation } from '@/services/screening/types.js';
import { bootstrap, longRunSignal } from './_mirror-context.js';

async function collect(
  harvest: AsyncGenerator<NormalizedDesignation>,
): Promise<NormalizedDesignation[]> {
  const out: NormalizedDesignation[] = [];
  for await (const d of harvest) out.push(d);
  return out;
}

async function main(): Promise<void> {
  const { service, log } = await bootstrap();
  const signal = longRunSignal(1);

  for (const ingester of [
    buildIndiaUapaIngester(),
    buildIndiaWatchlistIngester(),
    buildUaeLocalIngester(),
  ]) {
    log.info(`Loading ${ingester.source} from ${ingester.url()}`);
    const rows = await collect(ingester.harvest(signal));
    await service.ingestDesignations(rows);
    const report = ingester.report();
    log.info(`Loaded ${ingester.source}`, {
      accepted: report.accepted,
      rejectedMissingIdentifier: report.rejected.missingIdentifier,
      rejectedUnusableName: report.rejected.unusableName,
    });
  }

  log.info('India/UAE load complete');
  await service.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('mirror-load-india-uae failed:', err);
  process.exit(1);
});
