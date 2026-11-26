import { Injectable } from '@nestjs/common';
import { BillingUsageService } from './billing-usage.service';

/**
 * Usage for `self_hosted`: nothing is reserved, spent or settled, so no usage period or credit
 * balance exists. `status` answers with neutral values for the few readers that still ask.
 */
@Injectable()
export class NoopBillingUsageService extends BillingUsageService {
  constructor() {
    super(null as never);
  }

  override status(tenantId: string): ReturnType<BillingUsageService['status']> {
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
    );
    return Promise.resolve({
      plan: {
        id: 'self-hosted',
        slug: 'self-hosted',
        name: 'Self-hosted',
        active: true,
        monthlyCreditAllowance: 0,
        creditUnitPriceCents: 0,
        dailyLimit: null,
        maxActiveCompanies: 999999,
      },
      billing: null,
      period: {
        id: 'self-hosted',
        tenantId,
        planSlug: 'self-hosted',
        periodStart,
        periodEnd,
        included: 0,
        authorized: 0,
        reserved: 0,
        customerId: null,
        subscriptionId: null,
      },
      blocked: false,
      dailyUsage: 0,
      avulsoBalance: 0,
      included_remaining: 0,
      hard_limit: 0,
    });
  }

  override reserve(): Promise<string | null> {
    return Promise.resolve(null);
  }

  override settle(): Promise<void> {
    return Promise.resolve();
  }

  override settleDocument(): Promise<void> {
    return Promise.resolve();
  }
}
