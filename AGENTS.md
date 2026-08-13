# d2domains — AGENTS.md

Domain registrar-style product ("d2domains"). This file is the source of truth for project structure, conventions, and direction. Read it before writing code.

## Repo layout

```
d2d/
  .env                     # top-level env, source of truth (name.com creds, per-service DB URLs)
  docker-compose.yml       # dev stack: real name.com DEV API
  docker-compose.mock.yml  # override: heron -> mockingbird (fake registry)
  docker-compose.prod.yml  # override: real name.com PROD API, no-watch, restart policies
  init/postgres/*.sql      # creates per-service DBs on fresh postgres volume
  client/                  # Next.js 16 (App Router), React 19, shadcn/ui (base-ui), Tailwind v4
  system/                  # backend microservices — ALL named after animals
```

`.env` at the root is used everywhere: local dev via `bun --env-file=../../.env`, and in docker via `env_file: ./.env` with per-service `environment` overrides for the container hostnames.

## Services

Every service is a folder under `system/<animal>/`, runs on Bun, HTTP via Hono, validation via zod, and reads a typed env via `src/config/env.ts` (`loadEnv()` must fall back to `process.env` when `Bun` is undefined — drizzle-kit loads the config outside Bun).

| Service | Port | Owns | Storage | Role |
|---|---|---|---|---|
| **hog** | 8787 | auth (users/sessions), BFF/API surface | Postgres `d2gres` | API gateway. Only thing the client talks to (via `src/proxy.ts`) |
| **heron** | 8783 | registry integration | none (Redis for rate limiter) | ONLY service that talks to name.com. Retry/backoff, circuit breaker, normalization, token-bucket rate limit |
| **weasel** | 8781 | domains + orders | Postgres `d2weasel` | Source of truth for what users own |
| **wombat** | 8782 | charges/ledger | Postgres `d2wombat` | Fake payment, always succeeds, idempotent by orderId |
| **badger** | — | nothing (stateless worker) | none | BullMQ `purchases` consumer: charge → register → create domain → mark purchased |
| **beaver** | — | nothing (stateless worker) | sqlite `search_logs` | BullMQ `domains-jobs` consumer (search analytics) |
| **mockingbird** | 8890 | fake name.com | sqlite | Implements name.com v4 API (search/checkAvailability/create/DNS) for mock compose |
| **otter** | 8784 | DNS zones + records | Postgres `d2otter` | Source of truth for DNS; syncs to name.com via heron |

### Storage rule (important)
Durable production data = **Postgres** (one instance, one DB per service). **sqlite only** for disposable/dev-only data (mockingbird, beaver). heron/badger are stateless. Do not add sqlite to a service whose data must survive in production.

### Shared conventions per service
- `src/config/env.ts` — zod `EnvSchema`, exported `loadEnv()`
- `src/lib/` — pure helpers (e.g. `http.ts` = `HttpError`), no deps on services
- `src/adapters/` — HTTP clients for OTHER services / external systems (e.g. `registry.ts` for heron, `weasel.ts`, `namecom.ts` in heron). "client" is reserved for the web app.
- `src/services/` — business logic orchestrators (`.service.ts`)
- `src/web-routers/` — Hono route definitions → `src/controllers/` handlers
- Postgres services: drizzle + postgres.js, `drizzle.config.ts`, migrations generated with `bun run db:generate`, run at boot via `migrate(db, { migrationsFolder: "./drizzle" })`
- Hono `c.json` status: cast with `ContentfulStatusCode` (hono's typing rejects raw `number`)
- `c.req.param()` is typed `string | undefined` — guard it

## Environment keys (top-level .env)

- `NAME_COM_USERNAME`, `NAME_COM_TOKEN`, `NAME_COM_BASE` — used by heron/mockingbird. Dev = `https://api.dev.name.com`, prod = `https://api.name.com`. Note: the dev token is slow to become valid after creation.
- `DATABASE_URL` (hog d2gres), `WEASEL_DATABASE_URL`, `WOMBAT_DATABASE_URL`, `OTTER_DATABASE_URL`
- Service URLs default in code: `REGISTRY_URL=http://localhost:8783`, `WEASEL_URL=http://localhost:8781`, `WOMBAT_URL=http://localhost:8782`, `OTTER_URL=http://localhost:8784`, `HOG_URL=http://localhost:8787` (client)
- Rate limiting: heron `REGISTRY_RATE_BURST`/`REGISTRY_RATE_REFILL` (token bucket); hog `SEARCH_RATE_LIMIT_PER_MINUTE` (per-IP)

## Data flow / key behaviors

- **Auth**: DB-backed opaque sessions, httpOnly cookie `hog_session`, argon2id via `Bun.password`. Cookie set by hog; client proxies so it stays first-party. Client server-side session helpers in `client/src/lib/session.ts` fetch hog directly with the cookie (`getCurrentUser`, `getMyDomains`, `getMyOrders`) wrapped in React `cache()`.
- **Search**: public. client → hog `POST /api/v1/domains/search` → Redis cache (key `domain:search:{keyword}:{tlds}`) → heron `/v1/search` → name.com. Results normalized to a stable DTO: `purchasable`, `premium`, `purchasePrice`/`renewalPrice` (null when unavailable), `purchaseType`. name.com omits fields for unavailable domains; normalize so the client contract is stable. **Search cache is cleared on buy** (`clearSearchCache`).
- **Buy**: `POST /api/v1/domains/buy` (auth) → `checkAvailability` for authoritative price/type (never trust client price) → order in weasel (idempotency key `user:domain`, pending) → enqueue `purchases` → `202 {order}`. badger: charge wombat → register at heron `/v1/register` (purchasePrice + purchaseType; 409/400 = terminal → order failed, transient = BullMQ backoff) → create domain in weasel (expiresAt = now + years) → mark order purchased.
- **Dashboard**: `/account` (server component) renders domains + pending/failed orders from `getMyDomains()`/`getMyOrders()`.
- **DNS**: `/account/[domainName]` detail page → hog `GET/POST/PATCH/DELETE /api/v1/domains/:name/dns` (ownership checked via weasel) → otter (source of truth, Postgres) → local write + enqueue `dns-sync` job → otter in-process worker → heron `/v1/dns/:domain/records` → name.com. Records have `syncStatus` pending|synced|error and `registryRecordId`. First view pulls/imports existing name.com records.
- **Registrar settings**: `/api/v1/domains/:name/settings` GET/PATCH (ownership checked via weasel) → heron `/v1/domains/:name` + toggle/setNameservers endpoints → name.com (autorenew, whois privacy, transfer lock, nameservers). hog maps settings patch fields to heron `{enabled}`/`{nameservers}` payloads.
- **Queues**: BullMQ + Redis. `domains-jobs` (beaver), `purchases` (badger), `dns-sync` (otter). Queues are for async writes only — sync request-path reads use cache + rate limiting, never queues.

## Docker compose

- Default (`docker-compose.yml`) = dev against real name.com dev API. `docker compose up --watch` hot-reloads (compose sync + `bun --watch`).
- Mock: `docker compose -f docker-compose.yml -f docker-compose.mock.yml up --watch` — only heron's upstream changes (`NAME_COM_BASE: http://mockingbird:8890`), consumers still point at heron.
- Prod: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` — non-watch commands, `restart: unless-stopped`, `COOKIE_SECURE: "true"`, prod creds from .env.
- Postgres runs init scripts only on a **fresh** volume (`init/postgres/01-create-dbs.sql`). If a `d2d_pgdata` volume predates a new DB, `docker compose down -v` to re-init.
- Ports on host: postgres 5433, redis 6380 (avoid clashing with local postgres/redis on 5432/6379).

## Client (Next.js 16 — READ `client/node_modules/next/dist/docs/` before writing client code)

- `src/proxy.ts` (Next 16 proxy file convention) forwards `/api/:path*` → `HOG_URL` (server-side, passes cookies both ways). Do not use middleware (deprecated).
- `cookies()` is async (`await cookies()`).
- `client/src/lib/session.ts` — server-only session/user/domain helpers.
- `client/src/lib/buy-domain.ts` — shared `buyDomain()` with one 401 retry (cookie propagation); use it, don't inline buy fetches.
- `pendingBuy` in localStorage → `/login` → `AuthForm` completes it after login/register.
- `next.config.ts` has a `redirects()` (e.g. `/account/domains` → `/account`). Restart the dev server after editing next.config.

## Test commands

- Unit tests: `bun test` in `system/hog`, `system/heron`, `system/mockingbird`.
- Typecheck: `bunx tsc --noEmit` in each service; `npx tsc --noEmit` + `npm run lint` in client.
- Local dev requires: local Postgres with DBs created (`createdb d2gres d2weasel d2wombat d2otter`), local redis. `docker compose` handles all of it in containers.

## Direction / roadmap

Completed: login, public search, buy flow, dashboard, DNS management (otter + sync to name.com via heron, domain detail page), registrar settings (autorenew, whois privacy, transfer lock, nameservers).
Up next (agreed order):
- **Hardening** (next): shared internal-auth token between services, tests for the purchase/DNS worker sagas, observability (logs/metrics/traces), DNS-sync idempotency (crash between registry create and storing id can duplicate records).
- **Deploy** is intentionally deferred for now (managed Postgres, hosts, CI, TLS) — everything runs locally/compose.
- **Billing depth**: wombat is a fake always-succeeds payment; real provider + ledger depth later.
- **Client polish**: order history page (orders exist in the API), whois info on the detail page, rate-limit DNS/settings endpoints, per-domain search-cache invalidation.
- **Future service extractions** on trigger (don't pre-build): notifications (nightingale), identity (meerkat), events (kestrel), etc.
Long-term product goals: sell/include **email services** and **hosting services** alongside domains.

## Gotchas / history

- name.com dev token was dead initially → mockingbird was built as a drop-in. Test buys against mockingbird; real-dev-API buys attempt real sandbox registrations.
- Redis search cache served stale availability across registry-source switches → cache key later included the source, then became source-agnostic again once heron was the single entry point; buy clears the cache.
- `attempts`/`backoff` are BullMQ **job** options (queue.add), not Worker options (v6).
- Swallowed fetch errors in client buy flows caused "purchase forgotten" bugs — always surface via `buyDomain()` and show pending orders.
