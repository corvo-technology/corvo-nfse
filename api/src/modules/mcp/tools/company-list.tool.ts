import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { Company } from '@/modules/company/domain/company';
import { CompanyNotFoundError } from '@/modules/company/domain/errors';
import type { ICompanyCertificateReader } from '@/modules/company/domain/i-company-certificate-reader';
import { CompanyListInput } from '../dto/tool-input.dto';
import { invalidInput } from './tool-input-errors';

export const COMPANY_LIST_TOOL = {
  name: 'company_list',
  description:
    'List the companies (issuers) of the workspace in the connected environment. Use it to find the company_id or the CNPJ to pass to nfse_issue, and to check whether a company is ready to issue (setup_gaps empty). Pass tax_id to look one up by CNPJ.',
  inputSchema: {
    type: 'object',
    properties: {
      tax_id: {
        type: 'string',
        description: 'Find a single company by CNPJ (punctuation optional).',
      },
      limit: { type: 'number', default: 50, minimum: 1, maximum: 100 },
      cursor: {
        type: 'string',
        description: 'Pagination cursor from previous response',
      },
    },
  },
} as const;

export interface CompanyListItem {
  id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string;
  municipality_code: string | null;
  default_service_code: string | null;
  status: string;
  tax_regime: string | null;
  simple_national: boolean;
  setup_gaps: string[];
  ready_to_issue: boolean;
}

export function createCompanyListHandler(
  companyService: CompanyService,
  certReader: ICompanyCertificateReader,
) {
  async function describe(
    companies: Company[],
    ctx: AuthContext,
  ): Promise<CompanyListItem[]> {
    const environment = executionEnvironment(ctx);
    const ids = companies.map((company) => company.id);
    const [certificates, regimes] = await Promise.all([
      certReader.activeCertificateCounts(ids, environment, ctx.tenantId),
      companyService.currentRegimesByCompanyIds(ids, ctx.tenantId),
    ]);
    return companies.map((company) => {
      const c = company.toSnapshot();
      const regime = regimes.get(company.id);
      const gaps = company.getSetupGapsWithCert(
        certificates.get(company.id) ?? false,
      );
      return {
        id: c.id,
        legal_name: c.legalName,
        trade_name: c.tradeName ?? null,
        tax_id: c.taxId,
        municipality_code: c.municipalityCode ?? null,
        default_service_code: c.defaultServiceCode ?? null,
        status: c.status,
        tax_regime: regime?.taxRegime ?? null,
        simple_national: regime?.simpleNational ?? false,
        setup_gaps: gaps,
        ready_to_issue: gaps.length === 0 && c.status !== 'blocked',
      };
    });
  }

  return async function companyListHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{ companies: CompanyListItem[]; next_cursor: string | null }> {
    const params = plainToInstance(
      CompanyListInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const environment = executionEnvironment(ctx);

    if (params.tax_id) {
      try {
        const company = await companyService.findByTaxId(
          params.tax_id,
          ctx.tenantId,
          environment,
        );
        return { companies: await describe([company], ctx), next_cursor: null };
      } catch (error) {
        if (error instanceof CompanyNotFoundError) {
          return { companies: [], next_cursor: null };
        }
        throw error;
      }
    }

    const page = await companyService.listPage(
      ctx.tenantId,
      { limit: params.limit ?? 50, cursor: params.cursor },
      environment,
    );
    return {
      companies: await describe(page.data, ctx),
      next_cursor: page.pagination.nextCursor,
    };
  };
}
