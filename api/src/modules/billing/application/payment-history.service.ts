import { Injectable } from '@nestjs/common';
import { PaymentIntentStore } from '../domain/payment-intent';

const HISTORY_LIMIT = 50;

export interface PaymentRecord {
  id: string;
  kind: 'plan' | 'avulso';
  plan_slug: string | null;
  cycle: 'monthly' | 'annual' | null;
  units: number | null;
  amount_cents: number;
  provider: 'woovi' | 'stripe';
  paid_at: string | null;
}

/** What the customer has actually paid Corvo, through any provider. Unpaid attempts are not history. */
@Injectable()
export class PaymentHistoryService {
  constructor(private readonly intents: PaymentIntentStore) {}

  async list(tenantId: string): Promise<PaymentRecord[]> {
    const rows = await this.intents.listPaid(tenantId, HISTORY_LIMIT);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      plan_slug: r.planSlug,
      cycle: r.cycle,
      units: r.units,
      amount_cents: r.amountCents,
      provider: r.provider,
      paid_at: r.paidAt?.toISOString() ?? null,
    }));
  }
}
