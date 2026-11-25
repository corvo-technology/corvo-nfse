import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, IsUUID, validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { BillingService } from '@/modules/billing/application/billing.service';
import type { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import type { WooviPaymentsService } from '@/modules/billing/application/woovi-payments.service';
import { invalidInput } from './tool-input-errors';

export const PAYMENT_STATUS_TOOL = {
  name: 'payment_status',
  description:
    'Follow a credit purchase created with credits_purchase. Pass exactly one of payment_id (Pix or card) or session_id (card). Returns pending, paid (with the new credit balance), expired or cancelled. Poll every few seconds while the person pays; never assume it was paid.',
  inputSchema: {
    type: 'object',
    properties: {
      payment_id: {
        type: 'string',
        description: 'payment_id returned by credits_purchase.',
      },
      session_id: {
        type: 'string',
        description: 'session_id returned by credits_purchase for card.',
      },
    },
  },
} as const;

class PaymentStatusInput {
  @IsOptional() @IsUUID() payment_id?: string;
  @IsOptional() @IsString() session_id?: string;
}

export type PaymentStatusResult = {
  payment_id: string | null;
  status: 'pending' | 'paid' | 'expired' | 'cancelled';
  units: number | null;
  paid_at: string | null;
  balance?: number;
};

const NOT_FOUND = 'Pagamento não encontrado.';

export function createPaymentStatusHandler(
  pix: Pick<WooviPaymentsService, 'paymentStatus'>,
  billing: Pick<BillingService, 'checkoutStatus'>,
  usage: Pick<BillingUsageService, 'status'>,
) {
  async function balance(tenantId: string): Promise<number> {
    // Same arithmetic as credits_balance.
    const status = await usage.status(tenantId);
    return (
      (status.blocked ? 0 : status.included_remaining) + status.avulsoBalance
    );
  }

  return async function paymentStatusHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<PaymentStatusResult> {
    const params = plainToInstance(
      PaymentStatusInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    if (Boolean(params.payment_id) === Boolean(params.session_id))
      throw new Error(
        'Invalid input: send exactly one of payment_id or session_id',
      );
    const tenantId = ctx.activeTenantId;

    if (params.payment_id) {
      const view = await pix.paymentStatus(tenantId, params.payment_id);
      if (!view) throw new Error(NOT_FOUND);
      const status = view.status === 'failed' ? 'cancelled' : view.status;
      return {
        payment_id: view.id,
        status,
        units: view.units,
        paid_at: view.paid_at,
        ...(status === 'paid' ? { balance: await balance(tenantId) } : {}),
      };
    }

    let session;
    try {
      session = await billing.checkoutStatus(tenantId, params.session_id!);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'checkout_not_found' || code === 'resource_missing')
        throw new Error(NOT_FOUND);
      throw error;
    }
    const status: PaymentStatusResult['status'] = session.activated
      ? 'paid'
      : session.status === 'expired'
        ? 'expired'
        : 'pending';
    return {
      payment_id: null,
      status,
      units: null,
      paid_at: null,
      ...(status === 'paid' ? { balance: await balance(tenantId) } : {}),
    };
  };
}
