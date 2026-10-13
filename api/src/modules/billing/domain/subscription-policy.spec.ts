import { subscriptionDecision } from './subscription-policy';
import type { ProviderSubscription } from './billing-provider.port';
const sub: ProviderSubscription = {
  id: 'sub',
  customerId: 'cus',
  status: 'active',
  planSlug: 'growth',
  periodStart: new Date('2026-10-01'),
  periodEnd: new Date('2026-11-01'),
  paidUntil: new Date('2026-11-01'),
  paidPlanSlug: 'growth',
  included: 750,
  unitCents: 12,
  cancelAtPeriodEnd: false,
  pendingPlanSlug: null,
};
describe('subscription entitlement', () => {
  it('activates the purchased plan only after its settled base invoice', () => {
    expect(subscriptionDecision('free', sub)).toMatchObject({
      planSlug: 'growth',
      purchased: true,
    });
    expect(
      subscriptionDecision('free', { ...sub, paidUntil: null }),
    ).toMatchObject({ planSlug: 'free', purchased: false });
  });
  it('retains the same plan during renewal grace but blocks an unpaid price change', () => {
    const unpaid = {
      ...sub,
      status: 'past_due',
      paidUntil: new Date('2026-10-01'),
    };
    expect(subscriptionDecision('growth', unpaid)).toMatchObject({
      planSlug: 'growth',
      status: 'past_due',
    });
    expect(
      subscriptionDecision('developer', {
        ...unpaid,
        paidPlanSlug: 'developer',
      }),
    ).toMatchObject({ planSlug: 'developer', status: 'unpaid' });
  });
  it('returns to free on cancellation and preserves a paid scheduled cancellation until it ends', () => {
    expect(
      subscriptionDecision('growth', { ...sub, status: 'canceled' }),
    ).toMatchObject({ planSlug: 'free' });
    expect(
      subscriptionDecision('growth', { ...sub, cancelAtPeriodEnd: true }),
    ).toMatchObject({ planSlug: 'growth' });
  });
});
