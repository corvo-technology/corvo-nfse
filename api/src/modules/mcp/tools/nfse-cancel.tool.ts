import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { NfseCancelInput } from '../dto/tool-input.dto';

export const NFSE_CANCEL_TOOL = {
  name: 'nfse_cancel',
  description:
    'Cancel an invoice. A queued (scheduled or not yet issued) invoice is cancelled immediately; an authorized NFS-e returns status "cancelling" while the cancellation event is sent to the Sefin. Issued NFS-e require a 15-255 character description.',
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: { type: 'string', description: 'UUID of the invoice' },
      reason: {
        type: 'string',
        enum: ['issue_error', 'service_not_provided', 'other'],
      },
      description: {
        type: 'string',
        description:
          'Free-text justification; required (15-255 chars) for an authorized NFS-e',
      },
    },
    required: ['invoice_id', 'reason'],
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
