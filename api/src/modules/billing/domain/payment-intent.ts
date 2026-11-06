export type PaymentIntentKind = 'plan' | 'avulso';
export type PaymentIntentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'expired'
  | 'mismatch'
  | 'rejected'
  | 'cancelled';

export interface PaymentIntent {
  id: string;
  tenantId: string;
  kind: PaymentIntentKind;
  planSlug: string | null;
  cycle: 'monthly' | 'annual' | null;
  units: number | null;
  amountCents: number;
  provider: 'woovi' | 'stripe';
  /** Woovi correlationID. */
  providerRef: string;
  idempotencyKey: string | null;
  status: PaymentIntentStatus;
  expiresAt: Date | null;
  paidAt: Date | null;
  /** What the customer needs to pay; replayed on an idempotent retry. */
  checkout: PixCheckout | null;
  createdAt: Date;
}

export interface PixCheckout {
  /** 'card' for Stripe sessions: only paymentLinkUrl is meaningful then. */
  method: 'pix' | 'card';
  brCode: string | null;
  qrCodeImage: string | null;
  paymentLinkUrl: string;
  expiresAt: string | null;
  /** Provider's own id for the contract (Woovi globalID), used to cancel it. */
  providerId?: string | null;
}

export abstract class PaymentIntentStore {
  abstract findByKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<PaymentIntent | null>;
  abstract findByRef(
    provider: string,
    providerRef: string,
  ): Promise<PaymentIntent | null>;
  /** The tenant's Pix Automático contracts that can still charge (waiting authorization, or active), newest first. */
  abstract findLiveSubscriptions(tenantId: string): Promise<PaymentIntent[]>;
  /** Throws an error with code '23505' on a duplicate (provider, providerRef). */
  abstract insert(intent: PaymentIntent): Promise<void>;
  /** Atomic pending/authorized/expired -> paid (a correct late payment is honored). False if already paid. */
  abstract markPaid(id: string, paidAt: Date): Promise<boolean>;
  abstract setStatus(
    id: string,
    status: PaymentIntentStatus,
    onlyFrom?: PaymentIntentStatus[],
  ): Promise<void>;
}
