import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { Injectable } from '@nestjs/common';
import { ICertificateRepository } from '../domain/certificate.repository';
import { ICertificateDecryptor } from '../domain/certificate-decryptor';
import { CertificateEncryptor } from '../infra/aes-encryptor';
import { CertificateNotFoundError } from '../domain/errors';

@Injectable()
export class ApplicationCertificateDecryptor implements ICertificateDecryptor {
  constructor(
    private readonly certRepo: ICertificateRepository,
    private readonly encryptor: CertificateEncryptor,
  ) {}

  async decryptCredentials(
    companyId: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
  ): Promise<{ pfxBuffer: Buffer; password: string }> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const cert = await this.certRepo.findActiveByCompanyId(
        companyId,
        tenantId,
        environment,
      );
      if (!cert) {
        throw new CertificateNotFoundError(companyId);
      }

      if (cert.validUntil < new Date()) throw new Error('Certificate expired');
      const clear = await this.encryptor.decrypt(
        cert.encryptedBlob,
        cert.encryptedDek,
        cert.dekIv,
      );
      let bundle: { version?: number; pfx?: string; password?: string };
      try {
        bundle = JSON.parse(clear.toString('utf8')) as typeof bundle;
      } catch {
        throw new Error(
          'Legacy certificate has no stored password; upload it again',
        );
      }
      if (
        bundle.version !== 2 ||
        !bundle.pfx ||
        typeof bundle.password !== 'string'
      )
        throw new Error('Invalid certificate bundle; upload it again');
      return {
        pfxBuffer: Buffer.from(bundle.pfx, 'base64'),
        password: bundle.password,
      };
    });
  }

  async decrypt(
    companyId: string,
    tenantId: string,
    environment: import('@/shared/domain/execution-environment').ExecutionEnvironment,
  ): Promise<Buffer> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return (await this.decryptCredentials(companyId, tenantId, environment))
        .pfxBuffer;
    });
  }
}
