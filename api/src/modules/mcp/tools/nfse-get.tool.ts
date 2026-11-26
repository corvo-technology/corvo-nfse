import { plainToInstance } from 'class-transformer';
import { IsUUID, validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { toDetailedInvoice } from './public-shapes';
import { TYPE_PROPERTY } from './nfe.tools';
import { invalidInput } from './tool-input-errors';

export const NFSE_GET_TOOL = {
  name: 'nfse_get',
  description:
    'Get one NFS-e by its internal invoice id (the id returned by nfse_issue and nfse_list), including status, amounts, customer and the events timeline (every status change with its reason and time). Use it to explain why a note was rejected or what happened to it. To look a note up by access key use nfse_query. Fails when the id does not exist in this workspace and environment. With type "nfe" it returns the NF-e and its timeline (states and fiscal events).',
  inputSchema: {
    type: 'object',
    properties: {
      type: TYPE_PROPERTY,
      invoice_id: {
        type: 'string',
        description: 'Internal invoice id (UUID).',
      },
    },
    required: ['invoice_id'],
  },
} as const;

class NfseGetInput {
  @IsUUID() invoice_id!: string;
}

export function createNfseGetHandler(
  invoiceService: Pick<InvoiceService, 'findById' | 'getEvents'>,
) {
  return async function nfseGetHandler(rawParams: unknown, ctx: AuthContext) {
    const params = plainToInstance(
      NfseGetInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const environment = executionEnvironment(ctx);
    const invoice = await invoiceService.findById(
      params.invoice_id,
      ctx.activeTenantId,
      environment,
    );
    const events = await invoiceService.getEvents(
      params.invoice_id,
      ctx.activeTenantId,
      environment,
    );
    return {
      invoice: toDetailedInvoice(invoice),
      events: events.map((event) => event.toJSON()),
    };
  };
}
