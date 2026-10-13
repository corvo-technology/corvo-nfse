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
    // For each company, check if it has an active cert
    await Promise.all(
      companyIds.map(async (id) => {
        const cert = await this.certRepo.findActiveByCompanyId(
          id,
          tenantId,
          environment,
        );
        result.set(id, cert !== null && cert.validUntil > new Date());
      }),
    );
    return result;
  }
}
