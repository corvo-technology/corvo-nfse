import { Injectable } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import type {
  DocumentNumbering,
  NumberingScope,
} from '@/modules/fiscal-core/domain/ports/numbering.port';
import { NfeNumberingExhaustedError } from '../domain/errors';
import { INfeNumberPreview } from '../domain/nfe-number-preview';
import { NfeNumberSequenceOrmEntity } from './nfe-number-sequence.orm-entity';

export const NFE_LAST_NUMBER = 999_999_999;

/**
 * Atomic numbering per (company, model, series). It runs on the transaction of the caller (the
 * write-ahead transaction), so a rollback gives the number back; once committed it never goes back.
 * The upsert takes the row lock, so concurrent reservations queue up and get consecutive numbers.
 */
@Injectable()
export class TypeormNfeNumbering
  implements DocumentNumbering, INfeNumberPreview
{
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private table(): string {
    return this.db.manager().connection.getMetadata(NfeNumberSequenceOrmEntity)
      .tablePath;
  }

  reserveNext(
    scope: NumberingScope,
  ): Promise<{ series: number; number: number }> {
    return runWithTenant(scope.tenantId, async () => {
      const rows: Array<{ series: number; current_number: number }> =
        await this.db.manager().query(
          `INSERT INTO ${this.table()} AS seq (tenant_id, company_id, model, series, current_number)
           VALUES ($1, $2, $3, $4, 1)
           ON CONFLICT (company_id, model, series)
           DO UPDATE SET current_number = seq.current_number + 1
             WHERE seq.current_number < ${NFE_LAST_NUMBER}
           RETURNING series, current_number`,
          [scope.tenantId, scope.companyId, scope.model, scope.series],
        );
      const row = rows[0];
      if (!row) throw new NfeNumberingExhaustedError();
      return { series: row.series, number: row.current_number };
    });
  }

  /** `current_number + 1`, read without a lock or a write: the next emission may still take another. */
  peekNext(scope: NumberingScope): Promise<{ series: number; number: number }> {
    return runWithTenant(scope.tenantId, async () => {
      const rows: Array<{ current_number: number }> = await this.db
        .manager()
        .query(
          `SELECT current_number FROM ${this.table()} WHERE company_id = $1 AND model = $2 AND series = $3`,
          [scope.companyId, scope.model, scope.series],
        );
      const next = (rows[0]?.current_number ?? 0) + 1;
      if (next > NFE_LAST_NUMBER) throw new NfeNumberingExhaustedError();
      return { series: scope.series, number: next };
    });
  }

  raiseTo(scope: NumberingScope, lastUsed: number): Promise<void> {
    if (
      !Number.isInteger(lastUsed) ||
      lastUsed < 0 ||
      lastUsed > NFE_LAST_NUMBER
    )
      throw new RangeError('lastUsed must be between 0 and 999999999');
    return runWithTenant(scope.tenantId, async () => {
      await this.db.manager().query(
        `INSERT INTO ${this.table()} AS seq (tenant_id, company_id, model, series, current_number)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, model, series)
         DO UPDATE SET current_number = GREATEST(seq.current_number, EXCLUDED.current_number)`,
        [scope.tenantId, scope.companyId, scope.model, scope.series, lastUsed],
      );
    });
  }
}
