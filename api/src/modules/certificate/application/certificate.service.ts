import { CursorQuery } from '@/shared/http/pagination';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Injectable } from '@nestjs/common';
import { Certificate, CertificateMetadata } from '../domain/certificate';
import { ICertificateRepository } from '../domain/certificate.repository';
import { ICompanyRepository } from '@/modules/company/domain/company.repository';
import { CertificateParserService } from '../domain/certificate-parser.service';
import {
  CertificateNotFoundError,
  CertificateExpiredError,
  CertificateTaxIdMismatchError,
} from '../domain/errors';
import { CertificateEncryptor } from '../infra/aes-encryptor';

@Injectable()
export class CertificateService {
  async listPage(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    options: CursorQuery,
  ) {
    const company = await this.companyRepo.findByIdAndTenantId(
      companyId,
      tenantId,
      environment,
    );
    if (!company) throw new CertificateNotFoundError(companyId);
    return (
      await this.certRepo.listPage(companyId, tenantId, environment, options)
    ).map((cert) => cert.toMetadata());
  }

  constructor(
    private readonly certRepo: ICertificateRepository,
    private readonly companyRepo: ICompanyRepository,
    private readonly encryptor: CertificateEncryptor,
    private readonly parser: CertificateParserService,
  ) {}

  async upload(
    companyId: string,
    tenantId: string,
    p12File: Buffer,
    password: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<CertificateMetadata> {
    // 3. Verify company exists and belongs to tenant
    const company = await this.companyRepo.findByIdAndTenantId(
      companyId,
      tenantId,
      environment,
    );
    if (!company) {
      throw new CertificateNotFoundError(companyId);
    }

    // 1. Parse P12 using domain service
    const parsed = this.parser.parseP12(p12File, password);

    // 2. Check expiry
    if (parsed.validUntil < new Date()) {
      throw new CertificateExpiredError(parsed.validUntil);
    }

    // 4. Extract CNPJ from certificate subject and compare with company taxId
    const certCNPJ = this.parser.extractCNPJFromSubject(parsed.subject);
    if (certCNPJ && company.taxId !== certCNPJ) {
      throw new CertificateTaxIdMismatchError();
    }

    // 5. Revoke existing active certificate if any
    const existingActive = await this.certRepo.findActiveByCompanyId(
      companyId,
      tenantId,
      environment,
    );
    if (existingActive) {
      existingActive.markRevoked();
      existingActive.markDeleted();
      await this.certRepo.save(existingActive, tenantId, environment);
    }

    // 6. Encrypt P12
    const { encryptedBlob, encryptedDek, dekIv } = await this.encryptor.encrypt(
      Buffer.from(
        JSON.stringify({
          version: 2,
          pfx: parsed.p12Buffer.toString('base64'),
          password,
        }),
      ),
    );

    // 7. Create and save certificate
    const certificate = Certificate.createFromP12(
      parsed,
      encryptedBlob,
      encryptedDek,
      dekIv,
      companyId,
    );
    await this.certRepo.save(certificate, tenantId, environment);

    // 8. Recompute company status
    const companyForStatus = await this.companyRepo.findByIdAndTenantId(
      companyId,
      tenantId,
      environment,
    );
    if (companyForStatus) {
      companyForStatus.recomputeStatus(true); // just uploaded active cert
      await this.companyRepo.save(companyForStatus, tenantId);
    }

    return certificate.toMetadata();
  }

  async listByCompany(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<CertificateMetadata[]> {
    const company = await this.companyRepo.findByIdAndTenantId(
      companyId,
      tenantId,
      environment,
    );
    if (!company) {
      throw new CertificateNotFoundError(companyId);
    }

    const certs: Certificate[] = [];
    const active = await this.certRepo.findActiveByCompanyId(
      companyId,
      tenantId,
      environment,
    );
    if (active) certs.push(active);

    return certs.map((c) => c.toMetadata());
  }

  async revoke(
    certificateId: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
    companyId?: string,
  ): Promise<void> {
    const cert = await this.certRepo.findById(
      certificateId,
      tenantId,
      environment,
    );
    if (!cert || (companyId && cert.companyId !== companyId)) {
      throw new CertificateNotFoundError(certificateId);
    }

    const company = await this.companyRepo.findByIdAndTenantId(
      cert.companyId,
      tenantId,
      environment,
    );
    if (!company) {
      throw new CertificateNotFoundError(certificateId);
    }

    cert.markRevoked();
    cert.markDeleted();
    await this.certRepo.save(cert, tenantId, environment);

    // Recompute company status — cert no longer active
    company.recomputeStatus(false);
    await this.companyRepo.save(company, tenantId);
  }

  async getActive(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<Certificate> {
    const company = await this.companyRepo.findByIdAndTenantId(
      companyId,
      tenantId,
      environment,
    );
    if (!company) {
      throw new CertificateNotFoundError(companyId);
    }

    const cert = await this.certRepo.findActiveByCompanyId(
      companyId,
      tenantId,
      environment,
    );
    if (!cert) {
      throw new CertificateNotFoundError(companyId);
    }

    if (cert.validUntil < new Date()) {
      cert.markExpired();
      await this.certRepo.save(cert, tenantId, environment);
      // Recompute company status — expired cert
      company.recomputeStatus(false);
      await this.companyRepo.save(company, tenantId);
      throw new CertificateExpiredError(cert.validUntil);
    }

    return cert;
  }
}
