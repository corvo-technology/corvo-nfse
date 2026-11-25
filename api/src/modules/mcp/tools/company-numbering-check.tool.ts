import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, IsUUID, validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { DpsNumberingService } from '@/modules/invoice/application/dps-numbering.service';
import { invalidInput } from './tool-input-errors';

export const COMPANY_NUMBERING_CHECK_TOOL = {
  name: 'company_numbering_check',
  description:
    'Checks with the government whether the next note numbers (DPS) of a company were already used, for example when the company issued before on the government portal or in another system. Read-only: it issues nothing and never changes the numbering. It is informational: nfse_issue already skips numbers the government confirms as used on the first note of a company, so there is no need to call this before issuing. Pass company_id or tax_id (CNPJ).',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: { type: 'string', description: 'Company id (UUID).' },
      tax_id: { type: 'string', description: 'CNPJ; punctuation is optional.' },
    },
  },
} as const;

class CompanyNumberingCheckInput {
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsString() tax_id?: string;
}

export function createCompanyNumberingCheckHandler(
  companies: Pick<CompanyService, 'findById' | 'findByTaxId'>,
  numbering: Pick<DpsNumberingService, 'check'>,
) {
  return async function companyNumberingCheckHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = plainToInstance(
      CompanyNumberingCheckInput,
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
    const result = await numbering.check(company.id, tenantId, environment);
    const used = result.usedNumbers;
    return {
      company_id: company.id,
      series: result.series,
      next_number: result.nextNumber,
      used_numbers: used,
      suggested_next: result.suggestedNext,
      more_may_be_used: result.moreMayBeUsed,
      status: used.length > 0 ? 'numbers_already_used' : 'ok',
      message:
        used.length > 0
          ? `Os números ${used[0]} a ${used[used.length - 1]} já foram usados no governo. A primeira nota da empresa pula esses números sozinha e sai com o número ${result.suggestedNext}.`
          : `O número ${result.nextNumber} está livre no governo.`,
    };
  };
}
