import { AsyncLocalStorage } from 'node:async_hooks';
import { NotFoundException } from '@nestjs/common';
import { requireTenantId } from './tenant-scope';

export type SystemPurpose =
  | 'worker-discovery'
  | 'outbox-relay'
  | 'invoice-schedule-runner'
  | 'import-housekeeping'
  | 'credential-lookup'
  | 'oauth-bootstrap'
  | 'workspace-bootstrap'
  | 'invitation-accept'
  | 'billing-eligibility'
  | 'verified-provider-event'
  | 'integration-inbound'
  | 'platform-admin'
  | 'data_retention';
export type DatabaseScope = {
  tenantId?: string;
  authUserId?: string;
  system?: SystemPurpose;
};
const storage = new AsyncLocalStorage<DatabaseScope>();
export const getDatabaseScope = (): DatabaseScope | undefined =>
  storage.getStore();

export function runWithTenant<T>(tenantId: string, work: () => T): T {
  requireTenantId(tenantId);
  const current = storage.getStore();
  if (current?.tenantId && current.tenantId !== tenantId)
    throw new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Resource not found',
    });
  return storage.run({ tenantId, authUserId: current?.authUserId }, work);
}

/** Runs with an empty database scope: any pooled connection acquired inside has no tenant and no system. */
export function runWithoutDatabaseScope<T>(work: () => T): T {
  return storage.run({}, work);
}

/**
 * Platform-admin writes on a target tenant. It does not reset TypeOrmTransactionContext,
 * so callers must open their own transaction inside it. Unlike runWithTenant it replaces the request's
 * tenant scope (the interceptor wraps every request in the admin's own tenant) and does not
 * enable `system`: RLS stays strict for the target tenant. Callers must be behind PlatformAdminGuard.
 */
export function runAsPlatformAdminOnTenant<T>(
  tenantId: string,
  work: () => T,
): T {
  requireTenantId(tenantId);
  return storage.run({ tenantId }, work);
}

/** Account bootstrap reads only; RLS grants SELECT on this user's memberships. */
export function runWithAuthUser<T>(authUserId: string, work: () => T): T {
  requireTenantId(authUserId);
  const current = storage.getStore();
  return storage.run({ tenantId: current?.tenantId, authUserId }, work);
}

/** Internal, enumerated exceptions; never populated from request headers or body. */
export function runAsSystem<T>(purpose: SystemPurpose, work: () => T): T {
  return storage.run({ system: purpose }, work);
}
