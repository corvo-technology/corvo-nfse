import { plainToInstance } from 'class-transformer';
import { IsIn, IsUUID, validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import {
  REVIEW_ACTIONS,
  type InvoiceReviewService,
  type ReviewAction,
} from '@/modules/invoice/application/invoice-review.service';
import type { IInvoiceRepository } from '@/modules/invoice/domain/invoice.repository';
import { toDetailedInvoice } from './public-shapes';
import { invalidInput } from './tool-input-errors';

export class NfseReviewInput {
  @IsUUID() invoice_id!: string;
  @IsIn(REVIEW_ACTIONS) action!: ReviewAction;
}

export const NFSE_REVIEW_TOOL = {
  name: 'nfse_review',
  description:
    'Resolve one invoice stuck in status "manual_review" (the portal did not confirm whether the NFS-e exists). Only valid in that status; otherwise it fails and tells the current status. Actions: "retry" sends the invoice back to reconciliation with the same DPS: the portal is asked for that DPS before anything is sent, so it never issues a second NFS-e; it ends authorized, rejected, or back in review if the portal is still silent. It is safe. "discard" asks the portal about the DPS: if the NFS-e exists the invoice becomes authorized; only when the portal confirms it was never registered is the invoice rejected (credit refunded); otherwise it stays in review. A discarded invoice leaves its number (DPS) skipped. Before discard, explain to the person that the invoice number will be skipped and ask for confirmation. Prefer retry first. The platform also checks the portal automatically every 30 minutes. The result is asynchronous: call nfse_get later to see the final status.',
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: {
        type: 'string',
        description: 'UUID of the invoice in manual_review',
      },
      action: {
        type: 'string',
        enum: [...REVIEW_ACTIONS],
        description: '"retry" (safe, same DPS) or "discard" (skips the number)',
      },
    },
    required: ['invoice_id', 'action'],
  },
} as const;

export function createNfseReviewHandler(
  review: Pick<InvoiceReviewService, 'apply'>,
  invoiceRepo: Pick<IInvoiceRepository, 'findByIdAndTenantId'>,
) {
  return async function nfseReviewHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{
    invoice_id: string;
    action: ReviewAction;
    outcome: 'accepted';
    status: string;
    invoice: Record<string, unknown>;
  }> {
    const params = plainToInstance(
      NfseReviewInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const environment = executionEnvironment(ctx);
    const current = await invoiceRepo.findByIdAndTenantId(
      params.invoice_id,
      ctx.activeTenantId,
      environment,
    );
    if (!current) throw new Error('Invoice not found');
    if (current.status !== 'manual_review')
      throw new Error(
        `Invoice is in status "${current.status}"; nfse_review only works on invoices in "manual_review"`,
      );
    const [result] = await review.apply(
      ctx.activeTenantId,
      environment,
      params.action,
      [params.invoice_id],
      ctx.mcpConnectionId ?? ctx.authUserId,
    );
    if (result?.outcome !== 'accepted')
      throw new Error(
        `Review not applied (${result?.outcome === 'skipped' ? result.reason : 'unknown'}); check the invoice with nfse_get`,
      );
    const updated =
      (await invoiceRepo.findByIdAndTenantId(
        params.invoice_id,
        ctx.activeTenantId,
        environment,
      )) ?? current;
    return {
      invoice_id: params.invoice_id,
      action: params.action,
      outcome: 'accepted',
      status: updated.status,
      invoice: toDetailedInvoice(updated),
    };
  };
}
