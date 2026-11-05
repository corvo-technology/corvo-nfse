export interface ProviderSubscription {
  id: string;
  customerId: string;
  status: string;
  planSlug: string | null;
  periodStart: Date;
  periodEnd: Date;
  paidUntil: Date | null;
  paidPlanSlug: string | null;
  included: number;
  cancelAtPeriodEnd: boolean;
  pendingPlanSlug: string | null;
}
export interface ProviderCheckout {
  id: string;
  url: string | null;
  expiresAt: Date;
  status: string | null;
  paymentStatus: string;
  customerId: string | null;
  subscriptionId: string | null;
}
export interface ProviderEvent {
  id: string;
  type: string;
  customerId: string | null;
  subscriptionId: string | null;
}

export abstract class BillingProvider {
  abstract get enabled(): boolean;
  abstract createCustomer(
    tenantId: string,
    email: string | null,
  ): Promise<string>;
  abstract liveSubscriptions(customerId: string): Promise<string[]>;
  abstract checkout(id: string): Promise<ProviderCheckout>;
  abstract findCheckout(
    customerId: string,
    intentId: string,
  ): Promise<ProviderCheckout | null>;
  abstract createCheckout(
    customerId: string,
    tenantId: string,
    planSlug: string,
    intentId: string,
  ): Promise<ProviderCheckout>;
  abstract subscription(id: string): Promise<ProviderSubscription>;
  abstract scheduleChange(
    subscriptionId: string,
    planSlug: string,
  ): Promise<void>;
  abstract portal(customerId: string): Promise<string>;
  abstract verifyEvent(body: Buffer, signature: string): ProviderEvent;
}
