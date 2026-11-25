import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, IsUUID, validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { CertificateService } from '@/modules/certificate/application/certificate.service';
import type { CompanyFiscalProfileService } from '@/modules/company/application/company-fiscal-profile.service';
import type { CompanyServiceTaxProfileService } from '@/modules/company/application/company-service-tax-profile.service';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { IDpsSequenceRepository } from '@/modules/invoice/domain/dps-sequence';
import { todayInEstablishmentTimezone } from '@/shared/dates/date-time';
import { invalidInput } from './tool-input-errors';

export const COMPANY_FISCAL_STATUS_TOOL = {
  name: 'company_fiscal_status',
  description:
    'Read-only fiscal situation of one company: the current fiscal profile (tax regime, Simples Nacional, review status), the service tax profiles in effect today, the digital certificate status (active or expired and its expiry date; never the certificate file or password) and the DPS numbering (series and last number used). Use it to answer "meu certificado está válido?", "qual meu regime?" or "em que número de DPS estou?". Pass company_id or tax_id (CNPJ). When the company is ready to issue, the next step is nfse_issue; if the certificate is missing, call certificate_upload.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: { type: 'string', description: 'Company id (UUID).' },
      tax_id: { type: 'string', description: 'CNPJ; punctuation is optional.' },
    },
  },
} as const;

class CompanyFiscalStatusInput {
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsString() tax_id?: string;
}

export function createCompanyFiscalStatusHandler(
  companies: Pick<CompanyService, 'findById' | 'findByTaxId'>,
  fiscalProfiles: Pick<CompanyFiscalProfileService, 'current'>,
  serviceTaxProfiles: Pick<CompanyServiceTaxProfileService, 'list'>,
  certificates: Pick<CertificateService, 'listByCompany'>,
  dpsSequences: Pick<IDpsSequenceRepository, 'current'>,
) {
  return async function companyFiscalStatusHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = plainToInstance(
      CompanyFiscalStatusInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    if (!params.company_id && !params.tax_id)
      throw new Error('Invalid input: company_id or tax_id is required');

    const tenantId = ctx.activeTenantId;
    const environment = executionEnvironment(ctx);
    const company = params.company_id
      ? await companies.findById(params.company_id, tenantId, environment)
      : await companies.findByTaxId(params.tax_id!, tenantId, environment);
    const snapshot = company.toSnapshot();

    const [fiscalProfile, taxProfiles, certs, dps] = await Promise.all([
      fiscalProfiles.current(company.id, tenantId),
      serviceTaxProfiles.list(
        company.id,
        tenantId,
        todayInEstablishmentTimezone(),
      ),
      certificates.listByCompany(company.id, tenantId, environment),
      dpsSequences.current(company.id, tenantId, environment),
    ]);

    const now = Date.now();
    return {
      company: {
        id: snapshot.id,
        legal_name: snapshot.legalName,
        tax_id: snapshot.taxId,
        municipality_code: snapshot.municipalityCode ?? null,
        status: snapshot.status,
      },
      fiscal_profile: fiscalProfile,
      service_tax_profiles: taxProfiles,
      // Metadata only: the certificate file and password never leave the vault.
      certificates: certs.map((cert) => ({
        id: cert.id,
        subject: cert.subject,
        valid_from: cert.validFrom,
        valid_until: cert.validUntil,
        status: cert.status,
        expired: cert.status === 'expired' || cert.validUntil.getTime() < now,
      })),
      dps_sequence: { series: dps.series, last_number: dps.lastNumber },
    };
  };
}
