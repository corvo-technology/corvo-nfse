import { PaymentHistoryService } from './payment-history.service';
import { MemoryPaymentIntentStore } from './memory-payment-intent-store.testing';
import type { PaymentIntent } from '../domain/payment-intent';

const tenant = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

function intent(patch: Partial<PaymentIntent>): PaymentIntent {
  return {
    id: Math.random().toString(36).slice(2),
    tenantId: tenant,
    kind: 'avulso',
    planSlug: null,
    cycle: null,
    units: 10,
    amountCents: 990,
    provider: 'woovi',
    providerRef: Math.random().toString(36).slice(2),
    idempotencyKey: 'k',
    status: 'paid',
    expiresAt: null,
    paidAt: new Date('2026-11-05T22:28:48Z'),
    checkout: null,
    createdAt: new Date('2026-11-05T22:27:57Z'),
    ...patch,
  };
}

describe('PaymentHistoryService', () => {
  it('lists only paid payments of this tenant, newest first, in plain fields', async () => {
    const store = new MemoryPaymentIntentStore();
    store.rows.push(
      intent({
        id: 'old',
        paidAt: new Date('2026-11-01T10:00:00Z'),
        units: 3,
        amountCents: 297,
      }),
      intent({ id: 'new', paidAt: new Date('2026-11-05T22:28:48Z') }),
      intent({ id: 'pending', status: 'pending', paidAt: null }),
      intent({ id: 'expired', status: 'expired', paidAt: null }),
      intent({ id: 'cancelled', status: 'cancelled', paidAt: null }),
      intent({ id: 'not-mine', tenantId: other }),
      intent({
        id: 'plan',
        kind: 'plan',
        planSlug: 'equipe',
        cycle: 'annual',
        units: null,
        amountCents: 100680,
        provider: 'stripe',
        paidAt: new Date('2026-11-03T12:00:00Z'),
      }),
    );
    const out = await new PaymentHistoryService(store).list(tenant);
    expect(out.map((p) => p.id)).toEqual(['new', 'plan', 'old']);
    expect(out[1]).toEqual({
      id: 'plan',
      kind: 'plan',
      plan_slug: 'equipe',
      cycle: 'annual',
      units: null,
      amount_cents: 100680,
      provider: 'stripe',
      paid_at: '2026-11-03T12:00:00.000Z',
    });
  });

  it('caps the list', async () => {
    const store = new MemoryPaymentIntentStore();
    for (let i = 0; i < 80; i++)
      store.rows.push(
        intent({ id: `p${i}`, paidAt: new Date(2026, 10, 1, 0, i) }),
      );
    expect(await new PaymentHistoryService(store).list(tenant)).toHaveLength(
      50,
    );
  });
});
