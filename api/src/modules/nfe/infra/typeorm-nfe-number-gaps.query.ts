import { Injectable } from '@nestjs/common';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { NfeDocumentOrmEntity } from './nfe-document.orm-entity';
import { NfeInutilizationOrmEntity } from './nfe-inutilization.orm-entity';
import { NfeNumberSequenceOrmEntity } from './nfe-number-sequence.orm-entity';

export interface NfeNumberGap {
  companyId: string;
  series: number;
  start: number;
  end: number;
}

/**
 * The numbers from 1 to `current_number` that no NF-e holds (anything but `discarded`) and no
 * approved inutilization covers, grouped in runs. Computed on demand, never stored.
 *
 * The runs come from the sorted "used" intervals (each NF-e is one point, each approved
 * inutilization one range): the hole before an interval starts after the highest end seen so far,
 * and the last hole runs to `current_number`. It never expands a range number by number, so a
 * range raised to the millions costs the same as a short one.
 */
@Injectable()
export class NfeNumberGapsQuery {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private table(entity: new () => object): string {
    return this.db.manager().connection.getMetadata(entity).tablePath;
  }

  list(
    tenantId: string,
    environment: ExecutionEnvironment,
    companyId?: string,
  ): Promise<NfeNumberGap[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const sequences = this.table(NfeNumberSequenceOrmEntity);
      const companies = this.table(CompanyOrmEntity);
      const documents = this.table(NfeDocumentOrmEntity);
      const inutilizations = this.table(NfeInutilizationOrmEntity);
      const rows: Array<{
        company_id: string;
        series: number;
        gap_start: string;
        gap_end: string;
      }> = await this.db.manager().query(
        `WITH seq AS (
           SELECT s.company_id, s.series, s.current_number
             FROM ${sequences} s
             JOIN ${companies} c ON c.id = s.company_id AND c.tenant_id = s.tenant_id
            WHERE s.tenant_id = $1 AND s.model = 55 AND c.environment = $2
              AND ($3::uuid IS NULL OR s.company_id = $3::uuid)
         ),
         used AS (
           SELECT d.company_id, d.series, d.number AS lo, d.number AS hi
             FROM ${documents} d
            WHERE d.tenant_id = $1 AND d.environment = $2 AND d.model = 55
              AND d.number IS NOT NULL AND d.status <> 'discarded'
           UNION ALL
           SELECT i.company_id, i.series, i.start_number, i.end_number
             FROM ${inutilizations} i
            WHERE i.tenant_id = $1 AND i.environment = $2 AND i.status = 'homologada'
         ),
         ordered AS (
           SELECT u.company_id, u.series, u.lo,
                  COALESCE(MAX(u.hi) OVER (
                    PARTITION BY u.company_id, u.series ORDER BY u.lo, u.hi
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prev_hi
             FROM used u
         ),
         holes AS (
           SELECT o.company_id, o.series, o.prev_hi + 1 AS gap_start, o.lo - 1 AS gap_end
             FROM ordered o
            WHERE o.lo > o.prev_hi + 1
           UNION ALL
           SELECT s.company_id, s.series,
                  COALESCE((SELECT MAX(u.hi) FROM used u
                             WHERE u.company_id = s.company_id AND u.series = s.series), 0) + 1,
                  s.current_number
             FROM seq s
         )
         SELECT h.company_id, h.series, h.gap_start, LEAST(h.gap_end, s.current_number) AS gap_end
           FROM holes h
           JOIN seq s ON s.company_id = h.company_id AND s.series = h.series
          WHERE h.gap_start <= LEAST(h.gap_end, s.current_number)
          ORDER BY h.company_id, h.series, h.gap_start`,
        [tenantId, environment, companyId ?? null],
      );
      return rows.map((row) => ({
        companyId: row.company_id,
        series: Number(row.series),
        start: Number(row.gap_start),
        end: Number(row.gap_end),
      }));
    });
  }
}
