import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import type {
  CompanyServiceTaxProfile,
  IssTaxation,
  OperationNature,
} from '../domain/service-tax-profile';
import type {
  ProfileReviewStatus,
  TaxRegimeKind,
} from '../domain/fiscal-profile';
import type {
  IServiceTaxProfileRepository,
  NewServiceTaxProfile,
} from '../domain/service-tax-profile.repository';
import { CompanyServiceTaxProfileOrmEntity } from './company-service-tax-profile.orm-entity';
import { toDateString } from './company-fiscal-profile.orm-entity';

interface ServiceTaxProfileRow {
  id: string;
  tenant_id: string;
  company_id: string;
  name: string;
  service_code: string;
  municipal_service_code: string | null;
  nbs_code: string | null;
  cst: string | null;
  class_code: string | null;
  operation_indicator: string | null;
  operation_nature: string;
  regime_applicability: string[];
  incidence_municipality_code: string | null;
  iss_taxation: string | null;
  iss_rate: string | null;
  iss_withholding_default: boolean;
  withholding_policy: string;
  withholding_rates: Record<string, string>;
  effective_from: Date | string;
  effective_until: Date | string | null;
  classification_source: string;
  review_status: string;
  catalog_version: string | null;
  created_at: Date;
}

const INSERT_COLUMNS = `tenant_id, company_id, name, service_code, municipal_service_code, nbs_code, cst, class_code, operation_indicator, operation_nature, regime_applicability, incidence_municipality_code, iss_taxation, iss_rate, iss_withholding_default, withholding_policy, withholding_rates, effective_from, effective_until, classification_source, review_status, catalog_version`;
const INSERT_VALUES = `$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21, $22`;

@Injectable()
export class TypeOrmCompanyServiceTaxProfileRepository implements IServiceTaxProfileRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private manager(): EntityManager {
    return this.dataSource.manager;
  }

  private table(): string {
    return this.dataSource.getMetadata(CompanyServiceTaxProfileOrmEntity)
      .tablePath;
  }

  /** numeric is selected as text so the domain always sees percentage strings. */
  private returning(): string {
    return 'RETURNING *, iss_rate::text AS iss_rate';
  }

  findEffectiveByCompanyAndCode(
    companyId: string,
    tenantId: string,
    serviceCode: string,
    date: string,
  ): Promise<CompanyServiceTaxProfile[]> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.manager().query<ServiceTaxProfileRow[]>(
        `SELECT *, iss_rate::text AS iss_rate FROM ${this.table()} WHERE company_id = $1 AND tenant_id = $2 AND service_code = $3 AND effective_from <= $4 AND (effective_until IS NULL OR $4 < effective_until)`,
        [companyId, tenantId, serviceCode, date],
      );
      return rows.map((row) => this.toDomain(row));
    });
  }

  findEffectiveByCompany(
    companyId: string,
    tenantId: string,
    date: string,
  ): Promise<CompanyServiceTaxProfile[]> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.manager().query<ServiceTaxProfileRow[]>(
        `SELECT *, iss_rate::text AS iss_rate FROM ${this.table()} WHERE company_id = $1 AND tenant_id = $2 AND effective_from <= $3 AND (effective_until IS NULL OR $3 < effective_until)`,
        [companyId, tenantId, date],
      );
      return rows.map((row) => this.toDomain(row));
    });
  }

  findById(
    id: string,
    companyId: string,
    tenantId: string,
  ): Promise<CompanyServiceTaxProfile | null> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.manager().query<ServiceTaxProfileRow[]>(
        `SELECT *, iss_rate::text AS iss_rate FROM ${this.table()} WHERE id = $1 AND company_id = $2 AND tenant_id = $3`,
        [id, companyId, tenantId],
      );
      const [row] = rows;
      return row === undefined ? null : this.toDomain(row);
    });
  }

  upsert(
    id: string | null,
    companyId: string,
    tenantId: string,
    input: NewServiceTaxProfile,
  ): Promise<CompanyServiceTaxProfile> {
    return runWithTenant(tenantId, async () => {
      const params: unknown[] = [
        tenantId,
        companyId,
        input.name,
        input.serviceCode,
        input.municipalServiceCode,
        input.nbsCode,
        input.cst,
        input.classCode,
        input.operationIndicator,
        input.operationNature,
        input.regimeApplicability,
        input.incidenceMunicipalityCode,
        input.issTaxation,
        input.issRate,
        input.issWithholdingDefault,
        input.withholdingPolicy,
        input.withholdingRates,
        input.effectiveFrom,
        input.effectiveUntil,
        input.classificationSource,
        input.reviewStatus,
        input.catalogVersion,
      ];
      const table = this.table();
      const rows =
        id === null
          ? await this.manager().query<ServiceTaxProfileRow[]>(
              `INSERT INTO ${table} (${INSERT_COLUMNS}) VALUES (${INSERT_VALUES}) ${this.returning()}`,
              params,
            )
          : await this.manager().query<ServiceTaxProfileRow[]>(
              `UPDATE ${table} SET name = $3, service_code = $4, municipal_service_code = $5, nbs_code = $6, cst = $7, class_code = $8, operation_indicator = $9, operation_nature = $10, regime_applicability = $11::text[], incidence_municipality_code = $12, iss_taxation = $13, iss_rate = $14, iss_withholding_default = $15, withholding_policy = $16, withholding_rates = $17::jsonb, effective_from = $18, effective_until = $19, classification_source = $20, review_status = $21, catalog_version = $22 WHERE id = $23 AND company_id = $2 AND tenant_id = $1 ${this.returning()}`,
              [...params, id],
            );
      const [row] = this.rowsOf(rows);
      if (row === undefined)
        throw new NotFoundException({
          code: 'SERVICE_PROFILE_NOT_FOUND',
          message: 'Service tax profile not found',
        });
      return this.toDomain(row);
    });
  }

  /** SELECT/INSERT ... RETURNING resolve to rows; UPDATE ... RETURNING to [rows, affected]. */
  private rowsOf(raw: unknown): ServiceTaxProfileRow[] {
    const list = raw as unknown[];
    return (Array.isArray(list[0]) ? list[0] : list) as ServiceTaxProfileRow[];
  }

  markApproved(
    id: string,
    companyId: string,
    tenantId: string,
  ): Promise<CompanyServiceTaxProfile> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.manager().query<ServiceTaxProfileRow[]>(
        `UPDATE ${this.table()} SET review_status = 'approved' WHERE id = $1 AND company_id = $2 AND tenant_id = $3 ${this.returning()}`,
        [id, companyId, tenantId],
      );
      const [row] = this.rowsOf(rows);
      if (!row)
        throw new NotFoundException({
          code: 'SERVICE_PROFILE_NOT_FOUND',
          message: 'Service tax profile not found',
        });
      return this.toDomain(row);
    });
  }

  async delete(id: string, companyId: string, tenantId: string): Promise<void> {
    await runWithTenant(tenantId, async () => {
      const [, affected] = await this.manager().query<[unknown, number]>(
        `DELETE FROM ${this.table()} WHERE id = $1 AND company_id = $2 AND tenant_id = $3 RETURNING id`,
        [id, companyId, tenantId],
      );
      if (affected === 0)
        throw new NotFoundException({
          code: 'SERVICE_PROFILE_NOT_FOUND',
          message: 'Service tax profile not found',
        });
    });
  }

  private toDomain(row: ServiceTaxProfileRow): CompanyServiceTaxProfile {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      companyId: row.company_id,
      name: row.name,
      serviceCode: row.service_code,
      municipalServiceCode: row.municipal_service_code,
      nbsCode: row.nbs_code,
      cst: row.cst,
      classCode: row.class_code,
      operationIndicator: row.operation_indicator,
      operationNature: row.operation_nature as OperationNature,
      regimeApplicability: (row.regime_applicability ?? []) as TaxRegimeKind[],
      incidenceMunicipalityCode: row.incidence_municipality_code,
      issTaxation: row.iss_taxation as IssTaxation | null,
      issRate: row.iss_rate === null ? null : String(row.iss_rate),
      issWithholdingDefault: row.iss_withholding_default,
      withholdingPolicy:
        row.withholding_policy as CompanyServiceTaxProfile['withholdingPolicy'],
      withholdingRates: row.withholding_rates ?? {},
      effectiveFrom: toDateString(row.effective_from),
      effectiveUntil:
        row.effective_until === null ? null : toDateString(row.effective_until),
      classificationSource: row.classification_source,
      reviewStatus: row.review_status as ProfileReviewStatus,
      catalogVersion: row.catalog_version,
      createdAt: row.created_at,
    };
  }
}
