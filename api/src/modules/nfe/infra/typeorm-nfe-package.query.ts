import { Injectable } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import type { PackageScope } from '@/modules/invoice/domain/invoice-package.repository';
import { monthRange } from '@/modules/invoice/domain/invoice-package.repository';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Decimal } from '@/shared/types/money';
import { NfeDocumentOrmEntity } from './nfe-document.orm-entity';

/** An NF-e of the month package. */
export interface PackageNfe {
  id: string;
  tenantId: string;
  environment: ExecutionEnvironment;
  series: number | null;
  number: number | null;
  accessKey: string | null;
  status: 'authorized' | 'cancelled';
  issuedAt: Date | null;
  /** vNF as stored, "1234.50". */
  total: string;
  documentsReady: boolean;
}

/**
 * The NF-e of a competence month: authorized and cancelled ones, by the day they were issued in
 * São Paulo. Read-only, for the accountant package.
 */
@Injectable()
export class TypeormNfePackageQuery {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private query(scope: PackageScope) {
    const { start, end } = monthRange(scope.month);
    return this.db
      .repository(NfeDocumentOrmEntity)
      .createQueryBuilder('doc')
      .where('doc.tenant_id = :tenantId', { tenantId: scope.tenantId })
      .andWhere('doc.company_id = :companyId', { companyId: scope.companyId })
      .andWhere('doc.environment = :environment', {
        environment: scope.environment,
      })
      // Model 55 only: the NFC-e has no DANFE and its package comes with the DANFCE (NFC-e 4/5).
      .andWhere('doc.model = 55')
      .andWhere("doc.status IN ('authorized', 'cancelled')")
      .andWhere(
        "(doc.issued_at AT TIME ZONE 'America/Sao_Paulo')::date >= :start",
        { start },
      )
      .andWhere(
        "(doc.issued_at AT TIME ZONE 'America/Sao_Paulo')::date < :end",
        { end },
      );
  }

  summarize(
    scope: PackageScope,
  ): Promise<{ count: number; totalCents: number }> {
    return runWithTenant(scope.tenantId, async () => {
      const raw = await this.query(scope)
        .select('COUNT(*)', 'count')
        .addSelect(
          "COALESCE(SUM((doc.totals->>'vNF')::numeric) FILTER (WHERE doc.status = 'authorized'), 0)",
          'total',
        )
        .getRawOne<{ count: string; total: string }>();
      return {
        count: Number(raw?.count ?? 0),
        totalCents: new Decimal(raw?.total ?? 0).times(100).round().toNumber(),
      };
    });
  }

  /** Ordered by series and number; at most `limit` rows. */
  list(scope: PackageScope, limit: number): Promise<PackageNfe[]> {
    return runWithTenant(scope.tenantId, async () => {
      const rows = await this.query(scope)
        .orderBy('doc.series', 'ASC')
        .addOrderBy('doc.number', 'ASC')
        .addOrderBy('doc.id', 'ASC')
        .limit(limit)
        .getMany();
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        environment: row.environment as ExecutionEnvironment,
        series: row.series,
        number: row.number,
        accessKey: row.accessKey,
        status: row.status as PackageNfe['status'],
        issuedAt: row.issuedAt,
        total: String((row.totals as { vNF?: string }).vNF ?? '0.00'),
        documentsReady: row.documentsReadyAt !== null,
      }));
    });
  }
}
