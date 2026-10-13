import type { ProviderSubscription } from './billing-provider.port';

/** Access follows a settled base invoice; a scheduled price change is not entitlement. */
export function subscriptionDecision(
  assignedPlan: string,
  sub: ProviderSubscription,
) {
  if (['canceled', 'incomplete_expired'].includes(sub.status))
    return { planSlug: 'free', status: sub.status, purchased: false };
  const purchased = Boolean(
    sub.paidUntil &&
    sub.paidPlanSlug === sub.planSlug &&
    sub.paidUntil >= sub.periodEnd,
  );
  // A failed renewal onto another price must not report usage at the old meter/rate.
  const unpaidPriceChange =
    assignedPlan !== 'free' && assignedPlan !== sub.planSlug && !purchased;
  return {
    planSlug: purchased ? sub.planSlug! : assignedPlan,
    status: unpaidPriceChange ? 'unpaid' : sub.status,
    purchased,
  };
}
