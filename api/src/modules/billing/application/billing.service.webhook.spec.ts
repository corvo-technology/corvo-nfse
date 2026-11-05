import { createHash } from 'node:crypto';
import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { BillingProvider } from '../domain/billing-provider.port';
import type { BillingRepository } from '../domain/billing.repository';
import { BillingService } from './billing.service';

type Event = {
  id: string;
  type: string;
  customerId: string | null;
  subscriptionId: string | null;
  payment?: { intentId: string; paid: boolean } | null;
};

function build(event: Event, seen = false) {
  const repository = {
    customerTenant: jest.fn().mockResolvedValue('tenant-1'),
    locked: jest.fn((_tenantId: string, work: () => Promise<void>) => work()),
    lockedProviderEvent: jest.fn((_id: string, work: () => Promise<void>) =>
      work(),
    ),
    eventSeen: jest.fn().mockResolvedValue(seen),
    recordEvent: jest.fn().mockResolvedValue(undefined),
    billing: jest.fn().mockResolvedValue(null),
  };
  const provider = {
    verifyEvent: jest.fn().mockReturnValue(event),
    subscription: jest.fn().mockResolvedValue({
      id: event.subscriptionId,
      customerId: event.customerId,
    }),
  };
  const payments = { complete: jest.fn().mockResolvedValue(undefined) };
  const service = new BillingService(
    {} as TenantWorkDiscovery,
    repository as unknown as BillingRepository,
    provider as unknown as BillingProvider,
    payments as never,
  );
  return { service, repository, provider, payments };
}

describe('BillingService.webhook event handling', () => {
  const body = Buffer.from('{"id":"evt"}');

  it('acknowledges unsupported events without lock, Stripe call or ledger row', async () => {
    const { service, repository, provider } = build({
      id: 'evt_1',
      type: 'charge.succeeded',
      customerId: null,
      subscriptionId: null,
    });

    await expect(service.webhook(body, 'sig')).resolves.toBeUndefined();

    expect(repository.customerTenant).not.toHaveBeenCalled();
    expect(repository.locked).not.toHaveBeenCalled();
    expect(repository.lockedProviderEvent).not.toHaveBeenCalled();
    expect(provider.subscription).not.toHaveBeenCalled();
    expect(repository.recordEvent).not.toHaveBeenCalled();
  });

  it('fulfils a paid one-time checkout exactly once per Stripe event', async () => {
    const event = {
      id: 'evt_pay',
      type: 'checkout.session.completed',
      customerId: 'cus_1',
      subscriptionId: null,
      payment: { intentId: 'intent-1', paid: true },
    };
    const first = build(event);
    await first.service.webhook(body, 'sig');
    expect(first.payments.complete).toHaveBeenCalledWith('intent-1');
    expect(first.provider.subscription).not.toHaveBeenCalled();
    expect(first.repository.recordEvent).toHaveBeenCalled();

    const replay = build(event, true);
    await replay.service.webhook(body, 'sig');
    expect(replay.payments.complete).not.toHaveBeenCalled();
  });

  it('does not fulfil an unpaid one-time checkout', async () => {
    const { service, payments } = build({
      id: 'evt_unpaid',
      type: 'checkout.session.completed',
      customerId: 'cus_1',
      subscriptionId: null,
      payment: { intentId: 'intent-1', paid: false },
    });
    await service.webhook(body, 'sig');
    expect(payments.complete).not.toHaveBeenCalled();
  });

  it('does not reprocess a supported event that was already seen', async () => {
    const { service, repository, provider } = build(
      {
        id: 'evt_2',
        type: 'customer.subscription.updated',
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
      },
      true,
    );

    await service.webhook(body, 'sig');

    expect(repository.locked).toHaveBeenCalledTimes(1);
    expect(provider.subscription).not.toHaveBeenCalled();
    expect(repository.recordEvent).not.toHaveBeenCalled();
  });

  it('fetches the subscription and records a supported new event', async () => {
    const { service, repository, provider } = build({
      id: 'evt_3',
      type: 'customer.subscription.updated',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
    });

    await service.webhook(body, 'sig');

    expect(provider.subscription).toHaveBeenCalledWith('sub_1');
    expect(repository.recordEvent).toHaveBeenCalledWith(
      'evt_3',
      'customer.subscription.updated',
      createHash('sha256').update(body).digest('hex'),
    );
  });
});
