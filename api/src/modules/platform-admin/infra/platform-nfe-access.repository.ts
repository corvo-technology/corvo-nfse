import { Injectable } from '@nestjs/common';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';

type Column = 'nfe_enabled_at' | 'nfce_enabled_at';
type Updated = Partial<Record<Column, Date | string | null>>;

/** Writes `tenants.nfe_enabled_at` / `nfce_enabled_at` inside the ambient transaction. */
@Injectable()
export class PlatformNfeAccessRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  /**
   * Turns the release on (keeping the first date) or off. Returns `null` when the tenant does not
   * exist, else the new value of the column. Raw SQL: the column is `update: false` in the entity.
   */
  async setEnabled(
    tenantId: string,
    enabled: boolean,
  ): Promise<{ enabledAt: Date | null } | null> {
    return this.update(tenantId, enabled, 'nfe_enabled_at');
  }

  /** Same release for the NFC-e (`nfce_enabled_at`). */
  async setNfceEnabled(
    tenantId: string,
    enabled: boolean,
  ): Promise<{ enabledAt: Date | null } | null> {
    return this.update(tenantId, enabled, 'nfce_enabled_at');
  }

  private async update(
    tenantId: string,
    enabled: boolean,
    column: Column,
  ): Promise<{ enabledAt: Date | null } | null> {
    const manager = this.db.manager();
    const table = manager.getRepository(TenantOrmEntity).metadata.tablePath;
    const rows = (await manager.query(
      `UPDATE ${table} SET ${column} = CASE WHEN $2::boolean THEN COALESCE(${column}, now()) ELSE NULL END WHERE id = $1 RETURNING ${column}`,
      [tenantId, enabled],
    )) as unknown;
    const first = Array.isArray(rows) ? (rows as unknown[])[0] : undefined;
    // pg drivers answer [rows, count] for UPDATE ... RETURNING
    const row = (Array.isArray(first) ? first[0] : first) as
      Updated | undefined;
    if (!row || !(column in row)) return null;
    const value = row[column];
    return { enabledAt: value ? new Date(value) : null };
  }
}
