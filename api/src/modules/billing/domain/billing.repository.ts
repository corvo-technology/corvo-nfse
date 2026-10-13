import type { BillingPeriodState } from './billing-period';

export interface BillingPlan {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  monthlyCreditAllowance: number;
  creditUnitPriceCents: number;
  dailyLimit: number | null;
  maxActiveCompanies: number;
}
export interface CheckoutState {
  id: string;
  requestKey: string;
  planSlug: string;
  sessionId: string | null;
  url: string | null;
  expiresAt: string | null;
  createdAt: string;
}
export interface BillingState {
  tenantId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
  paidUntil: Date | null;
  pendingPlanSlug: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  billingEmail: string | null;
  checkoutState: CheckoutState | null;
}

export abstract class BillingRepository {
  abstract lockedProviderEvent<T>(
    eventId: string,
    work: () => Promise<T>,
  ): Promise<T>;
  abstract locked<T>(tenantId: string, work: () => Promise<T>): Promise<T>;
  abstract current(
    tenantId: string,
    now?: Date,
  ): Promise<{
    plan: BillingPlan;
    billing: BillingState | null;
    period: BillingPeriodState;
  }>;
  abstract billing(tenantId: string): Promise<BillingState | null>;
  abstract saveBilling(
    tenantId: string,
    patch: Partial<BillingState>,
  ): Promise<void>;
  abstract plan(slug: string): Promise<BillingPlan | null>;
  abstract setPlan(tenantId: string, planId: string): Promise<void>;
  abstract savePeriod(
    period: BillingPeriodState,
    tenantId: string,
  ): Promise<void>;
  abstract period(
    id: string,
    tenantId: string,
  ): Promise<BillingPeriodState | null>;
  abstract reservedPeriod(
    invoiceId: string,
    tenantId: string,
  ): Promise<string | null>;
  abstract dailyUsage(tenantId: string): Promise<number>;
  abstract customerTenant(customerId: string): Promise<string | null>;
  abstract reportablePeriods(tenantId: string): Promise<BillingPeriodState[]>;
  abstract eventSeen(id: string): Promise<boolean>;
  abstract recordEvent(id: string, type: string, hash: string): Promise<void>;
}
