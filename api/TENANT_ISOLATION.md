# Tenant isolation and PostgreSQL RLS

API and worker runtimes use strict RLS. There is no permissive mode.
Business repositories require a valid server-resolved tenant UUID for reads,
counts, inserts, updates and deletes. A nested operation cannot change tenants.
Writes preserve the original owner and immutable company/environment identity.

The migration `1791750000000-EnableTenantRls` enables and forces row security on
16 tables. `tenants` uses its primary key; billing, settings, memberships,
invitations, API keys, companies, invoices, credits, usage periods, webhook
configurations/deliveries and MCP connections use `tenant_id`. Certificates and
DPS sequences use the owning company; invoice events use the owning invoice.
Policies cover both visibility (`USING`) and writes (`WITH CHECK`). Without a
tenant context these tables return no business rows and reject inserts.

The implementation uses an AsyncLocalStorage scope and a hook on the PostgreSQL
driver's connection acquisition (`rls-connection-scope.ts`). The scope is
**transaction-local**, so it is correct behind PgBouncer in **transaction**
pooling mode (the managed database runs that way: two statements of one client
can run on different server connections, and session settings leak between
requests):

- an explicit transaction (`startTransaction`, `manager.transaction`) runs
  `SELECT set_config('app.current_tenant_id', ..., true), set_config('app.current_auth_user_id', ..., true), set_config('app.system_context', ..., true)`
  as its first statement (after `SET TRANSACTION ...`, which PostgreSQL requires
  first), from the scope that was current when the transaction started. After
  `COMMIT AND CHAIN` / `ROLLBACK AND CHAIN` (a new transaction starts) the same
  settings are applied again;
- an autocommit statement without parameters goes out as ONE simple-protocol
  message, `BEGIN; set_config(..., true); <statement>; COMMIT`, and only the
  statement's result is returned. If it fails, the client sends `ROLLBACK`
  before the next statement;
- an autocommit statement with parameters (or several statements in one text)
  needs three messages: `BEGIN; set_config(..., true)`, the statement, `COMMIT`
  (node-postgres does not pipeline, so these are three round trips). If the
  scope cannot be applied, the statement is never sent;
- nothing is ever set with `is_local = false`. `app.system_context` therefore
  cannot survive on a server connection after a worker transaction ends, and a
  request can never inherit another request's tenant or system scope;
- a connection released inside an open transaction is destroyed, not reused.

Concurrency on one client: jobs of more than one message (the autocommit jobs
above and the first statement of a transaction, which carries the settings) run
alone. Every later statement on the same client waits until the job and its
cleanup are over, so callers that share one `QueryRunner` and fire queries at the
same time never see each other's scope, and a failed statement never leaves an
open transaction in front of the next one.

Transaction boundaries are recognised after leading whitespace and comments:
`BEGIN [WORK|TRANSACTION] [modes]`, `START TRANSACTION [modes]`, `COMMIT`, `END`,
`ABORT`, `ROLLBACK` (optionally `AND [NO] CHAIN`). Savepoints pass through.
`PREPARE TRANSACTION`, `COMMIT/ROLLBACK PREPARED` and malformed control
statements throw (fail closed). Transaction control hidden inside a
multi-statement text (`SELECT 1; COMMIT`) is not parsed: do not send it.
`QueryRunner.stream()` / cursors work only inside an explicit transaction (the
settings are queued ahead of the stream) and throw a clear error otherwise.
Statements that PostgreSQL refuses inside a transaction block (`VACUUM`,
`CREATE INDEX CONCURRENTLY`, ...) cannot run through the runtime connection;
migrations use their own data source, which does not have this hook. A client is
marked once wrapped, so the read-replica hook of TypeORM (which returns the
master connection when there are no replicas) never wraps it twice.

Cost per statement against PgBouncer (3000 x `SELECT 1`, one connection, local):
no scope 0.39 ms; before 1.2 ms; now 0.39-0.45 ms (without parameters) and
about 1.2 ms (with parameters, unchanged). Statements inside a transaction cost
nothing extra apart from the single settings statement.

This works with plain pooling, PgBouncer in session mode and PgBouncer in
transaction mode. Statement pooling is not supported (it forbids transactions).
Do not use session-level `SET`/`set_config(..., false)` or session advisory locks
in runtime code; use `SET LOCAL` and `pg_advisory_xact_lock`. After deploying
this change, server connections that an older version left with session-level
`app.*` values keep them until the pooler recycles them; the runtime sets every
value explicitly inside each transaction, so it is unaffected, but restart the
pooler (or wait for `server_lifetime`) if you also run other clients on it.

Trusted bootstrap exceptions are explicit: credential prefix lookup, OAuth
bootstrap, verified Stripe customer resolution, initial workspace creation,
free-plan eligibility and worker tenant discovery. They are internal code
paths, never flags accepted from clients. Discovery returns only tenant IDs;
each worker callback then runs with that tenant. Account selection can read
only the authenticated user's memberships across tenants. Global auth tables,
the public plan catalog and provider webhook ingestion remain outside business
RLS. RLS complements authorization and SQL predicates; custom PostgreSQL
settings are not protection against arbitrary SQL execution by the runtime.

MCP connection listing/revocation requires both the active tenant and account.
Bearer validation checks the persisted connection, session and active membership
on every request. Revoked sessions/connections immediately lose access.

Migration `1791740000000-EnforceTenantReferences` adds composite tenant foreign
keys for webhook configuration references and credit invoice/period/refund
references. It aborts if existing rows violate ownership. The invoice reservation
constraint is deferred until commit to support reservation before invoice insert.

## Database roles and activation

1. Set `MIGRATION_DATABASE_URL` to the schema owner and run `yarn migration:run`
   (or `yarn migration:run:prod` for a built deployment).
2. Provision a separate role with the reviewed
   [SQL script](scripts/provision-runtime-role.sql). Set its password separately
   using psql's `\password corvo_runtime`; keep credentials out of Git.
3. Set `DATABASE_URL` in **every runtime** to the restricted role, with
   `NOSUPERUSER NOBYPASSRLS`. The runtime should neither own the tables nor have
   membership in the migration/admin role. Default grants in the script must
   identify the role that actually creates the tables.
4. Restart API, webhook and worker processes after migrations and configuration.

Production startup rejects superuser/BYPASSRLS connections. All runtimes reject
missing RLS policies. Development logs a warning when an administrative database
role would bypass policies; use the restricted role locally to exercise isolation.
Migrations use their separate data source and do not install the runtime hook
(they run as the schema owner and never depend on `app.*`).

```sh
psql "$MIGRATION_DATABASE_URL" -v runtime_role=corvo_runtime \
  -v migration_role=corvo -v app_schema=corvo \
  -f scripts/provision-runtime-role.sql
```

Do not use the runtime role for migrations, schema synchronization or seed tools
that operate across accounts. Repository `synchronize` stays disabled.

## Platform admin reads

The platform admin area (`/v1/platform/*`) reads data from every tenant. It does so only under the `platform-admin` system purpose, inside a `READ ONLY` transaction (`SET TRANSACTION READ ONLY`), so a read path cannot write by accident. The only write is the credit grant, which runs on the target tenant and records an audit event in the same transaction. `platform_admin_audit_events` has no RLS and is kept forever. Who is admin comes from `PLATFORM_ADMIN_EMAILS` plus a verified e-mail, recomputed on every request.

## Verification

The PostgreSQL integration suite creates isolated schemas and temporary roles
with no bypass. It checks raw SQL without tenant predicates, cross-tenant writes,
child ownership, membership selection, connection reuse/concurrency, internal
worker discovery, repositories, composite references and migration reversal.
The complete API contract suite also runs API and webhook modules with a
restricted role, including native OAuth/MCP requests.

`src/infra/database/rls-pgbouncer.postgres.integration.spec.ts` runs the same
scope code behind a real PgBouncer in transaction mode. The schema comes from the
real migrations, the runtime role from `scripts/provision-runtime-role.sql` and
the DataSource from the application's own `createTypeOrmOptions`, and the
startup check (`RlsConnectionScopeService`) runs against it. It fires concurrent
tenant, transaction, `READ COMMITTED` and system work, concurrent autocommit
queries on one shared `QueryRunner` and a stream, asserting no cross-scope
reads/writes and no missing rows. Unit tests for the statement classifier, the
single-message path, streams and double wrapping are in
`src/infra/database/rls-connection-scope.spec.ts`. It needs
`PGBOUNCER_TEST_URL` (CI runs `edoburu/pgbouncer` as a service). Locally:

```sh
docker run -d -p 127.0.0.1:6432:5432 -e DB_HOST=<postgres ip> -e DB_USER=corvo_pgb_runtime \
  -e DB_PASSWORD=pgb -e POOL_MODE=transaction -e AUTH_TYPE=scram-sha-256 \
  -e DEFAULT_POOL_SIZE=3 edoburu/pgbouncer
PGBOUNCER_TEST_URL=postgresql://corvo_pgb_runtime:pgb@localhost:6432/corvo_test yarn test rls-pgbouncer
```

```sh
MIGRATION_TEST_DATABASE_URL=postgresql://corvo:changeme@localhost:5434/corvo_test \
RATE_LIMIT_TEST_REDIS_URL=redis://localhost:6382 \
yarn test --runInBand
```

The test database must be local and end in `_test`. Role provisioning in tests
requires an administrative test connection; the application connection is restricted.

## Fiscal profiles, snapshots and pre-emission calculation

Subsequent migrations also protect `outbox_messages`, `company_fiscal_profiles`,
`company_service_tax_profiles`, `invoice_fiscal_snapshots` and
`invoice_fiscal_reconciliations` with tenant policies and ownership references.
Fiscal profile readers resolve the active tenant and competence-date validity.
Snapshot updates/deletes are additionally rejected by an immutability trigger.

`POST /v1/invoices/calculate` shares company resolution with emission: a company
from another tenant/environment returns 404. It reads profiles under the
existing tenant context, without persisting any invoice, event, DPS sequence,
outbox message, snapshot/reconciliation, credit or webhook delivery. It uses the
standard authenticated HTTP rate limit of the other endpoints, without a
separate calculation budget. PostgreSQL coverage lives in
`src/modules/invoice/calculate.postgres.integration.spec.ts` (20 read-only calls,
worker parity, future profile validity and cross-tenant rejection).
