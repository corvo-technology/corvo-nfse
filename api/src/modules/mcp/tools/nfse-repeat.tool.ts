import { plainToInstance } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  validate,
} from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { EmissionRouterService } from '@/modules/invoice-schedule/application/emission-router.service';
import type { IInvoiceRepository } from '@/modules/invoice/domain/invoice.repository';
import type { CreateInvoiceDto } from '@/modules/invoice/http/invoice.dto';
import { invalidInput } from './tool-input-errors';

export class NfseRepeatInput {
  /** The note to copy: its id or its access key. */
  @ValidateIf((o: NfseRepeatInput) => !o.access_key)
  @IsUUID()
  invoice_id?: string;

  @ValidateIf((o: NfseRepeatInput) => !o.invoice_id)
  @IsString()
  access_key?: string;

  @IsOptional() @IsNumber() @IsPositive() amount?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() competence_date?: string;
  @IsOptional() @IsString() @MaxLength(255) idempotency_key?: string;
}

export const NFSE_REPEAT_TOOL = {
  name: 'nfse_repeat',
  description:
    'Issue a new NFS-e copying a previous one: same company, customer, service description, service code, municipality, amount, discount, deduction, purchase order and notes. ' +
    'Use it for "emit the same invoice as last month for customer X": find the previous note with nfse_list or nfse_query, then pass its invoice_id or access_key. ' +
    'Optional amount, description and competence_date replace the copied values (a new amount drops the copied discount and deduction); competence_date defaults to today (America/Sao_Paulo). ' +
    'It uses a credit like nfse_issue and returns immediately with the queued status; use nfse_query to follow it. Confirm amount and customer with the user before calling.',
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: {
        type: 'string',
        description: 'UUID of the note to copy. Use this or access_key.',
      },
      access_key: {
        type: 'string',
        description: 'Access key of the note to copy. Use this or invoice_id.',
      },
      amount: {
        type: 'number',
        description: 'New total in BRL. Defaults to the copied amount.',
      },
      description: {
        type: 'string',
        description: 'New service description. Defaults to the copied one.',
      },
      competence_date: {
        type: 'string',
        description: 'YYYY-MM-DD. Defaults to today (America/Sao_Paulo).',
      },
      idempotency_key: {
        type: 'string',
        description: 'Repeat the same key to avoid issuing twice.',
      },
    },
    required: [],
  },
} as const;

const SAO_PAULO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
});

export function createNfseRepeatHandler(
  emitter: Pick<EmissionRouterService, 'emit'>,
  invoiceRepo: Pick<
    IInvoiceRepository,
    'findByIdAndTenantId' | 'findByAccessKeyAndTenantId'
  >,
) {
  return async function nfseRepeatHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{
    invoice_id: string;
    access_key: string;
    status: string;
    copied_from_invoice_id: string;
  }> {
    const params = plainToInstance(
      NfseRepeatInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);

    const environment = executionEnvironment(ctx);
    const source = params.invoice_id
      ? await invoiceRepo.findByIdAndTenantId(
          params.invoice_id,
          ctx.activeTenantId,
          environment,
        )
      : await invoiceRepo.findByAccessKeyAndTenantId(
          params.access_key as string,
          ctx.activeTenantId,
          environment,
        );
    if (!source) {
      throw new Error(
        `Invoice not found: ${params.invoice_id ?? params.access_key}`,
      );
    }

    const snapshot = source.toSnapshot();
    const customer = snapshot.customerSnapshot;
    const service = snapshot.serviceSnapshot;
    const keepsAmount = params.amount === undefined;
    const dto = {
      companyId: snapshot.companyId,
      customer: customer
        ? {
            taxId: customer.taxId,
            name: customer.name,
            email: customer.email,
            foreign: customer.foreign,
            address: customer.address
              ? {
                  city: customer.address.city,
                  state: customer.address.state,
                  country: customer.address.country,
                  municipalityCode: customer.address.municipalityCode,
                }
              : undefined,
          }
        : undefined,
      service: {
        code: service.code,
        municipalityCode: service.municipalityCode,
        description: params.description ?? service.description,
        serviceProfileId: service.serviceProfileId,
        fiscal: service.fiscal,
      },
      amount: params.amount ?? snapshot.amount,
      discount: keepsAmount ? snapshot.discount : undefined,
      deduction: keepsAmount ? snapshot.deduction : undefined,
      purchaseOrder: service.purchaseOrder,
      notes: service.notes,
      competenceDate:
        params.competence_date ?? SAO_PAULO_DATE.format(new Date()),
    } as unknown as CreateInvoiceDto;

    const emitted = await emitter.emit(
      dto,
      ctx.tenantId,
      ctx,
      params.idempotency_key,
    );
    if (emitted.kind !== 'invoice')
      throw new Error('Unexpected schedule result while repeating an invoice');
    return {
      invoice_id: emitted.invoice.id,
      access_key: emitted.invoice.accessKey ?? '',
      status: emitted.invoice.status,
      copied_from_invoice_id: source.id,
    };
  };
}
