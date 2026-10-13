# Corvo NFS-e — API and worker

NestJS 11 backend with PostgreSQL/TypeORM, Redis/BullMQ, S3 document storage, and fiscal integration through `open-nfse`. Part of the [Corvo monorepo](../README.md).

## Runtimes

| Entry point | Responsibility | Default port |
| --- | --- | --- |
| `src/main.ts` | HTTP API and REST endpoints | 3000 |
| `src/main.worker.ts` | Queue consumers, scheduled jobs, and health endpoints | 3002 |
| `src/main.dev.ts` | API and worker together for development | 3000 and 3002 |

The worker completes invoice processing and document preparation. Production runs API and worker separately. The development bootstrap rejects `NODE_ENV=production`.

## Commands

Run inside `api/`, or use the equivalent root commands:

```bash
yarn install --frozen-lockfile
yarn build
yarn lint:check
yarn typecheck
yarn test --runInBand
yarn migration:show
yarn migration:run
yarn start:dev
```

`typecheck` covers production code. `typecheck:tests` includes test files. PostgreSQL integration tests require explicit configuration such as `MIGRATION_TEST_DATABASE_URL`, pointing at a test database.

## Configuration

Use [.env.example](.env.example) for development outside Docker. `DATABASE_URL` must use a `NOSUPERUSER NOBYPASSRLS` role; `MIGRATION_DATABASE_URL` uses the schema owner. The Docker migrations job prepares the runtime role before applications start.

Keep `NFSE_MASTER_KEY` and `SECRETS_ENCRYPTION_KEY` with your backups. Encrypted certificates and secrets depend on them. WhatsApp/Meta credentials are not required to start NFS-e.

## HTTP contract

The default prefix is `/v1`. The dashboard uses HttpOnly session cookies and CSRF through the Next.js proxy. External integrations use `x-api-key`. The public API reference is available in the frontend at `/en/docs` and `/pt/docs`.

Company registration requires a seven-digit `municipalityCode`; `municipalReg` is required in live fiscal mode. The optional `defaultServiceCode` contains six digits. Invoice requests select the issuer with `companyTaxId` or `companyId` and inherit omitted service defaults from the company.

## Docker

Run from the repository root:

```bash
docker build -f deploy/Dockerfile.api -t corvo-api:local api
docker build -f deploy/Dockerfile.worker -t corvo-worker:local api
```

See [SELF_HOSTING.md](../SELF_HOSTING.md). Liveness uses `/v1/health/live`; readiness uses `/v1/health/ready`. Migrations run as a separate update step, outside API and worker startup.
