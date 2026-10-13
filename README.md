# Corvo NFS-e

**Brazilian service invoices, built into your product.**

Issue NFS-e through a REST API and manage companies, A1 certificates, and invoices from one dashboard. Corvo handles background processing, stores PDF and XML documents, and delivers status updates through webhooks.

[Run with Docker](#run-with-docker) · [Deploy to production](#deploy-to-production) · [Self-hosting guide](SELF_HOSTING.md) · [Contribute](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

## What you can do

| Capability | What it gives you |
| --- | --- |
| Invoice API | Issue Brazilian electronic service invoices from your SaaS, ERP, or backend. |
| Company management | Manage multiple issuers and their fiscal settings in one workspace. |
| A1 certificates | Upload and manage the certificates used to issue invoices. |
| PDF and XML documents | Download invoice documents or share a signed download link. |
| Webhooks and email | Receive invoice events and send documents by email. |
| Dashboard | Manage invoices, API keys, members, and billing in English or Portuguese. |
| Fiscal environments | Keep test and live invoice operations separate. |

## Run with Docker

You need **Docker with Compose v2** and **Node.js 24**. Docker installs the application dependencies; you do not need to install Yarn for this path.

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

This starts the dashboard, API, worker, PostgreSQL, Redis, and LocalStack. Database migrations run before the applications start.

| Open | Address |
| --- | --- |
| Dashboard | [localhost:4000](http://localhost:4000) |
| API | `http://localhost:3000/v1` |
| API reference | [localhost:4000/en/docs](http://localhost:4000/en/docs) |

### 3. Configure the integrations you want to test

The generated `deploy/.env.local` contains everything needed to start the local services. To sign in with an email code, add your email provider credentials:

```dotenv
# deploy/.env.local
RESEND_API_KEY=your_email_provider_api_key
RESEND_BASE_URL=https://api.millionsend.com
EMAIL_FROM=Corvo <noreply@yourdomain.com>
```

Use a sender authorized by your provider. Corvo uses MillionSend by default in the env examples. The local Stripe values only allow the application to start; replace them with your Stripe test credentials to test billing.

After editing the env file, run the same Compose command again to apply the changes.

For logs or shutdown, use the same env file and Compose files:

```bash
docker compose --env-file deploy/.env.local \
  -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml logs -f

docker compose --env-file deploy/.env.local \
  -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml down
```

## Deploy to production

Production uses `deploy/.env` and the main Compose file. It runs with `NODE_ENV=production` and stores documents in an **external S3 bucket**. LocalStack belongs to the local test environment.

After running the setup, edit `deploy/.env` using [.env.example](deploy/.env.example) as your reference:

| Configure | Variables |
| --- | --- |
| Public HTTPS URLs | `APP_ORIGIN`, `PUBLIC_API_URL` |
| S3 storage | `STORAGE_S3_BUCKET`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` |
| Email delivery and login codes | `RESEND_API_KEY`, `RESEND_BASE_URL`, `EMAIL_FROM` |
| Stripe billing | `STRIPE_SECRET_KEY`, `STRIPE_PLATFORM_WEBHOOK_SECRET` |

The setup generates the internal passwords and secrets. Keep those values and replace the external configuration placeholders with your own credentials. Use public origins without a path or trailing slash, such as `https://corvo.example.com` and `https://api.corvo.example.com`.

```bash
node scripts/check-deploy-env.mjs
docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  up -d --build --wait --wait-timeout 180
```

Configure HTTPS in your hosting platform. If you deploy directly to a VPS, you can enable the optional Caddy proxy. See [the self-hosting guide](SELF_HOSTING.md) for both options, updates, and troubleshooting.

## Develop and contribute

Use Node.js 24 and Yarn 1.22.22:

```bash
yarn setup
```

| Command | Action |
| --- | --- |
| `yarn local:up` | Build and start the local Docker stack. |
| `yarn local:logs` | Follow local service logs. |
| `yarn local:down` | Stop the local stack and keep its volumes. |
| `yarn deploy:up` | Validate production configuration, then build and start it. |
| `yarn dev` | Run web, API, and worker with local development watchers. |
| `yarn build` | Build the backend and frontend. |
| `yarn lint` | Check both applications with ESLint. |
| `yarn typecheck` | Check production TypeScript code. |
| `yarn test` | Run backend and frontend unit tests. |

For development outside Docker, prepare the database and application env files before running `yarn dev`. Follow [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository structure

```text
api/       NestJS API and background worker
web/       Next.js dashboard, website, and API reference
deploy/    Dockerfiles, production Compose, and local override
scripts/   Configuration setup and development commands
```

API and worker share backend code and run as separate production processes. Each application keeps its own dependencies and lockfile. Root commands coordinate the applications.

## License

Corvo NFS-e is licensed under the [GNU Affero General Public License, version 3](LICENSE) (`AGPL-3.0-only`).

## Community

Participation in this project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md), based on Contributor Covenant 2.1. Follow [CONTRIBUTING.md](CONTRIBUTING.md) to contribute.

For private vulnerability reports, see [SECURITY.md](SECURITY.md).
