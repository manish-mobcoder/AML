/**
 * OpenAPI 3.0 document for the AML REST sidecar (port 3011).
 * Served at GET /openapi.json; Swagger UI at GET /docs.
 */

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'AML Sanctions Screening API',
    version: '1.0.1',
    description:
      'Person sanctions screening REST API. Screens names against OFAC, EU, UK, UN, India, and UAE watchlists loaded in a local SQLite mirror.\n\n' +
      '**Screening aid, not a compliance determination.** A hit is a candidate to verify against the official source. `no_match` is never a clearance.',
  },
  servers: [
    {
      url: 'http://127.0.0.1:3011',
      description: 'Local AML API (default)',
    },
  ],
  tags: [
    { name: 'Health', description: 'Liveness and mirror readiness' },
    { name: 'Screening', description: 'Person sanctions screening' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description:
          'Shared secret from `AML_API_KEY`. Required when the env var is set; ignored when unset (open mode).',
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Same value as `AML_API_KEY`, sent as `Authorization: Bearer <key>`.',
      },
    },
    schemas: {
      HealthResponse: {
        type: 'object',
        required: ['status', 'service', 'mirrorReady'],
        properties: {
          status: {
            type: 'string',
            enum: ['ok'],
            description: 'Always `ok` when the process is up (liveness).',
          },
          service: {
            type: 'string',
            enum: ['aml-api'],
          },
          mirrorReady: {
            type: 'boolean',
            description:
              'Whether the sanctions mirror is loaded and ready for screening. Does not fail the health check when false.',
          },
        },
      },
      Identifier: {
        type: 'object',
        required: ['value'],
        properties: {
          type: {
            type: 'string',
            description: 'Document type (e.g. Passport, National ID). Defaults to `ID` when omitted.',
            example: 'Passport',
          },
          value: {
            type: 'string',
            description: 'Document number to cross-check against list records.',
            example: 'Z1234567',
          },
        },
      },
      ScreenPersonRequest: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            description: 'Person name to screen (required).',
            example: 'Vijay Mallya',
          },
          dateOfBirth: {
            type: 'string',
            description:
              'ISO 8601 date of birth: `YYYY-MM-DD`, year-month `YYYY-MM`, or year only `YYYY`.',
            example: '1955-12-18',
          },
          nationality: {
            type: 'string',
            description: 'Country name, demonym (e.g. Jordanian), or ISO-2 code (e.g. JO).',
            example: 'India',
          },
          passportNumber: {
            type: 'string',
            description:
              'Passport shorthand — equivalent to `identifiers: [{ type: "Passport", value: "..." }]`.',
          },
          nationalId: {
            type: 'string',
            description:
              'National ID shorthand — equivalent to `identifiers: [{ type: "National ID", value: "..." }]`.',
          },
          identifiers: {
            type: 'array',
            items: { $ref: '#/components/schemas/Identifier' },
            description: 'Additional document numbers when you have more than one identifier.',
          },
          customerRef: {
            type: 'string',
            description:
              'Opaque customer identifier. When provided, hits previously cleared via `sanctions_clear_hit` are suppressed.',
          },
          matchMode: {
            type: 'string',
            enum: ['strict', 'fuzzy'],
            default: 'strict',
            description:
              '`strict` (default) does not auto-fall back to fuzzy. Pass `fuzzy` explicitly for approximate matching.',
          },
        },
      },
      AttributeCheck: {
        type: 'object',
        properties: {
          dob: {
            type: 'string',
            enum: ['match', 'mismatch', 'not_provided', 'not_on_record'],
          },
          nationality: {
            type: 'string',
            enum: ['match', 'mismatch', 'not_provided', 'not_on_record'],
          },
          identifier: {
            type: 'string',
            enum: ['match', 'mismatch', 'not_provided', 'not_on_record'],
            description: 'Best signal across all supplied identifiers.',
          },
        },
      },
      ScreenMatch: {
        type: 'object',
        required: [
          'source',
          'sourceCode',
          'sourceEntryId',
          'matchedName',
          'primaryName',
          'matchType',
          'matchScore',
        ],
        properties: {
          source: {
            type: 'string',
            description: 'Human-readable list label.',
            example: 'India FEO / NIA Most Wanted (curated)',
          },
          sourceCode: {
            type: 'string',
            enum: [
              'ofac_sdn',
              'ofac_consolidated',
              'eu',
              'uk',
              'un',
              'india_uapa',
              'india_watchlist',
              'uae_local',
            ],
          },
          sourceEntryId: {
            type: 'string',
            example: 'FEO-002',
          },
          matchedName: {
            type: 'string',
            description: 'Name/alias string that matched the query.',
          },
          primaryName: {
            type: 'string',
            description: 'Primary published name on the designation.',
          },
          matchType: {
            type: 'string',
            enum: ['exact', 'strong', 'approximate'],
          },
          matchScore: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            description:
              '0–100 decision score from attribute signals (identifier → 100; name+DOB+country → 100; name+DOB → 80; name+country → 60; name only → 40; approximate → 20).',
          },
          fuzzyScore: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Raw Jaro-Winkler similarity for approximate hits only.',
          },
          designationDate: {
            type: 'string',
            description: 'Designation date when published by the source.',
          },
          program: {
            type: 'string',
            description: 'Sanctions program or list category when available.',
            example: 'FUGITIVE_ECONOMIC_OFFENDER',
          },
          attributeCheck: {
            $ref: '#/components/schemas/AttributeCheck',
            description:
              'Present when dateOfBirth / nationality / identifiers were supplied. `mismatch` on a published field usually means a different person.',
          },
        },
      },
      ScreenPersonResponse: {
        type: 'object',
        required: ['status', 'matchScore', 'listVersion', 'matcherVersion', 'matches'],
        properties: {
          status: {
            type: 'string',
            enum: ['potential_match', 'no_match'],
          },
          matchScore: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            description: 'Max `matchScore` across hits, or 0 when there are no matches.',
          },
          listVersion: {
            type: 'string',
            description: 'Mirror list version timestamp — store for audit reproducibility.',
            example: '2026-10-07T11:25:15.756Z',
          },
          matcherVersion: {
            type: 'string',
            description: 'Matcher / service version.',
            example: '1.0.1',
          },
          clearedHitsCount: {
            type: 'integer',
            description:
              'Number of hits suppressed because they were previously cleared for `customerRef`.',
          },
          matches: {
            type: 'array',
            items: { $ref: '#/components/schemas/ScreenMatch' },
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'string',
            example: 'name is required',
          },
        },
      },
    },
  },
  paths: {
    '/healthz': {
      get: {
        tags: ['Health'],
        summary: 'Liveness / health check',
        description:
          'No API key required. Always returns 200 when the process is up. `mirrorReady` reports whether screening can run; deploy healthchecks do not fail on a cold mirror.',
        operationId: 'getHealthz',
        responses: {
          '200': {
            description: 'Service is up',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
                example: {
                  status: 'ok',
                  service: 'aml-api',
                  mirrorReady: true,
                },
              },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness / health check (alias)',
        description: 'Same as `GET /healthz`.',
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'Service is up',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
        },
      },
    },
    '/api/aml/screen-person': {
      post: {
        tags: ['Screening'],
        summary: 'Screen a person against sanctions lists',
        description:
          'Strict person-name match across OFAC, EU, UK, UN, India UAPA, India watchlist, and UAE local lists. Fuzzy matching only when `matchMode` is `"fuzzy"`.\n\n' +
          'Auth: when `AML_API_KEY` is set, send it via `X-API-Key` or `Authorization: Bearer`. When unset, the route is open.',
        operationId: 'screenPerson',
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ScreenPersonRequest' },
              examples: {
                nameOnly: {
                  summary: 'Name only',
                  value: { name: 'Vijay Mallya' },
                },
                withAttributes: {
                  summary: 'Name + DOB + nationality',
                  value: {
                    name: 'Vijay Mallya',
                    dateOfBirth: '1955-12-18',
                    nationality: 'India',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Screening result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScreenPersonResponse' },
                examples: {
                  potentialMatch: {
                    summary: 'Potential match',
                    value: {
                      status: 'potential_match',
                      matchScore: 40,
                      listVersion: '2026-10-07T11:25:15.756Z',
                      matcherVersion: '1.0.1',
                      matches: [
                        {
                          source: 'India FEO / NIA Most Wanted (curated)',
                          sourceCode: 'india_watchlist',
                          sourceEntryId: 'FEO-002',
                          matchedName: 'Vijay Mallya',
                          primaryName: 'Vijay Mallya',
                          matchType: 'exact',
                          matchScore: 40,
                          program: 'FUGITIVE_ECONOMIC_OFFENDER',
                        },
                      ],
                    },
                  },
                  noMatch: {
                    summary: 'No match',
                    value: {
                      status: 'no_match',
                      matchScore: 0,
                      listVersion: '2026-10-07T11:25:15.756Z',
                      matcherVersion: '1.0.1',
                      matches: [],
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid JSON or missing `name`',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                examples: {
                  missingName: { value: { error: 'name is required' } },
                  invalidJson: { value: { error: 'Invalid JSON request body' } },
                },
              },
            },
          },
          '401': {
            description: 'Missing or wrong API key (only when `AML_API_KEY` is set)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: { error: 'Unauthorized' },
              },
            },
          },
          '500': {
            description: 'Server error (e.g. sanctions mirror not ready)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: { error: 'Sanctions mirror is not ready' },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const swaggerUiHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AML Sanctions Screening API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`;
