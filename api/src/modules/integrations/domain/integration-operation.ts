import type { CommercialState, NormalizedOperation } from './connector';

const ORDER: Record<Exclude<CommercialState, 'canceled'>, number> = {
  pending: 0,
  paid: 1,
  disputed: 2,
  refunded: 3,
};

/** The commercial state only moves forward; an old "paid" notice cannot undo a refund. */
export function mergeCommercialState(
  current: CommercialState,
  incoming: CommercialState,
): CommercialState {
  if (current === 'canceled') return current;
  if (incoming === 'canceled')
    return current === 'pending' ? incoming : current;
  return ORDER[incoming] > ORDER[current] ? incoming : current;
}

export type FiscalStatus = 'none' | 'blocked' | 'needs_attention' | 'submitted';

export type BlockReason =
  | 'connection_inactive'
  | 'before_active_from'
  | 'refunded'
  | 'disputed'
  | 'not_paid'
  | 'unsupported_currency'
  | 'invalid_amount'
  | 'seller_not_issuer'
  | 'no_rule'
  | 'ambiguous_rule'
  | 'customer_tax_id_missing'
  | 'refund_after_invoice'
  | 'cancel_requested'
  | 'cancel_failed'
  | 'quota_exceeded'
  | 'company_not_ready'
  | 'invoice_rejected'
  | 'ignored_by_user';

export interface IntegrationOperation {
  id: string;
  tenantId: string;
  connectionId: string;
  provider: string;
  environment: 'test' | 'live';
  externalAccountId: string;
  operationKey: string;
  commercialState: CommercialState;
  fiscalStatus: FiscalStatus;
  blockReason: BlockReason | null;
  snapshot: NormalizedOperation;
  ruleId: string | null;
  emissionRequest: Record<string, unknown> | null;
  emissionRequestHash: string | null;
  idempotencyKey: string | null;
  invoiceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The snapshot lives in a jsonb column, where dates become ISO strings. */
export function parseSnapshot(
  raw: Record<string, unknown>,
): NormalizedOperation {
  const value = raw as unknown as NormalizedOperation & {
    occurredAt: string | Date;
    paidAt: string | Date | null;
  };
  return {
    ...value,
    occurredAt: new Date(value.occurredAt),
    paidAt: value.paidAt ? new Date(value.paidAt) : null,
  };
}
