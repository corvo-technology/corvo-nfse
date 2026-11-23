import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Company } from './company';
import type {
  MunicipalityAgreementAnswer,
  StoredMunicipalityAgreement,
} from './municipality-agreement';

export abstract class ICompanyRepository {
  abstract listPage(
    tenantId: string,
    options: CursorQuery,
    environment: ExecutionEnvironment,
  ): Promise<CursorPage<Company>>;
  abstract findByIdAndTenantId(
    id: string,
    tenantId: string,
    environment?: ExecutionEnvironment,
  ): Promise<Company | null>;
  abstract findByTaxIdAndTenantId(
    taxId: string,
    tenantId: string,
    environment?: ExecutionEnvironment,
  ): Promise<Company | null>;
  abstract findByTenantId(
    tenantId: string,
    limit?: number,
    cursor?: string,
    environment?: ExecutionEnvironment,
  ): Promise<Company[]>;
  abstract saveWithLimit(
    company: Company,
    maximum: number,
    tenantId: string,
  ): Promise<void>;
  abstract save(company: Company, tenantId: string): Promise<Company>;
  abstract existsWithTaxId(
    taxId: string,
    tenantId: string,
    excludeId?: string,
    environment?: ExecutionEnvironment,
  ): Promise<boolean>;
  abstract countActiveByTenantId(tenantId: string): Promise<number>;
  /**
   * Batch recompute company status for the given company IDs.
   * Never touches companies with status='blocked'.
   * Runs as a single UPDATE query (batch, no N+1).
   */
  abstract batchRecomputeStatus(
    companyIds: string[],
    tenantId: string,
  ): Promise<void>;
  abstract findMunicipalityAgreement(
    companyId: string,
    tenantId: string,
  ): Promise<StoredMunicipalityAgreement | null>;
  abstract saveMunicipalityAgreement(
    companyId: string,
    tenantId: string,
    answer: MunicipalityAgreementAnswer,
    checkedAt: Date,
  ): Promise<void>;
}
