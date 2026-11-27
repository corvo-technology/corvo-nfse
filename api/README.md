# Corvo NFS-e — API and worker

<p>
  <img alt="NestJS 11" src="https://img.shields.io/badge/NestJS-11-e0234e" />
  <img alt="Node.js 24" src="https://img.shields.io/badge/node-24-339933" />
  <img alt="License: AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-blue" />
</p>

NestJS backend that registers companies, calculates taxes, issues NFS-e on the national standard (and NF-e and NFC-e in test mode) and reports the result by webhook. Part of the [Corvo monorepo](../README.md); the dashboard is in [`web/`](../web/README.md).

## 📑 Contents

- [🧱 Stack](#-stack)
- [⚙️ Runtimes](#-runtimes)
- [🚀 Quick start](#-quick-start)
- [⌨️ Commands](#-commands)
- [🔧 Configuration](#-configuration)
- [🗂️ Code layout](#-code-layout)
- [🧾 How an invoice is issued](#-how-an-invoice-is-issued)
- [🔌 HTTP contract](#-http-contract)
- [🤖 MCP server](#-mcp-server)
- [🗄️ Database](#-database)
- [🧪 Testing](#-testing)
- [🐳 Docker](#-docker)

## 🧱 Stack

PostgreSQL with TypeORM and row-level security, Redis with BullMQ, S3-compatible document storage, the [`open-nfse`](https://www.npmjs.com/package/open-nfse) library for the national NFS-e integration, the official tax calculator (RTC) for IBS/CBS, Stripe for billing (cloud mode only; `DEPLOYMENT_MODE=self_hosted` turns billing off), and OpenTelemetry and Sentry for observability.

## ⚙️ Runtimes

| Entry point | Responsibility | Default port |
| --- | --- | --- |
| `src/main.ts` | HTTP API and REST endpoints | 3000 |
| `src/main.worker.ts` | Queue consumers, scheduled jobs and health endpoints | 3002 |
| `src/main.dev.ts` | API and worker together for development | 3000 and 3002 |

The worker completes invoice processing, document preparation, email and webhook delivery, sales-platform event processing, the daily data cleanup and, in cloud mode, the hourly billing reconciliation. Production runs API and worker as separate processes. The development bootstrap rejects `NODE_ENV=production`.

## 🚀 Quick start

From the repository root, `yarn setup` installs both applications. Create `api/.env` from [.env.example](.env.example), then start the infrastructure and the API:

```bash
yarn infra:up        # PostgreSQL, Redis and LocalStack
yarn migration:run   # needs MIGRATION_DATABASE_URL (schema owner)
yarn dev:api         # API and worker with watchers
```

Prepare the runtime database role once with `scripts/provision-runtime-role.sql`. To run the whole stack in Docker instead, follow the [root README](../README.md#-quick-start).

## ⌨️ Commands

Run inside `api/`, or use the equivalent root commands:

| Command | Action |
| --- | --- |
| `yarn start:dev` | API and worker with watchers (port 3000 and 3002). |
| `yarn start:api:dev` / `start:worker:dev` | Run only the API or only the worker. |
| `yarn build` | Compile, resolve path aliases and verify the build artifacts. |
| `yarn start:prod` / `start:worker:prod` | Run the compiled API or worker. |
| `yarn lint:check` | Check ESLint (`yarn lint` also fixes). |
| `yarn typecheck` | Check production code; `typecheck:tests` includes tests. |
| `yarn test` | Unit tests (use `--runInBand` in CI). |
| `yarn test:e2e` | End-to-end suites against a local test database. |
| `yarn test:fiscal:integration` | Fiscal integration suite. |
| `yarn migration:show` / `run` / `revert` / `create` | Manage database migrations. |
| `yarn openapi:generate` | Regenerate the public OpenAPI (`docs/openapi`, `web/public/openapi.json`). CI fails when it is out of date. |
| `yarn test:api-key` | Smoke-test an API key against a running API. |
| `yarn stripe:provision` | Create the Stripe products and prices. |

## 🔧 Configuration

Copy [.env.example](.env.example) to `.env` for development outside Docker. The main groups:

| Group | Variables |
| --- | --- |
| Runtime | `NODE_ENV`, `PORT`, `WORKER_PORT`, `API_PREFIX`, `CORS_ORIGINS`, `PUBLIC_API_URL`, `DASHBOARD_URL`, `APP_URL` |
| Deployment mode | `DEPLOYMENT_MODE` (`cloud` or `self_hosted`), `PLATFORM_ADMIN_EMAILS`, `OPS_ALERT_EMAILS` |
| Database | `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `DB_SCHEMA`, `DB_POOL_*`, `E2E_DATABASE_URL` |
| Database TLS | `DB_SSL`, `DB_SSL_CA`, `DB_SSL_REJECT_UNAUTHORIZED` |
| Redis | `REDIS_URL`, `REDIS_KEY_PREFIX` |
| Secrets | `AUTH_JWT_SECRET`, `AUTH_CSRF_SIGNING_SECRET`, `SECRETS_ENCRYPTION_KEY`, `NFSE_MASTER_KEY`, `OTP_HMAC_SECRET` |
| Storage | `STORAGE_PROVIDER`, `STORAGE_S3_*`, `STORAGE_PUBLIC_BASE_URL` |
| Email and sign-in | `RESEND_API_KEY`, `RESEND_BASE_URL`, `EMAIL_FROM`, `MAGIC_LINK_*`, `GOOGLE_*`, `GITHUB_*` |
| Billing (cloud mode only) | `STRIPE_SECRET_KEY`, `STRIPE_PLATFORM_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIGURATION_ID`, `STRIPE_CHECKOUT_*` |
| NF-e and NFC-e | `NFE_PRODUCTION_ENABLED` (default `false`: production blocked), `NFE_TEST_PROVIDER`, `NFE_SEFAZ_TIMEOUT_MS`, `NFE_RESP_TEC_*` |
| Tax calculator | `RTC_CALCULATOR_URL`, `RTC_CALCULATOR_*`, `FISCAL_DPS_LAYOUT`, `FISCAL_IBSCBS_UNAVAILABLE_MODE` |
| Outbox and scheduling | `OUTBOX_RELAY_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_SCHEDULE_MAX_DAYS`, `NFSE_EMISSION_CONCURRENCY`, `TEST_QUEUE_CONCURRENCY`, `NFSE_PORTAL_BREAKER_*`, `NFSE_UNCERTAIN_MAX_HOURS`, `PORTAL_SYNC_ENABLED`, `MANUAL_REVIEW_SWEEP_*`, `GOV_RATE_LIMIT_*`, `DATA_RETENTION_ENABLED` |
| Rate limits | `RATE_LIMIT_AUTHENTICATED`, `RATE_LIMIT_PUBLIC`, `RATE_LIMIT_PRE_AUTH` |
| Observability | `OTEL_ENABLED`, `OTEL_SERVICE_NAME`, `SENTRY_ENABLED` |

> [!IMPORTANT]
> `DATABASE_URL` must use a `NOSUPERUSER NOBYPASSRLS` role; `MIGRATION_DATABASE_URL` uses the schema owner. The Docker migrations job prepares the runtime role before the applications start.

> [!NOTE]
> With `DB_SSL=true` the PostgreSQL server certificate is **verified**. If your provider uses a private or non-public CA, set `DB_SSL_CA` to its PEM (`\n` sequences are accepted). `DB_SSL_REJECT_UNAUTHORIZED=false` turns verification off and should only be used knowingly.

> [!WARNING]
> Keep `NFSE_MASTER_KEY` and `SECRETS_ENCRYPTION_KEY` with your backups: encrypted certificates and secrets depend on them.

## 🗂️ Code layout

```text
src/modules/    account-audit, auth, billing, certificate, company, credits,
                credits-alerts, email, fiscal-core, health, import,
                integrations (sales and payment connectors), invoice (NFS-e),
                invoice-schedule, lifecycle-emails, mcp, nfce, nfe,
                platform-admin, plans, portal-reachability, portal-sync,
                public-config, security, service-favorites, webhooks-config
src/infra/      config, database, queues, redis, storage, retention, external
                (nfse, nfe, stripe, email), observability, openapi, persistence
src/shared/     dates, errors, events, fiscal helpers, http, tax-id
test/           end-to-end and fiscal integration suites
scripts/        runtime-role SQL, smoke tests, scenario runner, release helpers
```

Modules follow `domain` (rules), `application` (use cases), `infra` (persistence and adapters) and `http` (controllers and DTOs). The architecture tests in `src/architecture` enforce the boundaries.

## 🧾 How an invoice is issued

1. `POST /v1/invoices` validates the request, stores the invoice, its event and an outbox message in **one transaction**, and answers `202`.
2. The outbox relay publishes the work to the queue. Future dates (`SCHEDULE`) are released at 00:00 `America/Sao_Paulo`.
3. The worker runs the fiscal pipeline: company fiscal profile, service classification, tax applicability, ISS and withholdings, IBS/CBS through the RTC calculator, and validation. A fiscal error rejects the invoice with a code such as `FISCAL_CLASSIFICATION_REQUIRED`.
4. The DPS is built, signed with the company certificate and sent to the national system. The result, XML and PDF are stored.
5. The calculation is reconciled against the authorized NFS-e (`nfse.invoice.fiscal_discrepancy` when they differ), and webhooks and email are sent.

The `test` environment uses a fake provider and needs no certificate. `live` requires an active A1 certificate and municipal registration. `POST /v1/invoices/calculate` runs steps 1 to 3 without storing anything. See [docs/fiscal](../docs/fiscal) for rules, limitations and runbooks.

## 🔌 HTTP contract

- Prefix `/v1`. The dashboard uses HttpOnly session cookies with CSRF through the Next.js proxy. Integrations use the `X-API-Key` header with scopes (`full_access`, `invoices_issue`, `invoices_view`, `invoices_read_write`).
- Successes answer `{ "data": ... }` and lists add `pagination` with `limit`, `hasMore` and `nextCursor`. Resources are flat objects.
- Errors answer `{ statusCode, code, message, details?, requestId }` with codes prefixed by `ERROR_`.
- Send `Idempotency-Key` on issuance and email requests so retries are safe.
- The public reference is served by the frontend at `/en/docs` and `/pt/docs`.

## 🤖 MCP server

`POST /mcp` (also served as `/v1/mcp`) is a JSON-RPC server for AI agents. The tools are in `src/modules/mcp/tools`: companies and certificates (`cnpj_lookup`, `company_create`, `company_get`, `company_list`, `company_update`, `company_fiscal_status`, `company_numbering_check`, `certificate_upload`), invoices (`nfse_issue`, `nfse_issue_batch`, `nfse_calculate`, `nfse_get`, `nfse_list`, `nfse_query`, `nfse_cancel`, `nfse_substitute`, `nfse_repeat`, `nfse_review`, `nfse_download_pdf`, `nfse_get_download_url`, `nfse_get_package_url`, `nfse_email_resend`, `invoices_overview`, `accountant_package_send`), spreadsheet imports (`import_*`), schedules (`schedule_*`), customers (`customer_*`), service favorites (`service_favorite_*`), webhooks (`webhook_deliveries_list`, `webhook_delivery_retry`) and billing (`credits_balance`, `credits_purchase`, `payment_status`, `billing_usage`; the purchase steps are left out in self-hosted mode). The NF-e and NFC-e tools take `type`. Discovery is published at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, clients register at `/mcp/register`, and login and approval happen on the dashboard (`DASHBOARD_URL/mcp/authorize`). Each connection stays in the test or live environment chosen at approval. See `FRONTEND_API.md` for the dashboard calls.

## 🗄️ Database

TypeORM migrations live in `src/infra/database/migrations`. Tenant tables use row-level security driven by the authenticated context. Migrations run as a separate update step, outside API and worker startup:

```bash
yarn migration:show
yarn migration:run
```

## 🧪 Testing

- Unit tests: `yarn test` (PostgreSQL integration specs are skipped unless configured; CI fails on any skipped test).
- PostgreSQL integration tests need `MIGRATION_TEST_DATABASE_URL` pointing at a local database whose name ends in `_test` (for example `postgresql://corvo:changeme@localhost:5434/corvo_test` with `yarn infra:up`); run them with `NODE_ENV=test yarn jest --runInBand <path>`.
- End-to-end tests need `E2E_DATABASE_URL` (a local database with `test` in its name; the suite recreates its schema).
> [!NOTE]
> Unit tests do not verify real fiscal issuance, email delivery or Stripe checkout. Nothing here is a homologation against the national system; see [fiscal limitations](../docs/fiscal/limitations.md).

## 🐳 Docker

Run from the repository root:

```bash
docker build -f deploy/Dockerfile.api -t corvo-api:local api
```

The same image runs the API and the worker (set `CORVO_RUNTIME_ROLE=worker` to start `dist/main.worker.js`; the default is `api`).

Liveness uses `/v1/health/live` and readiness `/v1/health/ready`. See [SELF_HOSTING.md](../SELF_HOSTING.md) and [deploy/README.md](../deploy/README.md).
