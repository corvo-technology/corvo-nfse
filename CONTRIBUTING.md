# Contributing to Corvo NFS-e

Corvo NFS-e is licensed under [AGPL-3.0](LICENSE). By participating in the project, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up your environment

Use Node.js 24, Yarn 1.22.22, and Docker Compose v2.

```bash
yarn setup      # installs api/ and web/ and creates the env files
yarn local:up   # builds and starts the whole stack in Docker
```

The local stack uses `deploy/.env.local`, its own volumes, and LocalStack. Env files are ignored by Git; example files are versioned. Configure your email provider to test email-code sign-in.

For development watchers outside Docker, start the infrastructure with `yarn infra:up` (PostgreSQL, Redis and LocalStack from `api/docker-compose.yml`), configure `api/.env` and `web/.env.local`, run `yarn migration:run`, and prepare the runtime role with `api/scripts/provision-runtime-role.sql`. Then run `yarn dev`. Use different ports if you run this alongside the complete Docker stack. Details are in [api/README.md](api/README.md) and [web/README.md](web/README.md).

## Make a change

Keep fiscal rules in the backend and display HTTP contract errors in the frontend. Derive the tenant context from authentication and preserve permission checks and database isolation. Update frontend consumers and public examples together when the API contract changes.

```bash
yarn lint
yarn typecheck
yarn test
yarn build
```

`yarn check` runs all four. `typecheck` covers production code; the backend provides `typecheck:tests` separately. Unit tests do not verify real fiscal issuance, email delivery, or Stripe checkout.

### Tests that need PostgreSQL or Redis

Some API specs run against a real database. Start one (`yarn infra:up`, or the `postgres` and `redis` services of `api/docker-compose.yml`) and point the specs at it. The database name must end in `_test` and the host must be local; the specs refuse anything else:

```bash
cd api
MIGRATION_TEST_DATABASE_URL=postgresql://corvo:changeme@localhost:5434/corvo_test \
  NODE_ENV=test yarn jest --runInBand src/modules/integrations
```

Without `MIGRATION_TEST_DATABASE_URL` those specs are skipped on your machine, but **CI fails if any test is skipped**, so run them before you push. End-to-end tests (`yarn test:e2e:api`, `yarn test:e2e:web`) and `yarn test:fiscal:integration` need their own setup; see [api/README.md](api/README.md#-testing).

### What CI checks

`.github/workflows/ci.yml` and `security.yml` block a pull request when: lint, typecheck, tests or build fail in `api/` or `web/`; any API test is skipped; the generated OpenAPI is out of date (run `yarn openapi:generate` in `api/` after changing controllers or DTOs, and commit `docs/openapi` and `web/public/openapi.json`); the Docker and Compose files do not validate; or Semgrep or gitleaks find something.

Each application owns its `yarn.lock`. Install dependencies in the appropriate directory and update its lockfile. Keep a single Git repository at the root.

## Build an integration (connector)

A connector connects Corvo to a sales or payment platform: it checks that a webhook is genuine, then turns the event into a common sale model. Everything else (rules, issuing, cancelling, retries) is shared code. Copy the closest existing connector from [`api/src/modules/integrations/connectors`](api/src/modules/integrations/connectors), build your fixtures from the platform's official documentation, and open a pull request.

Read the [connector guide](docs/integrations/new-connector.md) first. It has the checklist of files to touch, a step-by-step walkthrough, the security rules (never log tokens or personal data, constant-time comparison, verify signatures), how to run the Postgres flow spec, the CI rules, and what to put in the pull request. The design behind it is in [docs/integrations/architecture.md](docs/integrations/architecture.md) (in Portuguese). Connectors on `main` today: Stripe, AbacatePay, Woovi, PushinPay, Hotmart and Kiwify.

## Submit a pull request

Describe the problem, resulting behavior, and checks you ran. Include migration, configuration, and HTTP contract changes where relevant. Workflows belong in the root `.github/workflows/` directory. Update the docs that your change makes stale (README, `SELF_HOSTING.md`, `deploy/.env.example`); do not add internal plans or specs to the repository.

Contributions to this repository are provided under the project's AGPL-3.0 license unless explicitly agreed otherwise with the maintainers.

Report community conduct incidents through the private contact listed in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Follow [SECURITY.md](SECURITY.md) for vulnerability reports.

## Sign your commits

Corvo NFS-e is licensed under the AGPL-3.0. By contributing you confirm you have the right to submit your work under that license, following the [Developer Certificate of Origin](https://developercertificate.org/). Please sign off your commits:

```bash
git commit -s -m "fix: describe the change"
```
