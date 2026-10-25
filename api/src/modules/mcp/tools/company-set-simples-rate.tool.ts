import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { SimplesRateService } from '@/modules/company/application/simples-rate.service';
import { CompanySetSimplesRateInput } from '../dto/tool-input.dto';
import { invalidInput } from './tool-input-errors';

export const COMPANY_SET_SIMPLES_RATE_TOOL = {
  name: 'company_set_simples_rate',
  description:
    'Inform the Simples Nacional rates of a company for one month. Corvo does not compute the DAS: the company or its accountant informs the effective rate shown in the PGDAS-D, and Corvo sends it on the NFS-e (pTotTribSN). ' +
    'Identify the company with company_tax_id (CNPJ) or company_id. Send month as YYYY-MM (not in the future) and total_rate in percent (for example 6.54). iss_rate is the effective ISS rate of the month (used when the customer withholds ISS); ibs_rate and cbs_rate are for 2027. ' +
    'Percentages accept at most 2 decimals. The last informed month is repeated for later months until a new one is informed, so inform it once a month. MEI companies do not need a rate.',
  inputSchema: {
    type: 'object',
    properties: {
      company_tax_id: {
        type: 'string',
        description: 'CNPJ of the company (punctuation optional).',
      },
      company_id: {
        type: 'string',
        description: 'UUID of the company. Wins over company_tax_id.',
      },
      month: { type: 'string', description: 'Competence month, YYYY-MM.' },
      total_rate: {
        type: 'number',
        description:
          'Approximate total tax rate of the Simples for the month, in percent (0 to 100, 2 decimals).',
      },
      iss_rate: { type: 'number', description: 'Effective ISS rate (%).' },
      ibs_rate: { type: 'number', description: 'IBS rate (%), 2027.' },
      cbs_rate: { type: 'number', description: 'CBS rate (%), 2027.' },
    },
    required: ['month', 'total_rate'],
  },
} as const;

/** A percentage with at most 2 decimals as the "x.yy" string the API stores. */
function rateString(field: string, value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded - value) > 1e-9)
    throw new Error(`Invalid input: ${field}: at most 2 decimal places`);
  return rounded.toFixed(2);
}

const optionalRate = (field: string, value: number | undefined) =>
  value === undefined ? null : rateString(field, value);

const asNumber = (value: string | null) =>
  value === null ? null : Number(value);

export function createCompanySetSimplesRateHandler(
  companyService: CompanyService,
  simplesRates: SimplesRateService,
) {
  return async function companySetSimplesRateHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = plainToInstance(
      CompanySetSimplesRateInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const input = {
      totalRate: rateString('total_rate', params.total_rate),
      issRate: optionalRate('iss_rate', params.iss_rate),
      ibsRate: optionalRate('ibs_rate', params.ibs_rate),
      cbsRate: optionalRate('cbs_rate', params.cbs_rate),
    };
    const environment = executionEnvironment(ctx);
    const company = params.company_id
      ? await companyService.findById(
          params.company_id,
          ctx.tenantId,
          environment,
        )
      : await companyService.findByTaxId(
          params.company_tax_id as string,
          ctx.tenantId,
          environment,
        );
    const saved = await simplesRates.put(
      company.id,
      ctx.tenantId,
      params.month,
      input,
    );
    return {
      company_id: company.id,
      month: saved.month,
      total_rate: Number(saved.totalRate),
      iss_rate: asNumber(saved.issRate),
      ibs_rate: asNumber(saved.ibsRate),
      cbs_rate: asNumber(saved.cbsRate),
    };
  };
}
