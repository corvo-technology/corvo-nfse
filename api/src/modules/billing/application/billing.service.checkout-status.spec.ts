import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { BillingProvider } from '../domain/billing-provider.port';
import type { BillingRepository } from '../domain/billing.repository';
import { BillingService } from './billing.service';

function build(session: Record<string, unknown>, paid: boolean) {
  const repository = {
    billing: jest.fn().mockResolvedValue({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
      stripeStatus: null,
      paidUntil: null,
    }),
  };
  const provider = {
    checkout: jest.fn().mockResolvedValue({
      id: 'cs_1',
      status: 'complete',
      paymentStatus: 'paid',
      customerId: 'cus_1',
      subscriptionId: null,
      intentId: null,
      ...session,
    }),
  };
  const payments = { isPaid: jest.fn().mockResolvedValue(paid) };
  const service = new BillingService(
    {} as TenantWorkDiscovery,
    repository as unknown as BillingRepository,
    provider as unknown as BillingProvider,
    payments as never,
  );
  return { service, payments };
}

describe('BillingService.checkoutStatus for one-time payments', () => {
  it('reports activated once the payment intent was fulfilled, even with no plan', async () => {
    const f = build({ intentId: 'intent-1' }, true);
    await expect(f.service.checkoutStatus('t', 'cs_1')).resolves.toMatchObject({
      activated: true,
    });
    expect(f.payments.isPaid).toHaveBeenCalledWith('intent-1');
  });
  it('keeps waiting while the intent is not fulfilled yet', async () => {
    const f = build({ intentId: 'intent-1' }, false);
    await expect(f.service.checkoutStatus('t', 'cs_1')).resolves.toMatchObject({
      activated: false,
    });
  });
});
