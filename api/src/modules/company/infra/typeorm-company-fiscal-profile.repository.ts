import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import type {
  CompanyFiscalProfile,
  ProfileReviewStatus,
  TaxRegimeKind,
} from '../domain/fiscal-profile';
import type {
  IFiscalProfileRepository,
  NewFiscalProfile,
} from '../domain/fiscal-profile.repository';
import {
  CompanyFiscalProfileOrmEntity,
  toDateString,
} from './company-fiscal-profile.orm-entity';
import { CompanyOrmEntity } from './company.orm-entity';

interface FiscalProfileRow {
  id: string;
  tenant_id: string;
  company_id: string;
  tax_regime: string;
  simple_national: boolean;
  special_tax_regime: string | null;
  ibs_cbs_regular_option: boolean;
  ibs_cbs_regular_from: Date | string | null;
  valid_from: Date | string;
  valid_until: Date | string | null;
  source: string;
  review_status: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

@Injectable()
export class TypeOrmCompanyFiscalProfileRepository implements IFiscalProfileRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionContext,
  ) {}

  private manager(): EntityManager {
    return this.transactions.getManager() ?? this.dataSource.manager;
  }

  private table(): string {
    return this.dataSource.getMetadata(CompanyFiscalProfileOrmEntity).tablePath;
  }

  private companiesTable(): string {
    return this.dataSource.getMetadata(CompanyOrmEntity).tablePath;
  }

  /** SELECT/INSERT ... RETURNING resolve to rows; UPDATE ... RETURNING to [rows, affected]. */
  private rowsOf(raw: unknown): FiscalProfileRow[] {
    const list = raw as unknown[];
    return (Array.isArray(list[0]) ? list[0] : list) as FiscalProfileRow[];
  }

  async findEffective(
    companyId: string,
    tenantId: string,
    date: string,
  ): Promise<CompanyFiscalProfile | null> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.manager().query<FiscalProfileRow[]>(
        `SELECT * FROM ${this.table()} WHERE company_id = $1 AND tenant_id = $2 AND valid_from <= $3 AND (valid_until IS NULL OR $3 < valid_until)`,
        [companyId, tenantId, date],
      );
      const [row] = rows;
      return row ? this.toDomain(row) : null;
    });
  }

  async findOpen(
    companyId: string,
    tenantId: string,
  ): Promise<CompanyFiscalProfile | null> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.manager().query<FiscalProfileRow[]>(
        `SELECT * FROM ${this.table()} WHERE company_id = $1 AND tenant_id = $2 AND valid_until IS NULL`,
        [companyId, tenantId],
      );
      const [row] = rows;
      return row ? this.toDomain(row) : null;
    });
  }

  async findOpenByCompanyIds(
    companyIds: string[],
    tenantId: string,
  ): Promise<CompanyFiscalProfile[]> {
    if (companyIds.length === 0) return [];
    return runWithTenant(tenantId, async () => {
      const rows = await this.manager().query<FiscalProfileRow[]>(
        `SELECT * FROM ${this.table()} WHERE company_id = ANY($1::uuid[]) AND tenant_id = $2 AND valid_until IS NULL`,
        [companyIds, tenantId],
      );
      return rows.map((row) => this.toDomain(row));
    });
  }

  async list(
    companyId: string,
    tenantId: string,
  ): Promise<CompanyFiscalProfile[]> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.manager().query<FiscalProfileRow[]>(
        `SELECT * FROM ${this.table()} WHERE company_id = $1 AND tenant_id = $2 ORDER BY valid_from DESC`,
        [companyId, tenantId],
      );
      return rows.map((row) => this.toDomain(row));
    });
  }

  async findById(
    id: string,
    tenantId: string,
  ): Promise<CompanyFiscalProfile | null> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.manager().query<FiscalProfileRow[]>(
        `SELECT * FROM ${this.table()} WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const [row] = rows;
      return row ? this.toDomain(row) : null;
    });
  }

  async markApproved(
    id: string,
    tenantId: string,
    reviewedBy: string,
    at: Date,
  ): Promise<CompanyFiscalProfile> {
    return runWithTenant(tenantId, async () => {
      const raw: unknown = await this.manager().query(
        `UPDATE ${this.table()} SET review_status = 'approved', reviewed_by = $3, reviewed_at = $4
         WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [id, tenantId, reviewedBy, at],
      );
      const [row] = this.rowsOf(raw);
      if (!row) throw new NotFoundException('Fiscal profile not found');
      return this.toDomain(row);
    });
  }

  async append(
    companyId: string,
    tenantId: string,
    input: NewFiscalProfile,
  ): Promise<CompanyFiscalProfile> {
    return runWithTenant(tenantId, () =>
      this.dataSource.transaction(async (manager) => {
        const table = this.table();
        const locked = await manager.query(
          `SELECT id FROM ${this.companiesTable()} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [companyId, tenantId],
        );
        if (locked.length === 0)
          throw new NotFoundException('Company not found');
        const [open] = await manager.query<FiscalProfileRow[]>(
          `SELECT * FROM ${table} WHERE company_id = $1 AND valid_until IS NULL`,
          [companyId],
        );
        if (open) {
          const openFrom = toDateString(open.valid_from);
          if (input.validFrom < openFrom)
            throw new FiscalValidationError([
              {
                field: 'validFrom',
                code: 'invalid',
                message:
                  'validFrom cannot be before the current fiscal profile start',
              },
            ]);
          if (input.validFrom === openFrom) {
            if (open.review_status === 'approved')
              throw new ConflictException('profile_validity_conflict');
            await manager.query(
              `UPDATE ${table} SET tax_regime=$2, simple_national=$3, special_tax_regime=$4, ibs_cbs_regular_option=$5, ibs_cbs_regular_from=$6, source=$7, review_status=$8, reviewed_by=$9, reviewed_at=$10 WHERE id=$1`,
              [
                open.id,
                input.taxRegime,
                input.simpleNational,
                input.specialTaxRegime,
                input.ibsCbsRegularOption,
                input.ibsCbsRegularFrom,
                input.source,
                input.reviewStatus,
                input.reviewedBy,
                input.reviewStatus === 'approved' ? new Date() : null,
              ],
            );
            return this.requireById(manager, open.id, tenantId);
          }
          await manager.query(
            `UPDATE ${table} SET valid_until = $2 WHERE id = $1`,
            [open.id, input.validFrom],
          );
        }
        const raw: unknown = await manager.query(
          `INSERT INTO ${table} (tenant_id, company_id, tax_regime, simple_national, special_tax_regime, ibs_cbs_regular_option, ibs_cbs_regular_from, valid_from, source, review_status, reviewed_by, reviewed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            tenantId,
            companyId,
            input.taxRegime,
            input.simpleNational,
            input.specialTaxRegime,
            input.ibsCbsRegularOption,
            input.ibsCbsRegularFrom,
            input.validFrom,
            input.source,
            input.reviewStatus,
            input.reviewedBy,
            input.reviewStatus === 'approved' ? new Date() : null,
          ],
        );
        const [row] = this.rowsOf(raw);
        if (!row) throw new NotFoundException('Fiscal profile not found');
        return this.toDomain(row);
      }),
    );
  }

  private async requireById(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<CompanyFiscalProfile> {
    const rows = await manager.query<FiscalProfileRow[]>(
      `SELECT * FROM ${this.table()} WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = rows;
    if (!row) throw new NotFoundException('Fiscal profile not found');
    return this.toDomain(row);
  }

  private toDomain(row: FiscalProfileRow): CompanyFiscalProfile {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      companyId: row.company_id,
      taxRegime: row.tax_regime as TaxRegimeKind,
      simpleNational: row.simple_national,
      specialTaxRegime: row.special_tax_regime,
      ibsCbsRegularOption: row.ibs_cbs_regular_option,
      ibsCbsRegularFrom:
        row.ibs_cbs_regular_from === null
          ? null
          : toDateString(row.ibs_cbs_regular_from),
      validFrom: toDateString(row.valid_from),
      validUntil:
        row.valid_until === null ? null : toDateString(row.valid_until),
      source: row.source,
      reviewStatus: row.review_status as ProfileReviewStatus,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
    };
  }
}
