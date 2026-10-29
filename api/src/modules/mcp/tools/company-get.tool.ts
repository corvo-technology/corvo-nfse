import type { AuthContext } from '@/modules/auth/auth-context';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { ICompanyCertificateReader } from '@/modules/company/domain/i-company-certificate-reader';
import { createCompanyListHandler } from './company-list.tool';

export const COMPANY_GET_TOOL = {
  name: 'company_get',
  description:
    'Get one company by CNPJ in the connected environment. Returns company null when the CNPJ is not registered in this workspace.',
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
) {
  const list = createCompanyListHandler(companyService, certReader);
  return async function companyGetHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const result = await list(rawParams, ctx);
    return { company: result.companies[0] ?? null };
  };
}
