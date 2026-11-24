import { Injectable } from '@nestjs/common';
import { ICompanyCertificateReader } from '../domain/i-company-certificate-reader';
import { ICertificateRepository } from '@/modules/certificate/domain/certificate.repository';

@Injectable()
export class CompanyCertificateReader implements ICompanyCertificateReader {
  constructor(private readonly certRepo: ICertificateRepository) {}

  async hasActiveCertificate(
    companyId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
    tenantId: string,
  ): Promise<boolean> {
    const cert = await this.certRepo.findActiveByCompanyId(
      companyId,
      tenantId,
      environment,
    );
    if (!cert) return false;
    return cert.validUntil > new Date();
  }

  async activeCertificateCounts(
    companyIds: string[],
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
    tenantId: string,
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    for (const id of companyIds) result.set(id, false);
    // One query for the whole page, not one per company.
    const certs = await this.certRepo.findActiveByCompanyIds(
      companyIds,
      tenantId,
      environment,
    );
    const now = new Date();
    for (const cert of certs)
      if (cert.validUntil > now) result.set(cert.companyId, true);
    return result;
  }
}
