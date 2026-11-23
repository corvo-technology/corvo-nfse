import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Injectable, Logger } from '@nestjs/common';
import { ApplicationCertificateDecryptor } from '@/modules/certificate/application/certificate-decryptor';
import { ICompanyRepository } from '../domain/company.repository';
import {
  agreementView,
  currentAgreement,
  isAgreementStale,
  MunicipalityAgreementPort,
  type MunicipalityAgreementView,
  type StoredMunicipalityAgreement,
} from '../domain/municipality-agreement';

/** The company page must not hang on a slow Sefin. */
const LOOKUP_TIMEOUT_MS = 5000;

/**
 * Keeps the Sefin's answer about the company's municipality. It only informs: a failure here
 * (no certificate, network, Sefin down) never blocks anything and is never thrown.
 */
@Injectable()
export class MunicipalityAgreementService {
  private readonly logger = new Logger(MunicipalityAgreementService.name);

  constructor(
    private readonly companies: ICompanyRepository,
    private readonly sefin: MunicipalityAgreementPort,
    private readonly certificates: ApplicationCertificateDecryptor,
  ) {}

  /** Asks the Sefin and stores the answer. Returns what is stored afterwards (possibly the old answer). */
  async refresh(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<StoredMunicipalityAgreement | null> {
    const company = await this.companies.findByIdAndTenantId(
      companyId,
      tenantId,
      environment,
    );
    const municipalityCode = company?.toSnapshot().municipalityCode;
    if (!municipalityCode) return null;
    const stored = currentAgreement(
      await this.companies.findMunicipalityAgreement(companyId, tenantId),
      municipalityCode,
    );
    try {
      // Without a certificate there is nothing to ask with: this throws and the answer stays "not checked".
      const { pfxBuffer, password } =
        await this.certificates.decryptCredentials(
          companyId,
          tenantId,
          environment,
        );
      const answer = await withTimeout(
        this.sefin.lookup({
          municipalityCode,
          environment,
          pfxBuffer,
          password,
        }),
        LOOKUP_TIMEOUT_MS,
      );
      const checkedAt = new Date();
      await this.companies.saveMunicipalityAgreement(
        companyId,
        tenantId,
        answer,
        checkedAt,
      );
      return { answer, checkedAt };
    } catch (error) {
      this.logger.warn(
        `Municipality agreement check skipped for company ${companyId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return stored;
    }
  }

  /** Readiness read: the stored answer, asking again only when it is older than 24 hours or for another city. */
  async view(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    hasActiveCertificate: boolean,
    municipalityCode: string | undefined,
  ): Promise<MunicipalityAgreementView> {
    let stored = currentAgreement(
      await this.companies.findMunicipalityAgreement(companyId, tenantId),
      municipalityCode,
    );
    if (hasActiveCertificate && isAgreementStale(stored, new Date()))
      stored = await this.refresh(companyId, tenantId, environment);
    return agreementView(stored);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
