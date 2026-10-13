import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { Certificate } from './certificate';

export abstract class ICertificateRepository {
  abstract listPage(
    companyId: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
    options: CursorQuery,
  ): Promise<CursorPage<Certificate>>;
  abstract findById(
    id: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
  ): Promise<Certificate | null>;
  abstract findByIdAndCompanyId(
    id: string,
    companyId: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
  ): Promise<Certificate | null>;
  abstract findActiveByCompanyId(
    companyId: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
  ): Promise<Certificate | null>;
  abstract save(
    certificate: Certificate,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
  ): Promise<Certificate>;
  abstract existsActiveForCompany(
    companyId: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
  ): Promise<boolean>;
  /**
   * Mark all expired active certificates as 'expired' and return
   * the company IDs that were affected.
   * Runs as a single UPDATE query (batch, no N+1).
   */
  abstract expireExpiredCertificates(tenantId: string): Promise<string[]>;
}
