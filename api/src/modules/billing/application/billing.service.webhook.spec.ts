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
  const service = new BillingService(
    {} as TenantWorkDiscovery,
    repository as unknown as BillingRepository,
    provider as unknown as BillingProvider,
  );
  return { service, repository, provider };
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
