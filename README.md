<p align="center">
  <img src="web/public/brand/corvo-faceted-green.png" alt="Corvo logo" width="160" />
</p>

<p align="center">
  <strong>Brazilian electronic invoices (NFS-e, NF-e and NFC-e), built into your product.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-blue" /></a>
  <img alt="Node.js 24" src="https://img.shields.io/badge/node-24-339933" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-3178c6" />
</p>

<p align="center">
  <strong>English</strong> · <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

Corvo is a REST API and MCP server to issue Brazilian electronic invoices, focused on **MEI and Simples Nacional** companies. Its core is the **NFS-e** (services) on the national standard; **NF-e** (goods, model 55) and **NFC-e** (retail, model 65) use the same routes and are available in test mode. It registers issuer companies, stores their A1 certificates, calculates taxes before issuing, processes each invoice in the background, keeps the PDF and XML, and reports every status change by webhook. A dashboard and AI agents (Claude Code, Cursor, Codex and others) use the same API.

[Quick start](#quick-start) · [Use the API](#use-the-api) · [AI agents](#ai-agents-mcp) · [Deploy](#deploy-to-production) · [Develop](#develop) · [Documentation](#documentation) · [Contribute](CONTRIBUTING.md)

## Contents

- [What you can do](#what-you-can-do)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Use the API](#use-the-api)
- [AI agents (MCP)](#ai-agents-mcp)
- [Deploy to production](#deploy-to-production)
- [Develop](#develop)
- [Repository structure](#repository-structure)
- [Documentation](#documentation)
- [Community and license](#community-and-license)

## What you can do

| Capability | What it gives you |
| --- | --- |
| Invoice API | Issue Brazilian electronic service invoices from your SaaS, ERP, or backend. Issuance is asynchronous and safe to retry with an `Idempotency-Key`. |
| Tax calculation | `POST /v1/invoices/calculate` shows ISS, withholdings and IBS/CBS (when they apply) before you issue, with no invoice and no credit used. |
| Scheduled and recurring invoices | Issue on a future date (`options.type: "SCHEDULE"`) or on a weekly, biweekly or monthly schedule (`"RECURRING"`). |
| Cancellation | `POST /v1/invoices/:id/cancel` cancels a queued invoice immediately, or sends the cancellation event to the Sefin for an issued NFS-e (or one still being issued) and reports the result by webhook. |
| Spreadsheet import | Upload a CSV or Excel file, review the problems, then issue hundreds of invoices at once with live counters. By dashboard, API or MCP. |
| Multi-company | Manage many issuers, each with its fiscal profile and A1 certificate, in one workspace. |
| Documents and delivery | PDF and XML storage, signed download links, email delivery and signed webhooks for every status change (with automatic retries and a delivery log). |
| Sales and payment integrations | Connect a platform and every approved sale becomes an invoice on its own, with your rules and retries, and optional cancellation on refund. Connectors on `main`: Stripe, AbacatePay, Woovi, PushinPay, Hotmart and Kiwify. See [how to build a connector](docs/integrations/new-connector.md). |
| SDKs | Official SDKs for Node.js, Python, Go, PHP, Ruby, Rust, Java, Elixir and .NET, all on the same API (list in the [API reference](http://localhost:4000/en/docs/sdks)). |
| AI agents | A remote MCP server lets agents issue, query, cancel, import and schedule invoices, and `llms.txt` lets a coding agent write the integration for you. |
| Dashboard | Companies, invoices, API keys, members, billing and connected agents, in English or Portuguese. |
| Fiscal environments | Test and live are kept apart. Test needs no certificate and has no fiscal value. |
| Plans and credits | A free test environment, 5 free invoices for every new cloud account, paid plans with monthly allowances and single-invoice credits. Public prices at `GET /v1/plans`. |
| Self-hosted | Run it on your own server with `DEPLOYMENT_MODE=self_hosted`: no billing, credits or plan limits. See [SELF_HOSTING.md](SELF_HOSTING.md). |

> [!NOTE]
> **NFS-e** (services) is the production product. **NF-e** (goods, model 55) and **NFC-e** (retail, model 65) run in test mode (homologação) for every account, through the same `/v1/invoices` routes with `type: "nfe"` or `type: "nfce"`. Production for both stays blocked (`422 NFE_PRODUCTION_DISABLED`) until `NFE_PRODUCTION_ENABLED=true`. Corvo does not calculate NF-e/NFC-e taxes: you send the CFOP, NCM and CSOSN of each item, for Simples Nacional and MEI companies. See [fiscal limitations](docs/fiscal/limitations.md).

## How it works

```text
Your app / ERP / AI agent
        │  REST (X-API-Key)  or  MCP (OAuth)
        ▼
   Corvo API  ──►  queue + worker  ──►  fiscal engine  ──►  national NFS-e (Sefin)
        │                                   │
        │                                   └─ tax calculator (RTC, IBS/CBS)
        ▼
 PostgreSQL · Redis · S3          webhooks / email  ──►  your system and your customer
```

The API accepts a request and answers `202`. The worker classifies the service, calculates taxes, builds and signs the DPS, sends it to the national system, stores the result and notifies you.

For the full picture with diagrams (outbox, credit ledger, what is committed atomically, invoice statuses and queues), see [docs/architecture.md](docs/architecture.md) (in Portuguese).

## Quick start

You need **Docker with Compose v2** and **Node.js 24**. Docker installs the application dependencies; you do not need Yarn for this path.

### 1. Clone and generate your configuration

```bash
git clone https://github.com/corvo-technology/corvo-nfse.git
cd corvo-nfse
node scripts/setup-env.mjs
```

The setup generates passwords and encryption keys and creates missing env files. Running it again keeps your existing files and keys.

### 2. Start the local stack

```bash
docker compose --env-file deploy/.env.local \
  -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml \
  up -d --build --wait --wait-timeout 180
```

With Yarn installed, `yarn local:up` runs the same command. This starts the dashboard, API, worker, PostgreSQL, Redis, LocalStack and the tax calculator. The calculator (RTC) image is built from the official open-source repository on GitHub, pinned to a fixed version (see [deploy/README.md](deploy/README.md)); no extra setting is needed. Database migrations run before the applications start.

| Open | Address |
| --- | --- |
| Dashboard | [localhost:4000](http://localhost:4000) |
| API | `http://localhost:3000/v1` |
| MCP server | `http://localhost:3000/mcp` |
| Documentation | [localhost:4000/en/docs](http://localhost:4000/en/docs) |

### 3. Configure the integrations you want to test

The generated `deploy/.env.local` has everything needed to start. To sign in with an email code, add your email provider:

```dotenv
# deploy/.env.local
RESEND_API_KEY=your_email_provider_api_key
RESEND_BASE_URL=https://api.millionsend.com
EMAIL_FROM=Corvo <noreply@yourdomain.com>
```

Use a sender authorized by your provider. The local Stripe values only let the application start; replace them with Stripe test credentials to try cloud billing (or set `DEPLOYMENT_MODE=self_hosted` to turn billing off). After editing the env file, run the same Compose command again. With Yarn, `yarn local:logs` follows the logs and `yarn local:down` stops the stack.

## Use the API

Create an API key in the dashboard (**API keys**; keys starting with `corvo_test_` use the test environment), then register a company and issue an invoice:

```bash
export BASE_URL=http://localhost:3000/v1
export CORVO_API_KEY=corvo_test_your_key

curl -X POST "$BASE_URL/companies" \
  -H "X-API-Key: $CORVO_API_KEY" -H "Content-Type: application/json" \
  -d '{"legalName":"Empresa Exemplo Ltda","taxId":"11222333000181","taxRegime":"MEI","municipalityCode":"3550308","defaultServiceCode":"060101"}'

curl -X POST "$BASE_URL/invoices" \
  -H "X-API-Key: $CORVO_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: order_123" \
  -d '{"companyTaxId":"11222333000181","service":{"description":"Haircut"},"amount":50,"competenceDate":"2026-10-16"}'
```

The second call returns `202` with the invoice in `queued` state. Follow it with `GET /v1/invoices/:id` or a webhook. Every endpoint, field and error is in the [API reference](http://localhost:4000/en/docs).

## AI agents (MCP)

Agents connect to one address and approve access in the browser:

```bash
claude mcp add --transport http corvo http://localhost:3000/mcp
```

The user signs in, picks the workspace and chooses **test** or **live** on the approval screen. The dashboard page **AI agents** lists connected apps, their usage, and lets you revoke them. To let a coding agent write the integration into your project instead, give it `/llms-full.txt`. See [AI agents (MCP)](http://localhost:4000/en/docs/mcp) and [Build with AI](http://localhost:4000/en/docs/llms).

## Deploy to production

Production uses `deploy/.env` and the main Compose file. It runs with `NODE_ENV=production` and stores documents in an **external S3 bucket**. LocalStack belongs to the local environment.

After running the setup, edit `deploy/.env` using [deploy/.env.example](deploy/.env.example):

| Configure | Variables |
| --- | --- |
| Public HTTPS URLs | `APP_ORIGIN`, `PUBLIC_API_URL` |
| S3 storage | `STORAGE_S3_BUCKET`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` |
| Email delivery and login codes | `RESEND_API_KEY`, `RESEND_BASE_URL`, `EMAIL_FROM` |
| Stripe billing | Only with `DEPLOYMENT_MODE=cloud`: `STRIPE_SECRET_KEY`, `STRIPE_PLATFORM_WEBHOOK_SECRET` |
| Tax calculator | Nothing to fill in; built from the pinned GitHub version (or set a prebuilt `RTC_IMAGE`) |

> [!WARNING]
> The setup generates the internal passwords and secrets. Keep them with your backups: encrypted certificates depend on them.

Use public origins without a path or trailing slash, such as `https://corvo.example.com` and `https://api.corvo.example.com`.

```bash
yarn deploy:up   # validates the configuration, then builds and starts the stack
```

`deploy/.env` is written with `DEPLOYMENT_MODE=self_hosted`: no billing, no credits, no Stripe needed. Configure HTTPS in your hosting platform, enable the optional Caddy proxy on a VPS, or use `deploy/docker-compose.dokploy.yml` on Dokploy (no Caddy, no published ports). See the [self-hosting guide](SELF_HOSTING.md) for the three options, updates, data cleanup and troubleshooting.

## Develop

Use Node.js 24 and Yarn 1.22.22:

```bash
yarn setup
```

| Command | Action |
| --- | --- |
| `yarn dev` | Run web, API and worker with watchers (needs the infrastructure from `yarn infra:up` and the env files from `yarn setup`). |
| `yarn local:up` / `local:logs` / `local:down` | Build, follow and stop the local Docker stack. |
| `yarn deploy:up` / `deploy:logs` / `deploy:down` | Validate, start, follow and stop the production stack. |
| `yarn infra:up` / `infra:down` | Start or stop only PostgreSQL, Redis and LocalStack for development outside Docker. |
| `yarn migration:run` / `migration:show` | Run or list database migrations. |
| `yarn build` | Build the backend and frontend. |
| `yarn lint` | Check both applications with ESLint. |
| `yarn typecheck` | Check production TypeScript code. |
| `yarn test` | Run backend and frontend unit tests. |
| `yarn test:e2e:api` / `test:e2e:web` | Run end-to-end suites (they need their own setup). |
| `yarn check` | Lint, typecheck, test and build. |

For development outside Docker, prepare the database and the env files of each application, then run `yarn dev`. Follow [CONTRIBUTING.md](CONTRIBUTING.md), [api/README.md](api/README.md) and [web/README.md](web/README.md).

## Repository structure

```text
api/       NestJS API and background worker
web/       Next.js dashboard, website and API reference
deploy/    Dockerfiles, production Compose and local override
scripts/   Configuration setup and development commands
docs/      Fiscal rules, limitations, runbooks and design notes
```

API and worker share backend code and run as separate production processes. Each application keeps its own dependencies and lockfile; root commands coordinate them.

## Documentation

| Where | What |
| --- | --- |
| API reference at `/en/docs` and `/pt/docs` (on the local stack: [localhost:4000/en/docs](http://localhost:4000/en/docs)) | Endpoints, errors, webhooks, billing and AI agents. |
| `/llms.txt` and `/llms-full.txt` (source: [web/lib/llms.ts](web/lib/llms.ts)) | The same documentation for AI tools. |
| [SELF_HOSTING.md](SELF_HOSTING.md) | Run Corvo on your own infrastructure (Compose, Caddy or Dokploy). |
| [deploy/README.md](deploy/README.md) | Docker files and the tax calculator. |
| [docs/openapi](docs/openapi) | The public API contract (`openapi.json`, also at `https://corvo.tech/openapi.json`), its route table and the changelog for SDK maintainers. |
| [docs/integrations](docs/integrations) | [How to build a connector](docs/integrations/new-connector.md) and the [design](docs/integrations/architecture.md) behind sales and payment integrations (design in Portuguese). |
| [docs/architecture.md](docs/architecture.md) | How it works inside: outbox, credit ledger, transactions, statuses and queues, with diagrams (in Portuguese). |
| [docs/fiscal](docs/fiscal) | Fiscal rules, examples, limitations, observability and runbooks, including NF-e and NFC-e (in Portuguese). |
| [api/README.md](api/README.md) · [web/README.md](web/README.md) | Each application: commands, configuration, code layout and tests. |

## Legal notice

Corvo issues tax documents. Whoever runs it is responsible for the company data, for the A1 certificate and for what is issued. It is software, not tax advice: check the [fiscal limitations](docs/fiscal/limitations.md) before issuing in production. If you process personal data, the LGPD applies to you as the operator.

## Community and license

Corvo NFS-e is licensed under the [GNU Affero General Public License, version 3](LICENSE) (`AGPL-3.0-only`). Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md); follow [CONTRIBUTING.md](CONTRIBUTING.md) to contribute. For private vulnerability reports, see [SECURITY.md](SECURITY.md).
