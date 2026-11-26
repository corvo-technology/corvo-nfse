import { Inject, Injectable } from '@nestjs/common';
import { CertificateNotFoundError } from '@/modules/certificate/domain/errors';
import { CompanyService } from '@/modules/company/application/company.service';
import { ICompanyNfeSettingsRepository } from '@/modules/company/domain/company-nfe-settings.repository';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { LoadedCertificate } from '@/modules/fiscal-core/domain/ports/xml.port';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfeIssuer } from '../domain/nfe-draft';
import { nfeCertificateProblem, nfeProductionDisabled } from './nfe-errors';
import { nfeIssuerOf } from './nfe-issuer';
import { NfeSefazAccess } from './nfe-sefaz-access';

/** Not written as `code:` literals: the web catalogue scans the API source for those. */
export const CERTIFICATE_NOT_FOUND = 'CERTIFICATE_NOT_FOUND';
export const CERTIFICATE_UNUSABLE = 'CERTIFICATE_UNUSABLE';

export interface CertificateProblem {
  code: string;
  message: string;
}

/** What the customer reads when the company has no usable certificate. */
export function certificateProblemOf(error: unknown): CertificateProblem {
  return error instanceof CertificateNotFoundError
    ? {
        code: CERTIFICATE_NOT_FOUND,
        message:
          'Cadastre o certificado digital da empresa neste ambiente para emitir',
      }
    : {
        code: CERTIFICATE_UNUSABLE,
        message:
          'O certificado digital da empresa está vencido ou inválido; envie outro',
      };
}

/**
 * What every fiscal event needs about the company: the issuer data (CNPJ, UF), the certificate
 * (decrypted in memory for one operation, never logged or queued) and the homologation-only gate.
 */
@Injectable()
export class NfeEventContext {
  constructor(
    private readonly companies: CompanyService,
    @Inject(ICompanyNfeSettingsRepository)
    private readonly settings: ICompanyNfeSettingsRepository,
    private readonly access: NfeSefazAccess,
  ) {}

  /** `NFE_PRODUCTION_ENABLED` keeps `tpAmb 1` closed: a `live` company is refused. */
  assertEnvironment(environment: ExecutionEnvironment): void {
    if (environment === 'live' && !this.access.productionEnabled())
      throw nfeProductionDisabled();
  }

  async issuer(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<NfeIssuer & { uf: Uf }> {
    const company = await this.companies.findById(
      companyId,
      tenantId,
      environment,
    );
    const settings = await this.settings.find(companyId, tenantId);
    return nfeIssuerOf(company, settings);
  }

  /** For a request the customer is waiting for: a missing certificate is a 422 `configuration`. */
  async certificateForRequest(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<LoadedCertificate> {
    try {
      return await this.access.certificate(companyId, tenantId, environment);
    } catch (error) {
      const problem = certificateProblemOf(error);
      throw nfeCertificateProblem(problem.code, problem.message);
    }
  }
}
