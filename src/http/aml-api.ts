import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getScreeningService } from '@/services/screening/screening-service.js';
import { SOURCE_LABELS, type SourceCode } from '@/services/screening/types.js';

const PORT = Number(process.env.AML_API_PORT ?? 3011);
const HOST = process.env.AML_API_HOST ?? '127.0.0.1';

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
  dateOfBirth?: string;
  countryOfBirth?: string;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function countryMatches(
  requestedCountry: string | undefined,
  place: string | undefined,
  addresses: Array<{ country?: string }>,
): boolean {
  if (!requestedCountry) return false;

  const wanted = normalize(requestedCountry);

  if (place && normalize(place).includes(wanted)) {
    return true;
  }

  return addresses.some(
    (address) =>
      address.country !== undefined &&
      normalize(address.country).includes(wanted),
  );
}

function computeMatchScore(match: {
  nameMatch: boolean;
  dateOfBirthMatch: boolean;
  countryOfBirthMatch: boolean;
}): number {
  if (match.nameMatch && match.dateOfBirthMatch && match.countryOfBirthMatch) {
    return 100;
  }
  if (match.nameMatch && match.dateOfBirthMatch) {
    return 80;
  }
  if (match.nameMatch && match.countryOfBirthMatch) {
    return 60;
  }
  if (match.nameMatch) {
    return 40;
  }
  return 0;
}

async function screenPerson(input: ScreenPersonRequest) {
  const svc = getScreeningService();

  if (!(await svc.sanctionsReady())) {
    throw new Error('Sanctions mirror is not ready');
  }

  const result = await svc.screenName(
    {
      query: input.name,
      entityType: 'person',
      matchMode: 'strict',
      autoFallback: false,
      sources: SOURCE_CODES,
      limit: 100,
      offset: 0,
    },
    {} as never,
  );

  const matches = [];

  for (const hit of result.hits) {
    const designation = await svc.getDesignation(
      hit.source,
      hit.sourceEntryId,
    );

    if (!designation) continue;

    const datesOfBirth = designation.payload.datesOfBirth ?? [];

    const dateOfBirthMatch =
      !!input.dateOfBirth &&
      datesOfBirth.some(
        (dob) => dob.date === input.dateOfBirth,
      );

    const countryOfBirthMatch =
      !!input.countryOfBirth &&
      datesOfBirth.some((dob) =>
        countryMatches(
          input.countryOfBirth,
          dob.place,
          designation.payload.addresses ?? [],
        ),
      );

    matches.push({
      source: SOURCE_LABELS[hit.source],
      sourceCode: hit.source,
      matchedName: hit.matchedName,
      primaryName: hit.primaryName,
      matchType: hit.matchType,
      nameMatch: true,
      dateOfBirthMatch,
      countryOfBirthMatch,
      matchScore: computeMatchScore({
        nameMatch: true,
        dateOfBirthMatch,
        countryOfBirthMatch,
      }),
    });
  }

  const matchScore =
    matches.length === 0
      ? 0
      : Math.max(...matches.map((match) => match.matchScore));

  return {
    status: matches.length > 0 ? 'potential_match' : 'no_match',
    matchScore,
    matches,
  };
}

export function startAmlApi(): void {
  const server = createServer(async (req, res) => {
    try {
      if (
        req.method === 'POST' &&
        req.url === '/api/aml/screen-person'
      ) {
        const body = await readBody(req);

        let input: ScreenPersonRequest;

        try {
          input = JSON.parse(body);
        } catch {
          return json(res, 400, {
            error: 'Invalid JSON request body',
          });
        }

        if (!input.name || typeof input.name !== 'string') {
          return json(res, 400, {
            error: 'name is required',
          });
        }

        const result = await screenPerson(input);

        return json(res, 200, result);
      }

      return json(res, 404, {
        error: 'Not found',
      });
    } catch (error) {
      console.error('AML API error:', error);

      return json(res, 500, {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error',
      });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(
      `AML API listening at http://${HOST}:${PORT}`,
    );
  });
}
