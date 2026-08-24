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
| **wombat** | 8782 | payment methods, charges, ledger | Postgres `d2wombat` | Fake processor (configurable decline via `FAKE_PAYMENT_FAIL_MIN_CENTS`), idempotent by orderId, refunds, ledger entries |
| **badger** | — | nothing (stateless worker) | none | BullMQ `purchases` consumer: charge → register → create domain → mark purchased |
| **beaver** | — | nothing (stateless worker) | sqlite `search_logs` | BullMQ `domains-jobs` consumer (search analytics) |
| **mockingbird** | 8890 | fake name.com | sqlite | Implements name.com v4 API (search/checkAvailability/create/DNS) for mock compose |
| **otter** | 8784 | DNS zones + records | Postgres `d2otter` | Source of truth for DNS; syncs to name.com via heron |
| **pigeon** | — (worker-only) | email add-on provisioning | Postgres `d2pigeon` | BullMQ `email-jobs` consumer: mailbox + MX/SPF/DKIM/DMARC records for purchased orders; idempotent by orderId |

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
- `DATABASE_URL` (hog d2gres), `WEASEL_DATABASE_URL`, `WOMBAT_DATABASE_URL`, `OTTER_DATABASE_URL`, `PIGEON_DATABASE_URL`
- Service URLs default in code: `REGISTRY_URL=http://localhost:8783`, `WEASEL_URL=http://localhost:8781`, `WOMBAT_URL=http://localhost:8782`, `OTTER_URL=http://localhost:8784`, `PIGEON_URL=http://localhost:8785`, `HOG_URL=http://localhost:8787` (client)
- Rate limiting: heron `REGISTRY_RATE_BURST`/`REGISTRY_RATE_REFILL` (token bucket); hog `SEARCH_RATE_LIMIT_PER_MINUTE` (per-IP)

## Data flow / key behaviors

- **Auth**: DB-backed opaque sessions, httpOnly cookie `hog_session`, argon2id via `Bun.password`. Cookie set by hog; client proxies so it stays first-party. Client server-side session helpers in `client/src/lib/session.ts` fetch hog directly with the cookie (`getCurrentUser`, `getMyDomains`, `getMyOrders`) wrapped in React `cache()`.
- **Search**: public. client → hog `POST /api/v1/domains/search` → Redis cache (key `domain:search:{keyword}:{tlds}`) → heron `/v1/search` → name.com. Results normalized to a stable DTO: `purchasable`, `premium`, `purchasePrice`/`renewalPrice` (null when unavailable), `purchaseType`. name.com omits fields for unavailable domains; normalize so the client contract is stable. **Search cache is cleared on buy** (`clearSearchCache`).
- **Buy**: `POST /api/v1/domains/buy` (auth) → `checkAvailability` for authoritative price/type (never trust client price) → order in weasel (idempotency key `user:domain`, pending; `priceCents` = registry amount, `totalCents` = domain + add-ons, `addons` jsonb line items, `paymentMethodId`) → enqueue `purchases` → `202 {order}`. badger: charge wombat `totalCents` + paymentMethodId → register at heron `/v1/register` (purchasePrice + purchaseType; 409/400 = terminal → order failed, transient = BullMQ backoff) → create domain in weasel (expiresAt = now + years) → mark order purchased. When the order has an email add-on, hog also enqueues `email-jobs` at buy time.
- **Email provisioning**: pigeon (`email-jobs` consumer) fetches the order → waits until `purchased` (pending = retry, failed = never provision) → for each email add-on: record provisioning state in `d2pigeon` (keyed by orderId), create `admin@<domain>` mailbox, write MX `@` / TXT `@` SPF / TXT `_dkim` / TXT `_dmarc` through otter (skipping records that already exist) → mark provisioned. Replayed jobs no-op. Placeholder record values live in pigeon env (`MAIL_HOST`, `MAIL_SPF_TXT`, `MAIL_DKIM_TXT`, `MAIL_DMARC_TXT`) — no real mail infra yet; swap in a provider later.
- **Dashboard**: `/account` (server component) renders domains + pending/failed orders from `getMyDomains()`/`getMyOrders()`.
- **DNS**: `/account/[domainName]` detail page → hog `GET/POST/PATCH/DELETE /api/v1/domains/:name/dns` (ownership checked via weasel) → otter (source of truth, Postgres) → local write + enqueue `dns-sync` job → otter in-process worker → heron `/v1/dns/:domain/records` → name.com. Records have `syncStatus` pending|synced|error and `registryRecordId`. First view pulls/imports existing name.com records.
- **Registrar settings**: `/api/v1/domains/:name/settings` GET/PATCH (ownership checked via weasel) → heron `/v1/domains/:name` + toggle/setNameservers endpoints → name.com (autorenew, whois privacy, transfer lock, nameservers). hog maps settings patch fields to heron `{enabled}`/`{nameservers}` payloads.
- **Queues**: BullMQ + Redis. `domains-jobs` (beaver), `purchases` (badger), `dns-sync` (otter), `email-jobs` (pigeon). Queues are for async writes only — sync request-path reads use cache + rate limiting, never queues.

## Docker compose

- Default (`docker-compose.yml`) = dev against real name.com dev API. `docker compose up --build --watch` hot-reloads (compose sync + `bun --watch`); use `--build` so newly-committed code is in the image, not just the stale one.
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

- Unit tests: `bun test` in `system/hog`, `system/heron`, `system/mockingbird`, `system/pigeon`.
- Typecheck: `bunx tsc --noEmit` in each service; `npx tsc --noEmit` + `npm run lint` in client.
- Local dev requires: local Postgres with DBs created (`createdb d2gres d2weasel d2wombat d2otter d2pigeon`), local redis. `docker compose` handles all of it in containers.

## Direction / roadmap

Completed: login, public search, buy flow, dashboard, DNS management (otter + sync to name.com via heron, domain detail page), registrar settings (autorenew, whois privacy, transfer lock, nameservers).
Hardening (done): internal-auth token (`x-internal-token`, `INTERNAL_TOKEN` env) enforced on heron/weasel/wombat/otter and sent by hog/badger/otter; worker saga tests (badger purchase, otter dns-sync via `createSyncProcessor`); request-id propagation (`x-request-id` through hog→weasel/otter/heron) + structured JSON request logs + hog `/metrics` (Prometheus text); DNS-sync idempotency (reconcile-adopt on duplicate create).
Billing depth (done): wombat payment methods (CRUD + default), charge lifecycle (pending→succeeded/failed/refunded) behind a `PaymentProcessor` interface with a fake processor that declines charges ≥ `FAKE_PAYMENT_FAIL_MIN_CENTS` (0 = never), refunds, and a `ledger_entries` audit log. badger treats a declined charge as terminal (order failed). Real provider (Stripe) = a new `PaymentProcessor` impl.
Client polish (done): order history page (`/account/orders`), whois/registrant contacts on the domain detail page, per-user rate limits on DNS/settings (namespaced buckets), per-domain search-cache invalidation on buy.
Email add-on (done): catalog (hog `EMAIL_PLANS`), quote/buy with addons (`totalCents`, `addons`, `paymentMethodId` on weasel orders), badger charges `totalCents` + passes `paymentMethodId`, `email-jobs` enqueue at buy, and pigeon (BullMQ `email-jobs` consumer) provisions `admin@<domain>` + MX/SPF/DKIM/DMARC via otter with idempotent replay. Real mail infra (provider-backed or self-hosted) is deferred; placeholder DNS values live in pigeon env.
Up next (agreed order):
- **Deploy** is intentionally deferred (managed Postgres, hosts, CI, TLS) — everything runs locally/compose.
- **Future service extractions** on trigger (don't pre-build): notifications (nightingale), identity (meerkat), events (kestrel), etc.
Long-term product goals: sell/include **email services** and **hosting services** alongside domains.

## Gotchas / history

- `docker compose up --watch` runs whatever is in the image; if the image predates newly-committed code, containers serve stale routes/endpoints (symptom: 404s that work when you test the service directly). Rebuild with `docker compose up --build --watch`. `--build` only matters on `up`, not while watching — source edits hot-reload via sync + `bun --watch`, and `package.json` changes trigger a rebuild action.
- name.com returns `{}` (no `records` key) for a domain with no DNS records — not `{records: []}`. heron/otter handle it defensively; mockingbird mirrors the quirk so mock dev exercises the same path.
- name.com dev token was dead initially → mockingbird was built as a drop-in. Test buys against mockingbird; real-dev-API buys attempt real sandbox registrations.
- Redis search cache served stale availability across registry-source switches → cache key later included the source, then became source-agnostic again once heron was the single entry point; buy clears the cache.
- `attempts`/`backoff` are BullMQ **job** options (queue.add), not Worker options (v6).
- Swallowed fetch errors in client buy flows caused "purchase forgotten" bugs — always surface via `buyDomain()` and show pending orders.
# AWS Guidance for the new AWS experience

This user has signed up for the new AWS experience. This experience lets you sign into AWS using a social provider and requires the following additional context.

## Context

### Terminology:

- Say "project" instead of "account" — a project contains an AWS account and settings for sharing with other collaborators
- Say "team member" instead of "IAM user" — users are invited by email, not created or federated in IAM
- Say "AWS Settings" when referring to management tasks at [settings.aws.com](https://settings.aws.com/) (project management, billing, team members, spend limits). Users view their actual AWS resources in the AWS Management Console.
- Say "selected Region" when referring to the user's Region — not "home Region"
- The user has a managed IAM experience. This includes a managed service control policies (SCP) and resource control policies (RCP) that govern the use of AWS. They will still need to use IAM to create policies to let services work with each other. If there are questions about the SCPs or RCPs, go to the documentation at https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html

### Constraints:

- All projects share a single AWS Region determined by the user's contact address. Resources cannot be created in other Regions
- When developing:
  - MUST create all Regional resources in the project's assigned Region
  - MUST NOT attempt to create Lambda, API Gateway, or other Regional resources in any other Region
  - MUST direct users to confirm their Region in AWS Settings > View all projects > Overview > Additional Info > Region. If the user cannot confirm their Region, check in ~/.aws/config
  - MUST NOT use Lambda@Edge — excluded from both Lambda and CloudFront
  - MUST NOT use CloudFormation StackSets — no multi-account or multi-Region deployments
  - MUST NOT attempt cross-Region actions — no cross-Region replication for DynamoDB/S3/RDS, no multi-Region KMS keys
  - MUST NOT use Route 53 cross-Region routing — geolocation, latency-based, and failover routing policies are not available
  - CloudFront is a global service and its actions ARE allowed in `us-east-1`. A user can create a CloudFront distribution pointing to their project-region Lambda function URL or API Gateway. However, Lambda and API Gateway themselves MUST NOT be created in `us-east-1` — they must be in the project Region.
  - Reduced availability in `eu-north-1` specifically: Amazon Rekognition, Amazon Textract, Amazon Personalize, AWS App Runner are not available in that Region.
- IAM permissions for human access are managed by AWS. Don't assign roles to team members unless absolutely necessary
- The user may have a spend limit if they are on the paid plan. The limit that pauses their project if it's exceeded. If resources suddenly become inaccessible, ask if they have a spend limit configured. Only project owners can modify a spend limit.
- When developing:
  - MUST ask about spend limit status if the user reports sudden "Access Denied" errors on operations that previously worked
  - MUST direct users to check spend status in AWS Settings > Billing
  - MUST check if the user has upgraded their account to the paid plan
  - MUST ask the user if they want to clean up the successfully created resources or keep them to reduce cost
- The user sets up billing, creates spend limits, and retrieves and pays invoices in AWS Settings. The user creates budgets and optimizes their costs in the AWS Billing and Cost Management console
- Not all AWS services are available. If a service isn't working, do the following:
  1. Run the command `aws freetier get-account-plan-state`
  2. If accountPlanType": "FREE", check the [Free Tier supported services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#supported-services-free-tier) next,
  3. If accountPlanType": "PAID", check the [Paid Tier supported services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#supported-services-paid-plan).
  4. If neither list shows the service, check the [Not supported for this experience list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#unsupported-services). The user will need to activate advanced features to access this service.
- Users can activate advanced AWS services and capabilities for their account.
- Before starting a task, check whether a relevant AWS skill is available. Load the skill with retrieve_skill and prefer its guidance over general knowledge.

### Help level

- help_level (required): LOW, MEDIUM, or HIGH. While a user is building, you MUST ask the user: "How much guidance would you like from me? Low (I only flag security risks), medium (I ask a couple of clarifying questions if something seems off), or high (I explain what I'm doing, suggest alternatives, and flag best practices)."

You CAN update this rule file to save a user's help_level.

Constraints for each level:

**LOW:**

- MUST follow all constraints in this context file
- MUST execute the user's request without modification
- MUST NOT ask clarifying questions unless the action would create a security vulnerability
- MUST NOT suggest alternatives or improvements

**MEDIUM:**

- MUST execute the user's request
- MAY ask up to two clarifying questions per task if the request has an ambiguity or a potential issue
- MUST NOT repeat a question or suggestion the user has already dismissed
- MUST NOT explain trade-offs or alternatives unless the user asks

**HIGH:**

- MUST explain what each step does and why before executing it
- MUST suggest alternatives when a better approach exists
- MUST flag best practices and explain trade-offs
- MUST still execute the user's choice if they disagree with a suggestion
