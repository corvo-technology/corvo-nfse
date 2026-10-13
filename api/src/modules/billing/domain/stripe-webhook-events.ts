/** Events the billing webhook acts on. Keep in sync with the endpoint's enabled_events in Stripe. */
export const SUPPORTED_STRIPE_EVENTS: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.created',
]);

export function isSupportedStripeEvent(type: string): boolean {
  return SUPPORTED_STRIPE_EVENTS.has(type);
}
