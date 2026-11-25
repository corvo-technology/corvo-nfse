import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

/**
 * Defense in depth next to Postgres RLS: a repository method on a tenant-scoped
 * table must carry an explicit tenant predicate in every update / delete / find /
 * save, so a wrong RLS scope (like the PgBouncer leak) cannot reach another
 * tenant's rows. This spec reads the source and fails on a call that has none.
 */
const root = resolve(__dirname, '../..');
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : [path];
  });
}
const name = (path: string) => relative(root, path).replaceAll('\\', '/');

const productionFiles = sources(root).filter((path) => {
  const file = name(path);
  return (
    file.endsWith('.ts') &&
    !file.endsWith('.spec.ts') &&
    !file.includes('/testing/') &&
    !file.startsWith('infra/database/migrations/')
  );
});

// ORM entity files with a tenant_id column are tenant-scoped, except the ones
// below: they hold no tenant-owned rows (global tables, reached by hashed token
// or user id and never through the tenant RLS policy).
const globalEntityFiles: Record<string, string> = {
  'infra/persistence/typeorm/entities/auth.orm-entities.ts':
    'auth_sessions / auth_authorization_codes / auth_audit_events are per-user and per-token: no RLS policy, looked up by hashed secret or user id',
  'modules/billing/infra/payment-intent.orm-entity.ts':
    'payment_intents has no RLS policy: provider webhooks resolve the intent by providerRef without a tenant context',
  'infra/persistence/typeorm/entities/webhook-event.orm-entity.ts':
    'webhook_events is the provider inbox: tenant_id is nullable, no RLS, processed by system workers',
};

const tenantEntityFiles = productionFiles.filter((path) => {
  const file = name(path);
  return (
    file.endsWith('.orm-entity.ts') &&
    /name:\s*'tenant_id'/.test(readFileSync(path, 'utf8')) &&
    !(file in globalEntityFiles)
  );
});

const tenantEntityClasses = tenantEntityFiles.flatMap((path) =>
  [...readFileSync(path, 'utf8').matchAll(/export class (\w+)/g)].map(
    (match) => match[1],
  ),
);

// Entity class names contain "Tenant", so only the column / property counts.
/** The identifiers of a text, to match whole names without a dynamic regex. */
const words_ = (text: string) => new Set(text.match(/[A-Za-z0-9_$]+/g) ?? []);

const TENANT = /tenantId|tenant_id|\.\.\.scope/;

const guarded = new Set([
  'save',
  'update',
  'delete',
  'remove',
  'softDelete',
  'upsert',
  'increment',
  'decrement',
  'findOne',
  'findOneBy',
  'findOneOrFail',
  'findOneByOrFail',
  'find',
  'findBy',
  'exists',
  'existsBy',
]);

/**
 * Justified exceptions, keyed "file#method#call". A system job that runs under
 * runAsSystem has no single tenant, and a global table has no tenant column.
 */
const allowlist: Record<string, string> = {
  'infra/persistence/typeorm/repositories/auth.repositories.ts#*':
    'auth users, sessions, OAuth clients, codes and audit are global tables (no RLS), reached by user id or hashed secret',
  'infra/persistence/typeorm/repositories/tenant-invitation.repository.ts#findByTokenHash#findOne':
    'the invite token hash is the credential: the invitee has no tenant yet, the row tells which one',
  'infra/persistence/typeorm/repositories/tenant-membership.repository.ts#listActiveByAuthUser#find':
    'scoped by auth_user_id (runWithAuthUser): lists the workspaces of one person across tenants, by design',
  'infra/persistence/typeorm/repositories/tenant-membership.repository.ts#listActiveByAuthUserAndProduct#find':
    'scoped by auth_user_id (runWithAuthUser): lists the workspaces of one person across tenants, by design',
  'infra/persistence/typeorm/repositories/tenant-membership.repository.ts#listActiveWithEstablishmentByAuthUserAndProduct#find':
    'scoped by auth_user_id (runWithAuthUser): lists the workspaces of one person across tenants, by design',
  'modules/account-audit/infra/typeorm-audit-actor-label.resolver.ts#userLabel#findOneBy':
    'auth_users is a global table (no RLS): the actor is named by user id',
  'modules/billing/infra/typeorm-billing.repository.ts#customerTenant#findOneBy':
    'verified Stripe event: the Stripe customer id discovers the tenant (runAsSystem)',
  'modules/plans/infra/typeorm-tenant-plan.repository.ts#moveAllTenantsTo#update':
    'platform-wide plan move at bootstrap (runAsSystem workspace-bootstrap), no single tenant',
  'modules/auth/infra/typeorm-api-key.repository.ts#findByKeyPrefix#findOne':
    'the key prefix is the credential: it is how the tenant is discovered (runAsSystem credential-lookup)',
  'modules/auth/infra/typeorm-workspace.repository.ts#freePlanId#findOneByOrFail':
    'plans is a global catalog',
  'modules/auth/infra/typeorm-workspace.repository.ts#selfHostedPlanId#findOneByOrFail':
    'plans is a global catalog',
  'modules/billing/infra/typeorm-billing.repository.ts#current#findOneByOrFail':
    'the tenants row is read by its own id (the tenant); plans is a global catalog',
  'modules/billing/infra/typeorm-billing.repository.ts#plan#findOneBy':
    'plans is a global catalog',
  'modules/billing/infra/typeorm-billing.repository.ts#eventSeen#existsBy':
    'webhook_events is the global provider inbox (no RLS)',
  'modules/certificate/infra/typeorm-certificate.repository.ts#save#update':
    'nfse_certificates carries no tenant column of its own: the update only matches through an EXISTS on a company of this tenant',
  'modules/import/infra/typeorm-import.repository.ts#deleteOlderThan#delete':
    'system housekeeping across all tenants (runAsSystem import-housekeeping), no single tenant',
  'modules/import/infra/typeorm-import.repository.ts#failStuck#update':
    'system housekeeping across all tenants (runAsSystem import-housekeeping), no single tenant',
  'modules/integrations/infra/typeorm-integration-connection.repository.ts#findByPublicId#findOne':
    'the unguessable public id of an inbound webhook is the credential that discovers the tenant (runAsSystem integration-inbound)',
};

function violations(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const methodNode = (node: ts.Node): ts.Node | undefined => {
    for (let up = node.parent; up; up = up.parent)
      if (
        (ts.isMethodDeclaration(up) || ts.isFunctionDeclaration(up)) &&
        up.name
      )
        return up;
    return undefined;
  };
  const methodOf = (node: ts.Node): string =>
    (methodNode(node) as ts.MethodDeclaration | undefined)?.name?.getText() ??
    '<top>';
  /** Local `const where = { tenantId, ... }` objects the call passes by name. */
  const carriesTenant = (call: ts.Node, chain: string): boolean => {
    const method = methodNode(call);
    if (!method) return false;
    const names: string[] = [];
    const collect = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        TENANT.test(node.initializer.getText())
      )
        names.push(node.name.text);
      ts.forEachChild(node, collect);
    };
    collect(method);
    const words = words_(chain);
    return names.some((name) => words.has(name));
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      guarded.has(node.expression.name.text) &&
      // Only calls on a repository / query builder, not Map.delete and the like.
      /repo|Repo|manager|profiles|customers|schedules|rows|\(\)|builder|\.repository\(|getRepository/.test(
        node.expression.expression.getText(),
      )
    ) {
      // The whole chain: a query builder carries its tenant in .where().
      let top: ts.Node = node;
      while (
        ts.isPropertyAccessExpression(top.parent) ||
        (ts.isCallExpression(top.parent) && top.parent.expression === top)
      )
        top = top.parent;
      const key = `${name(path)}#${methodOf(node)}#${node.expression.name.text}`;
      const chain = top.getText();
      if (
        !TENANT.test(chain) &&
        !(`${name(path)}#*` in allowlist) &&
        !carriesTenant(node, chain) &&
        !(key in allowlist)
      )
        found.push(key);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('tenant predicates beside RLS', () => {
  it('knows the tenant-scoped entities', () => {
    expect(tenantEntityClasses).toEqual(
      expect.arrayContaining([
        'InvoiceScheduleOrmEntity',
        'CustomerOrmEntity',
        'CompanyFiscalProfileOrmEntity',
        'CreditTransactionOrmEntity',
      ]),
    );
  });

  const checked = productionFiles.filter((path) => {
    if (tenantEntityFiles.includes(path)) return false;
    const words = words_(readFileSync(path, 'utf8'));
    return tenantEntityClasses.some((entity) => words.has(entity));
  });

  it.each(checked.map((path) => [name(path), path]))(
    '%s writes and finds tenant rows only under a tenant predicate',
    (_file, path) => {
      expect(violations(path)).toEqual([]);
    },
  );

  it('keeps every allowlist entry in use', () => {
    const live = new Set(
      checked.flatMap((path) => {
        const text = readFileSync(path, 'utf8');
        return Object.keys(allowlist).filter(
          (key) => text.includes(`${key.split('#')[1]}(`) || key.endsWith('#*'),
        );
      }),
    );
    expect([...live].sort()).toEqual(Object.keys(allowlist).sort());
  });
});
