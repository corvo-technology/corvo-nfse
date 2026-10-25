import type { AuthContext } from '@/modules/auth/auth-context';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { ICompanyCertificateReader } from '@/modules/company/domain/i-company-certificate-reader';
import type { SimplesRateService } from '@/modules/company/application/simples-rate.service';
import { todayInEstablishmentTimezone } from '@/shared/dates/date-time';
import { createCompanyListHandler } from './company-list.tool';

export const COMPANY_GET_TOOL = {
  name: 'company_get',
  description:
    'Get one company by CNPJ in the connected environment. Returns company null when the CNPJ is not registered in this workspace. For Simples Nacional companies, simples_rate is the rate in force this month (null when none was informed; stale true when it is more than one month old): update it with company_set_simples_rate.',
  inputSchema: {
    type: 'object',
    properties: {
      tax_id: { type: 'string', description: 'CNPJ; punctuation is optional.' },
    },
    required: ['tax_id'],
  },
} as const;

export function createCompanyGetHandler(
  companyService: CompanyService,
  certReader: ICompanyCertificateReader,
  simplesRates?: SimplesRateService,
) {
  const list = createCompanyListHandler(companyService, certReader);
  const currentRate = async (
    company: { id: string } | null,
    tenantId: string,
  ) => {
    if (!company || !simplesRates) return null;
    const { rate, stale } = await simplesRates.resolve(
      company.id,
      tenantId,
      todayInEstablishmentTimezone(),
    );
    return rate === null
      ? null
      : {
          month: rate.month,
          total_rate: Number(rate.totalRate),
          iss_rate: rate.issRate === null ? null : Number(rate.issRate),
          stale,
        };
  };
  return async function companyGetHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const result = await list(rawParams, ctx);
    const company = result.companies[0] ?? null;
    return { company, simples_rate: await currentRate(company, ctx.tenantId) };
  };
}
