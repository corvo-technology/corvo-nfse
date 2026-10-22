# Corvo NFS-e

<p align="center">
  <img src="https://assets.greenflow.solutions/brand/corvo-faceted-green.png" alt="Corvo logo" width="160" />
</p>

<p align="center">
  <strong>NFS-e brasileira para produtos, ERPs e agentes de IA.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-blue" /></a>
  <img alt="Node.js 24" src="https://img.shields.io/badge/node-24-339933" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-3178c6" />
</p>

**Corvo** é a infraestrutura para emitir NFS-e de serviços no padrão nacional dentro do seu produto. Uma única API atende o seu backend, o painel e agentes de IA via MCP — com empresas, cálculo tributário, emissão assíncrona, documentos e webhooks no mesmo fluxo.

Feito para MEI, Simples Nacional e os demais regimes suportados pela NFS-e nacional. Corvo não é NF-e nem NFC-e.

[🚀 Quick start](#-quick-start) · [🔌 Use the API](#-use-the-api) · [🤖 AI agents](#-ai-agents-mcp) · [📦 Deploy](#-deploy-to-production) · [🛠️ Develop](#-develop) · [📚 Documentation](#-documentation) · [🤝 Contribute](CONTRIBUTING.md)

## 📑 Contents

- [✨ O que resolve](#-o-que-resolve)
- [🧭 Como funciona](#-como-funciona)
- [🚀 Quick start](#-quick-start)
- [🔌 Use the API](#-use-the-api)
- [🤖 AI agents (MCP)](#-ai-agents-mcp)
- [📦 Deploy to production](#-deploy-to-production)
- [🛠️ Develop](#-develop)
- [🗂️ Repository structure](#-repository-structure)
- [📚 Documentation](#-documentation)
- [🤝 Community and license](#-community-and-license)

## ✨ O que resolve

| Recurso | Para que serve |
| --- | --- |
| 🧾 Emissão por API | Emita NFS-e do seu SaaS, ERP ou backend. A emissão é assíncrona e pode ser repetida com `Idempotency-Key`. |
| 🧮 Pré-cálculo fiscal | `POST /v1/invoices/calculate` calcula tributos antes de emitir — sem criar nota, DPS ou reservar cota. |
| 🏢 Empresas | Cadastre e consulte empresas por CNPJ, com perfil fiscal por emissor. Planos pagos permitem empresas ilimitadas. |
| 📄 Ciclo completo | PDF, XML, links assinados, e-mail, cancelamento e webhooks assinados para cada mudança de status. |
| 🤖 MCP | Claude Code, Cursor, Codex e outros clientes podem criar empresas, consultar CNPJ, calcular impostos, emitir e acompanhar NFS-e. |
| 🧪 Teste e produção | Ambientes isolados; teste não precisa de certificado e não tem valor fiscal. |

> [!NOTE]
> Corvo covers **NFS-e (services)** only, not NF-e or NFC-e. See [fiscal limitations](docs/fiscal/limitations.md) for what is not covered yet.

## 🧭 Como funciona

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

Você envia a solicitação e recebe `202`. O worker classifica o serviço, calcula impostos, monta e assina a DPS, envia para a NFS-e nacional, guarda os documentos e notifica o seu sistema.

> [!IMPORTANT]
> Certificados A1 são enviados apenas pela API autenticada. O MCP não aceita certificados nem senhas.

## 🚀 Quick start

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

With Yarn installed, `yarn local:up` runs the same command. This starts the dashboard, API, worker, PostgreSQL, Redis, LocalStack and the tax calculator. The calculator image is built from the official zip, whose address and checksum the setup already wrote to the env file (`RTC_ZIP_URL`, `RTC_ZIP_SHA256`); the build stops on purpose if the published file stops matching the checksum (see [deploy/README.md](deploy/README.md)). Database migrations run before the applications start.

| Open | Address |
| --- | --- |
| 📊 Dashboard | [localhost:4000](http://localhost:4000) |
| 🔌 API | `http://localhost:3000/v1` |
| 🤖 MCP server | `http://localhost:3000/mcp` |
| 📚 Documentation | [localhost:4000/en/docs](http://localhost:4000/en/docs) |

### 3. Configure the integrations you want to test

The generated `deploy/.env.local` has everything needed to start. To sign in with an email code, add your email provider:

```dotenv
# deploy/.env.local
RESEND_API_KEY=your_email_provider_api_key
RESEND_BASE_URL=https://api.millionsend.com
EMAIL_FROM=Corvo <noreply@yourdomain.com>
```

Use a sender authorized by your provider. The local Stripe values only let the application start; replace them with Stripe test credentials to try billing. After editing the env file, run the same Compose command again. With Yarn, `yarn local:logs` follows the logs and `yarn local:down` stops the stack.

## 🔌 Use the API

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

O segundo request retorna `202` com a nota em `queued`. Acompanhe por `GET /v1/invoices/:id` ou webhook. Antes de emitir em produção, envie o A1 pela rota de certificados e confirme `GET /v1/billing/usage` (`canEmit: true`).

Para calcular antes de emitir, use o mesmo payload em `POST /v1/invoices/calculate`. Todos os campos, respostas e erros estão na [referência da API](http://localhost:4000/pt/docs).

## 🤖 AI agents (MCP)

Agents connect to one address and approve access in the browser:

```bash
claude mcp add --transport http corvo http://localhost:3000/mcp
```

O usuário faz login, escolhe a conta e aprova **test** ou **live**. A página **AI agents** mostra conexões e permite revogá-las.

| Tool MCP | Uso |
| --- | --- |
| `company_create` | Cria uma empresa; certificado permanece pela API. |
| `company_list` / `company_get` | Lista empresas ou encontra uma pelo CNPJ. |
| `nfse_calculate` | Prévia fiscal sem emissão. |
| `billing_usage` | Confere franquia, consumo e `canEmit`. |
| `nfse_issue`, `nfse_query`, `nfse_list`, `nfse_cancel` | Opera o ciclo da NFS-e. |

Para deixar um agente de código escrever a integração, forneça `/llms-full.txt`. Veja [Agentes de IA (MCP)](http://localhost:4000/pt/docs/mcp) e [Construir com IA](http://localhost:4000/pt/docs/llms).

## 📦 Deploy to production

Production uses `deploy/.env` and the main Compose file. It runs with `NODE_ENV=production` and stores documents in an **external S3 bucket**. LocalStack belongs to the local environment.

After running the setup, edit `deploy/.env` using [deploy/.env.example](deploy/.env.example):

| Configure | Variables |
| --- | --- |
| Public HTTPS URLs | `APP_ORIGIN`, `PUBLIC_API_URL` |
| S3 storage | `STORAGE_S3_BUCKET`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` |
| Email delivery and login codes | `RESEND_API_KEY`, `RESEND_BASE_URL`, `EMAIL_FROM` |
| Stripe billing | `STRIPE_SECRET_KEY`, `STRIPE_PLATFORM_WEBHOOK_SECRET` |
| Tax calculator | Filled by the setup (`RTC_ZIP_URL`, `RTC_ZIP_SHA256`); use a prebuilt `RTC_IMAGE` for reproducible deploys |

> [!WARNING]
> The setup generates the internal passwords and secrets. Keep them with your backups: encrypted certificates depend on them.

Use public origins without a path or trailing slash, such as `https://corvo.example.com` and `https://api.corvo.example.com`.

```bash
yarn deploy:up   # validates the configuration, then builds and starts the stack
```

Configure HTTPS in your hosting platform, or enable the optional Caddy proxy on a VPS. See the [self-hosting guide](SELF_HOSTING.md) for both options, updates and troubleshooting.

## 🛠️ Develop

Use Node.js 24 and Yarn 1.22.22:

```bash
yarn setup
```

| Command | Action |
| --- | --- |
| `yarn dev` | Run web, API and worker with watchers. |
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

## 🗂️ Repository structure

```text
⚙️  api/       NestJS API and background worker
🖥️  web/       Next.js dashboard, website and API reference
🐳 deploy/    Dockerfiles, production Compose and local override
🧰 scripts/   Configuration setup and development commands
📚 docs/      Fiscal rules, limitations, runbooks and design notes
```

API and worker share backend code and run as separate production processes. Each application keeps its own dependencies and lockfile; root commands coordinate them.

## 📚 Documentation

| Where | What |
| --- | --- |
| API reference at `/en/docs` and `/pt/docs` (on the local stack: [localhost:4000/en/docs](http://localhost:4000/en/docs)) | Endpoints, errors, webhooks, billing and AI agents. |
| [llms.txt](web/public/llms.txt) and `/llms-full.txt` | The same documentation for AI tools. |
| [SELF_HOSTING.md](SELF_HOSTING.md) | Run Corvo on your own infrastructure. |
| [deploy/README.md](deploy/README.md) | Docker files and the tax calculator. |
| [docs/fiscal](docs/fiscal) | Fiscal rules, examples, limitations, observability and runbooks. |

## 🤝 Community and license

Corvo NFS-e is licensed under the [GNU Affero General Public License, version 3](LICENSE) (`AGPL-3.0-only`). Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md); follow [CONTRIBUTING.md](CONTRIBUTING.md) to contribute. For private vulnerability reports, see [SECURITY.md](SECURITY.md).
