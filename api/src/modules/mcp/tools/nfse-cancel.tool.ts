import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import {
  CANCELLATION_DESCRIPTION_MAX,
  CANCELLATION_DESCRIPTION_MIN,
} from '@/modules/invoice/domain/cancellation-reason';
import { NfseCancelInput } from '../dto/tool-input.dto';
import { TYPE_PROPERTY } from './nfe.tools';

export const NFSE_CANCEL_TOOL = {
  name: 'nfse_cancel',
  description: `Cancel an invoice. A queued (scheduled or not yet issued) invoice is cancelled immediately; an authorized NFS-e returns status "cancelling" while the cancellation event is sent to the Sefin. An invoice still being issued (status "processing") registers the request and stays "processing" with the request recorded; if it is authorized it is cancelled automatically at the Sefin and the credit is not refunded, and if the emission is rejected or fails the request is discarded. Issued NFS-e and invoices being issued require a ${CANCELLATION_DESCRIPTION_MIN}-${CANCELLATION_DESCRIPTION_MAX} character description. With type "nfe" it cancels an authorized NF-e at the SEFAZ: send only invoice_id and description (the justification, 15 to 255 characters); reason is not used. The same for type "nfce" (a NFC-e is cancelled within 30 minutes of the authorization).`,
  inputSchema: {
    type: 'object',
    properties: {
      type: TYPE_PROPERTY,
      invoice_id: { type: 'string', description: 'UUID of the invoice' },
      reason: {
        type: 'string',
        enum: ['issue_error', 'service_not_provided', 'other'],
      },
      description: {
        type: 'string',
        maxLength: CANCELLATION_DESCRIPTION_MAX,
        description: `Free-text justification; required (${CANCELLATION_DESCRIPTION_MIN}-${CANCELLATION_DESCRIPTION_MAX} chars) for an authorized NFS-e or an invoice being issued (processing)`,
      },
    },
    required: ['invoice_id'],
  },
} as const;

export function createNfseCancelHandler(
  invoiceService: Pick<InvoiceService, 'cancel'>,
) {
  return async function nfseCancelHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{
    invoice_id: string;
    status: string;
    cancelled_at: string | null;
  }> {
    const params = plainToInstance(
      NfseCancelInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0)
      throw new Error(
        `Invalid input: ${errors.map((e) => e.property).join(', ')}`,
      );
    const invoice = await invoiceService.cancel(
      params.invoice_id,
      ctx.activeTenantId,
      executionEnvironment(ctx),
      { reason: params.reason, description: params.description },
    );
    return {
      invoice_id: invoice.id,
      status: invoice.status,
      cancelled_at: invoice.cancelledAt?.toISOString() ?? null,
    };
  };
}
