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

The implementation follows Greenflow's AsyncLocalStorage and PostgreSQL driver
connection acquisition pattern. On **every acquisition**, master and replica
connections receive `app.current_tenant_id`, `app.current_auth_user_id` and
`app.system_context`. Values are reset even when the pool reuses a connection.
Keep normal PostgreSQL pooling or PgBouncer in **session** pooling mode;
transaction/statement pooling is incompatible with these session settings.

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
Migrations use their separate data source and do not install the runtime hook.

```sh
psql "$MIGRATION_DATABASE_URL" -v runtime_role=corvo_runtime \
  -v migration_role=corvo -v app_schema=corvo \
  -f scripts/provision-runtime-role.sql
```

Do not use the runtime role for migrations, schema synchronization or seed tools
that operate across accounts. Repository `synchronize` stays disabled.

## Verification

The PostgreSQL integration suite creates isolated schemas and temporary roles
with no bypass. It checks raw SQL without tenant predicates, cross-tenant writes,
child ownership, membership selection, connection reuse/concurrency, internal
worker discovery, repositories, composite references and migration reversal.
The complete API contract suite also runs API and webhook modules with a
restricted role, including native OAuth/MCP requests.

```sh
MIGRATION_TEST_DATABASE_URL=postgresql://corvo:changeme@localhost:5434/corvo_test \
RATE_LIMIT_TEST_REDIS_URL=redis://localhost:6382 \
yarn test --runInBand
```

The test database must be local and end in `_test`. Role provisioning in tests
requires an administrative test connection; the application connection is restricted.
