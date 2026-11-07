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
  | 'billing-eligibility'
  | 'verified-provider-event'
  | 'integration-inbound';
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
    throw new NotFoundException('Resource not found');
  return storage.run({ tenantId, authUserId: current?.authUserId }, work);
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
