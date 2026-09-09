<div align="center">
  <h1>@cyanheads/sanctions-screening-mcp-server</h1>
  <p><b>Screen names against OFAC, EU, UK, UN, India (UAPA + FEO/NIA), and UAE Local lists and resolve legal entities against GLEIF, fuzzy-matched offline over a local SQLite + FTS5 mirror. A screening aid, not a compliance determination.</b>
  <div>6 Tools • 3 Resources • 1 Prompt</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.11-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.0.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3-blueviolet.svg?style=flat-square)](https://bun.sh/)

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/sanctions-screening-mcp-server/releases/latest/download/sanctions-screening-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=sanctions-screening-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvc2FuY3Rpb25zLXNjcmVlbmluZy1tY3Atc2VydmVyIl19) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22sanctions-screening-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fsanctions-screening-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://sanctions-screening.caseyjhand.com/mcp](https://sanctions-screening.caseyjhand.com/mcp)

</div>

---

> [!IMPORTANT]
> **This is a screening aid, not legal or compliance certification.** Every tool returns *potential matches* with a transparent score and source provenance — never a verdict. A hit means "review this candidate against the official source"; an empty result never means "cleared." Real sanctions compliance is a legal process — it requires human review and a qualified compliance determination. This server feeds that process; it does not perform it, and its output is not a compliance record.

## Overview

`sanctions-screening-mcp-server` turns open sanctions data plus the global legal-entity registry into one screening-and-resolution workflow, answered offline and fuzzy-matched. It screens a name against OFAC (SDN + Consolidated), EU, UK, UN, India UAPA, a curated India FEO/NIA watchlist, and the UAE Local Terrorist List at once, and resolves legal entities against the GLEIF Legal Entity Identifier (LEI) database with corporate-ownership tracing.

OFAC, EU, UK, UN, and GLEIF are bulk-downloadable and keyless. India UAPA and UAE Local default to OpenSanctions FollowTheMoney exports of those official lists (the portals do not publish a stable bulk XML feed). The India FEO/NIA list is bundled and curated — not a live Enforcement Directorate / NIA download. The server mirrors everything to a local SQLite + FTS5 index and serves matches from that mirror. The agent sees screening verbs (`screen_name`, `resolve_entity`, `trace_ownership`); which list answered a query surfaces only as provenance on each hit.

An HTTP sidecar (`POST /api/aml/screen-person`) screens a person name against the same mirror for non-MCP callers.

The matching model is transparent by design: strict token matching first (exact-normalized, then all-tokens-present via FTS5), with a scored Jaro-Winkler + phonetic fuzzy fallback. Approximate hits carry the **raw Jaro-Winkler similarity (0–1)** — a real measurement, never a fabricated "confidence percentage."

## Tools

Six tools organized around two workflows — screen a name against the watchlists, and resolve a legal entity to its global identifier and ownership graph:

| Tool | Description |
|:---|:---|
| `sanctions_screen_name` | Screen a name (person, company, vessel, aircraft) against all loaded watchlists at once — OFAC SDN + Consolidated, EU, UK, UN, India UAPA, India FEO/NIA, UAE Local — alias- and fuzzy-aware. Returns scored potential matches with source list, program, designation date, and the matched alias. |
| `sanctions_get_designation` | Fetch the full record for one sanctions designation by source list + entry ID: all aliases, identifiers, addresses, dates/places of birth, nationalities, program, legal basis, and designation date. |
| `sanctions_resolve_entity` | Resolve a company / organization name (+ optional jurisdiction) to ranked candidate GLEIF LEIs. Turns a free-text counterparty name into a stable global identifier. |
| `sanctions_get_entity` | Fetch the full GLEIF Level 1 record for one LEI — legal name, trading names, addresses, registration status, jurisdiction — plus a sanctions cross-reference screened on the legal name. |
| `sanctions_trace_ownership` | Trace the GLEIF Level 2 corporate-ownership graph for an LEI (parents and/or children, BFS to a bounded depth), optionally screening every node for beneficial-ownership screening. |
| `sanctions_list_sources` | List the loaded watchlists and GLEIF datasets with record counts, source URLs, licenses, and the mirror's readiness and as-of timestamps. |

### `sanctions_screen_name`

The 80% entry point — "is this entity on a watchlist?"

- Fans out across all loaded watchlists (OFAC SDN + Consolidated, EU, UK, UN, India UAPA, India FEO/NIA, UAE Local) in one call; the source surfaces only as provenance per hit
- Alias-aware: matches against every published primary name, a.k.a., and f.k.a., not just the canonical name
- Strict mode (default): exact-normalized equality, then all-tokens-present via FTS5 — handles word-order swaps and missing interior words with no fuzzy library
- Fuzzy mode (opt-in, or automatic when strict finds nothing): adds Jaro-Winkler similarity and Double-Metaphone phonetic matching for transliteration-class misses
- Hits labeled `exact` / `strong` / `approximate`; approximate hits carry the raw Jaro-Winkler score (0–1) plus `queryTokenCoverage` — how many query tokens the candidate explains, which ranks candidates that one shared exact token pins at the same score
- Filter by entity type, source list subset, similarity floor (`minScore`), and result limit
- Paged: `totalAvailable` and `hasMore` report matches beyond the returned page and `nextOffset` retrieves them, with `totalAvailableBasis` marking that count exact (strict) or a scanned-set floor (fuzzy)
- On an empty result, returns guidance on how to broaden — and states explicitly that no match is **not** a clearance

---

### `sanctions_get_designation`

The drill-in after `sanctions_screen_name` surfaces a candidate.

- Full normalized record by `source` + `entryId` (the `sourceEntryId` from a screen hit)
- All published aliases, structured identifiers (passport / national ID / tax / registration), addresses, dates and places of birth, nationalities, sanctioning program, legal basis, and designation date
- Preserves source sparsity — missing fields mean the source omitted them; the record is never padded with fabricated data

---

### `sanctions_resolve_entity`

The bridge from a free-text counterparty name to a stable LEI that the entity tools key off.

- Resolves a company / organization name to ranked GLEIF LEI candidates
- Optional ISO 3166-1 alpha-2 jurisdiction filter and registration-status filter (`issued` default, `lapsed`, or `any`)
- Same strict-then-fuzzy matching model as name screening; approximate hits carry the raw Jaro-Winkler score and the same `queryTokenCoverage` count
- Matches against legal names and published other/trading names
- Paged on the same contract as `sanctions_screen_name` — `totalAvailable`, `totalAvailableBasis`, `hasMore`, `nextOffset`

---

### `sanctions_get_entity`

Who is this legal entity — plus a watchlist cross-reference in the same call.

- Full GLEIF Level 1 record: legal name, other/trading names, legal and headquarters addresses, registration status, jurisdiction, registration authority and ID, last-update date
- Cross-references the entity's legal name against all loaded watchlists (strict match only — auto-fuzzy on a generic legal name would flood the result with single-common-token false positives)
- `screeningStatus` says whether that cross-reference actually ran: an empty hit list under `not_ready` means the sanctions mirror was unavailable, not that nothing matched
- A screened entity carries `sanctionsScreen` — `totalAvailable`, `totalAvailableBasis`, `hasMore` — since the hit list is capped at twenty-five; re-screen the legal name with `sanctions_screen_name` for the full set
- LEI input is regex-validated (20 chars: 18 alphanumerics + 2 check digits)

---

### `sanctions_trace_ownership`

Beneficial-ownership screening — the cross-source workflow that single-list tools can't do.

- Traverses the GLEIF Level 2 ownership graph breadth-first to a bounded depth (1–5)
- `direction`: walk `parents` (who owns it), `children` (what it owns), or `both`
- Returns nodes (with role and depth) and directed ownership edges with relationship type
- `screenNodes: true` screens every entity in the graph against all watchlists — "is anyone in this ownership chain sanctioned?"
- Per-node screen is strict-only and reports `screenedNodeCount` / `flaggedNodeCount` so a caller can see coverage at a glance
- Reports whether the graph is the full known picture: `complete`, `truncated` (further relationships exist past the requested depth), and `missingEntityLeis` (nodes with no GLEIF Level 1 record, which carry their LEI where a legal name would be)
- `screeningStatus` separates a completed node screen from one never requested and one the sanctions mirror could not run; each screened node carries `sanctionsScreen` — `totalAvailable`, `totalAvailableBasis`, `hasMore` — since its hit list is capped at ten

---

## Resources and prompts

| Type | Name | Description |
|:---|:---|:---|
| Resource | `sanctions://designation/{source}/{entryId}` | One sanctions designation by source + entry ID (URI mirror of `sanctions_get_designation`). |
| Resource | `sanctions://entity/{lei}` | One GLEIF Level 1 entity by LEI (URI mirror of `sanctions_get_entity`'s entity payload, without the screening cross-reference). |
| Resource | `sanctions://sources` | Loaded lists + GLEIF datasets with counts and refresh timestamps (URI mirror of `sanctions_list_sources`). |
| Prompt | `sanctions_vet_counterparty` | Sequences the tools into a full counterparty due-diligence pass: resolve → trace ownership → screen the entity and every beneficial owner → summarize with provenance and the decision-support caveat. |

All resource data is also reachable via the tools, which are the primary path for tool-only MCP clients. The resources are a convenience for resource-capable clients only.

## AML HTTP API

When the server starts (including `bun run start:http`), it also binds a small REST sidecar for non-MCP callers.

- **URL:** `POST http://127.0.0.1:3011/api/aml/screen-person` (override with `AML_API_HOST` / `AML_API_PORT`)
- **Body:** `{ "name": "…", "dateOfBirth": "YYYY-MM-DD", "countryOfBirth": "…" }` — `name` is required; DOB and country are optional and only affect scoring after a name hit
- **Match mode:** strict name match against persons on all loaded watchlists (no fuzzy auto-fallback)
- **Response:** `status` (`potential_match` / `no_match`), `matchScore` (best hit: **100** name+DOB+country, **80** name+DOB, **60** name+country, **40** name only, **0** none), and `matches[]` with per-source flags

This is the same screening aid as the MCP tools: a hit is a candidate to verify; `no_match` is not a clearance. There is no auth on this sidecar — keep it on localhost or put it behind your own gateway.

Example:

```sh
curl -s -X POST http://127.0.0.1:3011/api/aml/screen-person \
  -H 'Content-Type: application/json' \
  -d '{"name":"Vijay Mallya","dateOfBirth":"1955-12-18","countryOfBirth":"India"}'
```

## Source lists

The screening surface aggregates the following lists. OFAC, EU, UK, UN, and GLEIF are official bulk feeds. India UAPA and UAE Local are harvested from OpenSanctions exports of the official MHA / EOCN lists. India FEO/NIA is a bundled curated file (not a live ED/NIA bulk feed).

| Source | Code | Role | License / notes |
|:---|:---|:---|:---|
| **OFAC SDN + Consolidated** (US Treasury) | `ofac_sdn`, `ofac_consolidated` | Primary US sanctions/watchlist — individuals, entities, vessels, aircraft, with a.k.a. aliases | US Government public domain |
| **EU Consolidated Financial Sanctions List** | `eu` | EU-designated persons and entities | Freely redistributable |
| **UK Sanctions List (UKSL, FCDO)** | `uk` | UK sanctions targets — persons, entities, ships | Open Government Licence v3.0 |
| **UN Security Council Consolidated List** | `un` | UN-designated individuals and entities across all regimes | Freely redistributable |
| **India UAPA** (MHA) | `india_uapa` | Banned organisations and designated individual terrorists under UAPA | Official MHA publication via OpenSanctions FTM export — confirm commercial redistribution terms |
| **India FEO / NIA Most Wanted** | `india_watchlist` | Curated fugitive economic offenders and NIA most-wanted names (e.g. Vijay Mallya, Nirav Modi) | Bundled compilation — not a live official bulk feed; verify against the cited source |
| **UAE Local Terrorist List** (EOCN) | `uae_local` | UAE Cabinet / UNSCR 1373 local terrorist list | Official EOCN list via OpenSanctions FTM export — confirm commercial redistribution terms |
| **GLEIF LEI (Level 1 + Level 2)** | `gleif` | Who-is-who (entity reference) and who-owns-whom (corporate ownership) | CC0 1.0 Universal |

The UK source is the **UK Sanctions List (UKSL)**, the single authoritative UK source since the OFSI Consolidated List closed on 28 January 2026.

India UAPA is **not** the Enforcement Directorate FEO list. Names such as Vijay Mallya and Nirav Modi are on `india_watchlist`, not `india_uapa`.

### First run: populate the mirror

The mirror is **not bundled** — the sanctions lists and the GLEIF golden copy are downloaded and normalized on first run. Run the init lifecycle script out-of-band before screening:

```sh
bun run mirror:init
```

This streams the sanctions lists in full (including India UAPA, India FEO/NIA, and UAE Local), rebuilds the per-alias name index, then streams the GLEIF golden copy (Level 1 entities + Level 2 ownership relationships). It is resumable and intended to run once, off the request path.

| Script | Purpose |
|:---|:---|
| `bun run mirror:init` | Full initial load of all sources (sanctions lists + GLEIF golden copy). |
| `bun run mirror:refresh` | Re-harvest the sanctions lists and apply GLEIF deltas. The sanctions half (lists + name index) also runs on a cron under HTTP transport; GLEIF deltas are manual. First source (OFAC SDN) can take several minutes with no log line until it finishes. |
| `bun run mirror:verify` | Report mirror readiness and per-source record counts. |
| `bun run mirror:seed` | Load a small synthetic fixture for local smoke tests (no downloads). |
| `bun run mirror:load-india-uae` | Load India UAPA, the bundled India FEO/NIA watchlist, and UAE Local into an existing mirror without re-harvesting OFAC/EU/UK/UN. |

Set `SANCTIONS_INIT_SKIP_GLEIF=1` on `mirror:init` to load the sanctions lists only and skip GLEIF.

> **Memory note:** every leg of `mirror:init` streams. The sanctions documents total roughly 172 MB, of which OFAC `SDN_ADVANCED.XML` is about 120 MB on its own; the GLEIF Level 1 golden copy is roughly 3.3M LEI records (~892 MB compressed, several GB decompressed). Each source is scanned one record at a time and ingested in bounded batches, so peak resident memory tracks the batch size rather than the size of any source document. Size **disk** for the mirror accordingly — GLEIF dominates there — or skip GLEIF with `SANCTIONS_INIT_SKIP_GLEIF=1` if you only need watchlist screening.

## Features

Built on [`@cyanheads/mcp-ts-core`](https://www.npmjs.com/package/@cyanheads/mcp-ts-core):

- Declarative tool, resource, and prompt definitions — single file per primitive, framework handles registration and validation
- Unified error handling — handlers throw, framework catches, classifies, and formats
- Typed error contracts with recovery hints (`mirror_not_ready`, `designation_not_found`, `lei_not_found`)
- Pluggable auth: `none`, `jwt`, `oauth` (defaults to `none` — all data is public)
- Structured logging with optional OpenTelemetry tracing
- STDIO and Streamable HTTP transports

Sanctions-specific:

- Multi-source, workflow-organized surface — one screen fans out across OFAC, EU, UK, UN, India, and UAE internally; sources surface only as provenance
- Local SQLite + FTS5 mirror via the framework `MirrorService` — offline, no live API key, no per-request rate limit
- Normalized common schema across all sanctions lists, with a denormalized per-alias name index (one row per name and per alias) so a query matches any of an entity's names in one FTS scan
- REST sidecar for person screening (`/api/aml/screen-person`) with a transparent name/DOB/country `matchScore`
- Strict-then-fuzzy matching: exact-normalized → all-tokens-present (FTS5) → Jaro-Winkler + Double-Metaphone, capped to bound work on short queries
- GLEIF Level 1 + Level 2 ingest for entity resolution and beneficial-ownership tracing

Agent-friendly output:

- Real signal, not synthetic confidence — approximate hits carry the raw Jaro-Winkler similarity (0–1) and a literal query-token coverage count, two separate measurements rather than one blended verdict; strict hits carry a `matchType` (`exact` / `strong`), never a fabricated percentage
- Ranking a caller can account for — hits order by match type, then score, then coverage, then a stable identifier, and the coverage that broke the tie is on the hit itself
- Provenance on every hit — source list, sanctioning program, designation date, the exact name/alias that matched, and its type (`primary` / `aka` / `fka` / `low-quality-aka`)
- Decision-support caveat carried in every screening tool's output — a hit is a candidate to verify, an empty result is not a clearance
- Freshness surfaced via `sanctions_list_sources` — each source's record count and the mirror's as-of timestamp, so an agent can judge staleness

## Getting started

### Public Hosted Instance

A public instance is available at `https://sanctions-screening.caseyjhand.com/mcp` — no installation required. Point any MCP client at it via Streamable HTTP, with this client config:

```json
{
  "mcpServers": {
    "sanctions-screening-mcp-server": {
      "type": "streamable-http",
      "url": "https://sanctions-screening.caseyjhand.com/mcp"
    }
  }
}
```

### Self-hosted / local

Add the following to your MCP client configuration file. The server is offline-first — populate the mirror with `bun run mirror:init` before screening (see [Source lists](#source-lists)).

```json
{
  "mcpServers": {
    "sanctions-screening-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/sanctions-screening-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "sanctions-screening-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/sanctions-screening-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# MCP listens at http://localhost:3010/mcp
# AML REST sidecar listens at http://127.0.0.1:3011/api/aml/screen-person
```

### Prerequisites

- [Bun v1.3](https://bun.sh/) or higher (or Node.js v24+).
- Disk for the local mirror (the populated SQLite files; GLEIF Level 1 dominates). No API key for any source.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/sanctions-screening-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd sanctions-screening-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env if you need to override defaults (all optional)
```

5. **Populate the mirror:**

```sh
bun run mirror:init
```

## Configuration

All sources are keyless — there is no required API key. Every variable below is optional with a sensible default.

| Variable | Description | Default |
|:---|:---|:---|
| `SANCTIONS_MIRROR_PATH` | Filesystem path for the SQLite mirror; a persistent volume on a hosted deployment. | `./data/sanctions.db` |
| `SANCTIONS_REFRESH_CRON` | Cron for the scheduled refresh of the sanctions lists + name index (HTTP transport only). GLEIF deltas are refreshed manually via `mirror:refresh`. | `0 4 * * *` |
| `SANCTIONS_FUZZY_MIN_SCORE` | Default Jaro-Winkler similarity floor for fuzzy matches when `minScore` is omitted. | `0.85` |
| `SANCTIONS_FUZZY_MAX_RESULTS` | Hard cap on fuzzy candidates scored per query, to bound work on short queries. | `50` |
| `OFAC_SDN_URL` | Override for the OFAC SDN advanced-XML file. | official SLS URL |
| `OFAC_CONSOLIDATED_URL` | Override for the OFAC Consolidated advanced-XML file. | official SLS URL |
| `EU_FSF_URL` | Override for the EU consolidated XML file (includes the static public token path component). | official EU URL |
| `UK_SANCTIONS_URL` | Override for the UK Sanctions List (UKSL) XML file. | official FCDO URL |
| `UN_SC_URL` | Override for the UN Security Council consolidated XML file. | official UN URL |
| `INDIA_UAPA_URL` | Harvest URL for India UAPA (MHA banned orgs / individuals). | OpenSanctions `in_mha_banned` FTM JSONL |
| `INDIA_WATCHLIST_URL` | Provenance label for the bundled India FEO / NIA list (not a download URL). | `bundled:india-watchlist …` |
| `UAE_LOCAL_URL` | Harvest URL for the UAE Local Terrorist List. | OpenSanctions `ae_local_terrorists` FTM JSONL |
| `GLEIF_GOLDEN_COPY_BASE_URL` | Override for the GLEIF golden-copy / delta download API. | `https://goldencopy.gleif.org` |
| `AML_API_HOST` | Bind address for the AML REST sidecar. | `127.0.0.1` |
| `AML_API_PORT` | Port for the AML REST sidecar. | `3011` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_SESSION_MODE` | Session mode: `auto` (resolves to stateful), `stateful`, or `stateless`. The shipped `.env.example` and Docker image pin stateless — no tool here needs a multi-round-trip input. | `stateless` |
| `MCP_HTTP_PORT` | Port for the HTTP server. | `3010` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |

OFAC/EU/UK/UN URLs default to the verified official endpoints. India UAPA and UAE Local default to OpenSanctions exports of those official lists. The EU "token" is a static public path component, not a credential.

See [`.env.example`](./.env.example) for the full list of optional overrides.

## Running the server

### Local development

- **Build and run:**

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck   # Lint, format, typecheck, security, changelog sync
  bun run test       # Vitest test suite
  bun run lint:mcp   # Validate MCP definitions against spec
  ```

### Docker

Preferred path is Compose (MCP **3010**, AML **3011**, persistent mirror volume). A failed **build** exits immediately and does not start containers. Runtime crashes restart (`unless-stopped`). Populate the mirror **once** after first start.

```sh
docker compose build
docker compose up -d sanctions
docker compose ps
curl -s http://127.0.0.1:3010/healthz

# First time only — several minutes; OFAC SDN is quiet until it finishes
docker compose --profile init run --rm mirror-init

curl -s -X POST http://127.0.0.1:3011/api/aml/screen-person \
  -H 'Content-Type: application/json' \
  -d '{"name":"Vijay Mallya"}'
```

If OFAC/EU/UK/UN are already in the volume and you only need India/UAE/FEO:

```sh
docker compose exec sanctions bun run scripts/mirror-load-india-uae.ts
```

On a server, keep **3011** off the public internet (security group / private VPC). Bind is `0.0.0.0` inside the container so other hosts on the mapped ports can reach AML.

Raw `docker run` (MCP only unless you also publish 3011 and set `AML_API_HOST=0.0.0.0`):

```sh
docker build -t sanctions-screening-mcp-server .
docker run --rm -p 3010:3010 -p 3011:3011 \
  -e AML_API_HOST=0.0.0.0 \
  -v sanctions-data:/usr/src/app/data \
  sanctions-screening-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/sanctions-screening-mcp-server`. The image runs under Bun, so the mirror uses `bun:sqlite` (no native build). OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/index.ts` | `createApp()` entry point — registers tools/resources/prompts, inits the screening service, schedules the HTTP refresh, starts the AML REST sidecar. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `src/http/aml-api.ts` | REST sidecar — `POST /api/aml/screen-person`. |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`) — the six screening/resolution tools. |
| `src/mcp-server/resources` | Resource definitions (`*.resource.ts`) — the three URI mirrors. |
| `src/mcp-server/prompts` | Prompt definitions (`*.prompt.ts`) — the counterparty vetting prompt. |
| `src/services/screening` | The screening service — local mirror, normalized schema, source ingesters (OFAC/EU/UK/UN/India/UAE/GLEIF), and the strict/fuzzy matching engine. |
| `scripts/mirror-*.ts` | Mirror lifecycle CLI — init, refresh, verify, seed, plus `mirror-load-india-uae`. |
| `docker-compose.yml` | MCP + AML stack with a persistent data volume and a one-shot `mirror-init` profile. |
| `tests/` | Unit and integration tests mirroring `src/`. |

## Development guide

See [`CLAUDE.md`/`AGENTS.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools and resources via the barrels in `src/mcp-server/*/definitions/index.ts`
- Wrap external sources: validate raw → normalize to the common schema → return the output schema; never fabricate fields a source omits, and never synthesize a confidence score

## Attribution

This server redistributes open data from the following sources, cited here per their terms:

- **OFAC** SDN and Consolidated lists — US Department of the Treasury, Office of Foreign Assets Control (US Government public domain).
- **EU** Consolidated Financial Sanctions List — European Commission / EEAS (freely redistributable).
- **UK Sanctions List** — UK Foreign, Commonwealth & Development Office, licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) (attribution required).
- **UN** Security Council Consolidated List — United Nations Security Council (freely redistributable).
- **India UAPA** — Ministry of Home Affairs, Government of India (harvested via [OpenSanctions](https://www.opensanctions.org/datasets/in_mha_banned/); confirm commercial use of that export).
- **India FEO / NIA Most Wanted** — curated compilation from public Government of India / parliamentary reporting (not a live ED or NIA bulk feed).
- **UAE Local Terrorist List** — Executive Office for Control & Non-Proliferation (harvested via [OpenSanctions](https://www.opensanctions.org/datasets/ae_local_terrorists/); confirm commercial use of that export).
- **GLEIF** LEI data — Global Legal Entity Identifier Foundation, [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).

## Contributing

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](./LICENSE) for details.
