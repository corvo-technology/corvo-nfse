import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceCalculationService } from '@/modules/invoice/application/fiscal/invoice-calculation.service';
import type { CreateInvoiceDto } from '@/modules/invoice/http/invoice.dto';
import { NfseIssueInput } from '../dto/tool-input.dto';
import { invalidInput } from './tool-input-errors';

export const NFSE_CALCULATE_TOOL = {
  name: 'nfse_calculate',
  description:
    'Calculate taxes for an NFS-e before issuing it. It does not issue a document, reserve credits, or create a DPS.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: { type: 'string' },
      company_tax_id: { type: 'string' },
      amount: { type: 'number' },
      description: { type: 'string' },
      competence_date: { type: 'string' },
      service_code: { type: 'string' },
      municipality_code: { type: 'string' },
    },
    required: ['amount'],
  },
} as const;

export function createNfseCalculateHandler(
  calculation: InvoiceCalculationService,
) {
  return async function nfseCalculateHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = plainToInstance(
      NfseIssueInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    if (params.services !== undefined || params.amount === undefined)
      throw new Error(
        'Invalid input: nfse_calculate currently requires amount, not services',
      );
    const dto: CreateInvoiceDto = {
      companyId: params.company_id,
      companyTaxId: params.company_tax_id,
      amount: params.amount,
      discount: params.discount,
      competenceDate:
        params.competence_date ??
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Sao_Paulo',
        }).format(new Date()),
      customer: params.customer
        ? {
            name: params.customer.name,
            taxId: params.customer.tax_id,
            email: params.customer.email,
            address: params.customer.address,
          }
        : undefined,
      service: {
        code: params.service_code,
        municipalityCode: params.municipality_code,
        description: params.description,
        serviceProfileId: params.service_profile_id,
      },
    };
    const outcome = await calculation.calculate(
      dto,
      ctx.tenantId,
      executionEnvironment(ctx),
    );
    if ('httpError' in outcome) throw new Error(outcome.httpError.message);
    return outcome.response;
  };
}
