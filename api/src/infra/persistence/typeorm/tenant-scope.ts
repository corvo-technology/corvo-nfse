import { NotFoundException } from '@nestjs/common';
import type { ObjectLiteral, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

/** Trusted context must never turn into an omitted SQL predicate. */
export function requireTenantId(tenantId: string): void {
  if (
    typeof tenantId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      tenantId,
    )
  ) {
    throw new Error('A valid tenant context is required');
  }
}

export function assertTenantOwnership(tenantId: string, owner: string): void {
  requireTenantId(tenantId);
  if (owner !== tenantId)
    throw new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Resource not found',
    });
}

/** Update under the complete owner key; an ID collision can only fail the insert. */
export async function persistTenantEntity<T extends ObjectLiteral>(
  repo: Repository<T>,
  row: T,
  tenantId: string,
  immutable: string[] = [],
): Promise<T> {
  assertTenantOwnership(tenantId, row.tenantId as string);
  const identity: Record<string, unknown> = { id: row.id as unknown, tenantId };
  const mutable: Record<string, unknown> = { ...row };
  for (const key of ['id', 'tenantId', 'createdAt', ...immutable]) {
    delete mutable[key];
    if (immutable.includes(key)) identity[key] = row[key] as unknown;
  }
  const result = await repo
    .createQueryBuilder()
    .update()
    .set(mutable as QueryDeepPartialEntity<T>)
    .where(identity)
    .execute();
  if (!result.affected) await repo.insert(row);
  return row;
}
