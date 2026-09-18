# sanctions-screening-service

Internal **person sanctions screening** service. Callers (KanzPay Backend) hit a REST API; lists live in a local SQLite mirror — no live vendor API key for OFAC/EU/UK/UN/India/UAE feeds.

> **Screening aid, not a compliance determination.** A hit is a candidate to verify against the official source. `no_match` is never a clearance.

Version **0.1.12** · Apache-2.0 · Bun ≥ 1.3 / Node ≥ 24

This tree started from the open-source [sanctions-screening-mcp-server](https://github.com/cyanheads/sanctions-screening-mcp-server). Production use here is the REST sidecar, not the public npm MCP package.

---

## What you call

| | |
|:---|:---|
| Method / path | `POST /api/aml/screen-person` |
| Default listen | `http://127.0.0.1:3011` (`AML_API_HOST` / `AML_API_PORT`) |
| Body | `{ "name": string, "dateOfBirth"?: "YYYY-MM-DD", "countryOfBirth"?: string }` — `name` required |
| Match | Strict person-name match on all loaded watchlists (no fuzzy auto-fallback) |
| Response | `status`: `potential_match` \| `no_match`; `matchScore` 100 / 80 / 60 / 40 / 0; `matches[]` |

**Auth:** set `AML_API_KEY` (same value as the calling backend). Send it as `X-API-Key` or `Authorization: Bearer <key>`. Wrong/missing → `401 { "error": "Unauthorized" }`. If the env var is unset, the route is open and a warning is logged at startup.

```sh
curl -s -X POST http://127.0.0.1:3011/api/aml/screen-person \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $AML_API_KEY" \
  -d '{"name":"Vijay Mallya","dateOfBirth":"1955-12-18","countryOfBirth":"India"}'
```

Health (no API key): `GET http://127.0.0.1:3010/healthz`

The process still starts an MCP HTTP server on **3010**. KanzPay does not use it. Keep both ports off the public internet.

---

## Lists

| Source | Code | Notes |
|:---|:---|:---|
| OFAC SDN + Consolidated | `ofac_sdn`, `ofac_consolidated` | US Treasury, public domain |
| EU Consolidated Financial Sanctions | `eu` | Freely redistributable |
| UK Sanctions List (UKSL) | `uk` | OGL v3.0 |
| UN Security Council Consolidated | `un` | Freely redistributable |
| India UAPA (MHA) | `india_uapa` | OpenSanctions FTM export of the official list |
| India FEO / NIA Most Wanted | `india_watchlist` | Bundled curated file — not a live ED/NIA feed |
| UAE Local Terrorist List | `uae_local` | OpenSanctions FTM export of the EOCN list |

GLEIF (legal-entity / ownership) code is still in the tree. This service’s REST path does not need it. Compose sets `SANCTIONS_INIT_SKIP_GLEIF=1`.

India UAPA is **not** the FEO list. Names such as Vijay Mallya sit on `india_watchlist`.

---

## First run: load the mirror

Lists are **not** in git. Load them once, off the request path:

```sh
# Watchlists only (recommended for this service)
SANCTIONS_INIT_SKIP_GLEIF=1 bun run mirror:init
```

| Script | Purpose |
|:---|:---|
| `bun run mirror:init` | Full initial load (add `SANCTIONS_INIT_SKIP_GLEIF=1` to skip GLEIF) |
| `bun run mirror:refresh` | Re-harvest sanctions lists. Also runs daily at 04:00 when transport is HTTP (`SANCTIONS_REFRESH_CRON`, default `0 4 * * *`) |
| `bun run mirror:verify` | Readiness + per-source counts |
| `bun run mirror:seed` | Tiny fixture, no downloads |
| `bun run mirror:load-india-uae` | India + UAE into an existing mirror |

Until init finishes, `screen-person` returns an error that the sanctions mirror is not ready.

---

## Local run

```sh
bun install
cp .env.example .env
# set AML_API_KEY (must match the calling backend)

SANCTIONS_INIT_SKIP_GLEIF=1 bun run mirror:init   # once
MCP_TRANSPORT_TYPE=http bun run start:http
```

- API: `http://127.0.0.1:3011/api/aml/screen-person`
- Health: `http://127.0.0.1:3010/healthz`

```sh
bun run test
bun run build
```

---

## Docker (dev / server)

Compose publishes **127.0.0.1:3010** and **127.0.0.1:3011**, skips GLEIF, and refreshes lists daily at 04:00. It interpolates `AML_API_KEY` from the host `.env` (same secret as the calling backend). Inside the container the HTTP servers bind `0.0.0.0` so published ports work; the host bind stays loopback so 3010/3011 are not on the public interface.

If the backend is on another machine, change the Compose `ports` lines from `127.0.0.1:3011:3011` to `3011:3011` (and put the API behind a firewall).

```sh
docker compose build
docker compose up -d sanctions
curl -s http://127.0.0.1:3010/healthz

# Once per volume
docker compose --profile init run --rm mirror-init

curl -s -X POST http://127.0.0.1:3011/api/aml/screen-person \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $AML_API_KEY" \
  -d '{"name":"Vijay Mallya"}'
```

---

## Environment

List feeds are keyless. Only the REST key is a secret.

| Variable | Required | Default | Notes |
|:---|:---|:---|:---|
| `AML_API_KEY` | For production | unset | Shared with the caller. Unset = open API + warning |
| `MCP_TRANSPORT_TYPE` | On a server | `stdio` | Use `http` so the API + daily refresh run (Compose sets this) |
| `AML_API_HOST` | Docker/LAN | `127.0.0.1` | Compose sets `0.0.0.0` so published ports reach the process |
| `AML_API_PORT` | No | `3011` | |
| `SANCTIONS_MIRROR_PATH` | Persist data | `./data/sanctions.db` | Compose: `/usr/src/app/data/sanctions.db` |
| `SANCTIONS_INIT_SKIP_GLEIF` | Recommended | unset | `1` = skip GLEIF |
| `SANCTIONS_REFRESH_CRON` | No | `0 4 * * *` | **Daily 04:00**, not every 4 hours. Needs HTTP transport |
| `MCP_HTTP_PORT` | No | `3010` | Health + unused MCP |
| `MCP_LOG_LEVEL` | No | `info` | |

Source URL overrides (`OFAC_SDN_URL`, …) default to the official feeds. See [`.env.example`](./.env.example).

Do not commit `.env`. Put `AML_API_KEY` in the server/CI secret store.

---

## Layout

| Path | Role |
|:---|:---|
| `src/http/aml-api.ts` | REST `screen-person` |
| `src/services/screening/` | Mirror, ingest, matching |
| `src/index.ts` | Boots MCP (3010) then the REST sidecar (3011) |
| `scripts/mirror-*.ts` | Init / refresh / verify / seed |
| `docker-compose.yml` | HTTP stack + `mirror-init` profile |

MCP tools under `src/mcp-server/` still register at process start. They are unused by KanzPay.

---

## Attribution

Redistributed open data, cited per source terms:

- **OFAC** — US Treasury (public domain)
- **EU** Consolidated Financial Sanctions List — European Commission / EEAS
- **UK Sanctions List** — FCDO, [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)
- **UN** Security Council Consolidated List
- **India UAPA** — MHA via [OpenSanctions](https://www.opensanctions.org/datasets/in_mha_banned/)
- **India FEO / NIA Most Wanted** — curated public sources (not a live bulk feed)
- **UAE Local Terrorist List** — EOCN via [OpenSanctions](https://www.opensanctions.org/datasets/ae_local_terrorists/)

Matching engine originally from Casey Hand (`@cyanheads`); this service uses [`@cyanheads/mcp-ts-core`](https://www.npmjs.com/package/@cyanheads/mcp-ts-core) as a runtime library.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
