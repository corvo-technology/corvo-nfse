import { WebhookOutboxService } from './webhook-outbox.service';
import { WebhookDeliveryHttpError } from '../infra/webhook-dispatcher.adapter';
import { WebhookEvent } from '../domain/webhook-event';

describe('WebhookOutboxService', () => {
  const baseDelivery = {
    id: 'delivery-1',
    tenantId: 'tenant-1',
    webhookConfigId: 'config-1',
    eventType: 'webhook.test',
    environment: 'test' as const,
    url: 'https://example.test/webhook',
    status: 'pending' as const,
    retryCount: 0,
    nextRetryAt: new Date(),
    createdAt: new Date(),
  };

  const event: WebhookEvent = {
    id: 'evt-1',
    type: 'webhook.test',
    environment: 'test',
    createdAt: new Date().toISOString(),
    data: { message: 'hello' },
  };

  function buildService(
    overrides: {
      repo?: {
        update: jest.Mock;
        findPendingDeliveries?: jest.Mock;
        claimDelivery?: jest.Mock;
      };
      adapter?: { sign: jest.Mock; send: jest.Mock };
      secrets?: { findSecret: jest.Mock };
    } = {},
  ) {
    const repo = overrides.repo ?? {
      update: jest.fn(),
      findPendingDeliveries: jest.fn(),
    };
    const adapter = overrides.adapter ?? {
      sign: jest.fn().mockReturnValue('signature'),
      send: jest.fn().mockResolvedValue({ statusCode: 204 }),
    };
    const secrets = overrides.secrets ?? {
      findSecret: jest.fn().mockResolvedValue('test-secret'),
    };
    const bus = { publishBestEffort: jest.fn() };
    const service = new WebhookOutboxService(
      {
        visit: async (_kind: string, work: (id: string) => Promise<void>) =>
          work('tenant-1'),
      } as never,
      repo as never,
      adapter,
      secrets,
      bus as never,
    );
    return { service, repo, adapter, secrets, bus };
  }

  it('saves the invoice of the event with the delivery and logs it', async () => {
    const invoiceId = '33333333-3333-4333-8333-333333333333';
    const save = jest.fn((record: unknown) => Promise.resolve(record));
    const { service } = buildService({
      repo: { update: jest.fn(), save } as never,
    });
    const logSpy = jest
      .spyOn(
        (service as unknown as { logger: { log: () => void } }).logger,
        'log',
      )
      .mockImplementation();
    await service.enqueue({
      tenantId: 'tenant-1',
      webhookConfigId: 'config-1',
      eventType: 'nfse.invoice.authorized',
      environment: 'live',
      url: 'https://example.test/webhook',
      payload: { ...event, data: { invoiceId } },
      secret: 'shh',
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId }),
      'tenant-1',
    );
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toContain(`invoiceId=${invoiceId}`);
    expect(line).toContain('eventType=nfse.invoice.authorized');
    expect(line).not.toContain('shh');
    expect(line).not.toContain('example.test');
  });

  it('does not invent an invoice for events without one', async () => {
    const save = jest.fn((record: unknown) => Promise.resolve(record));
    const { service } = buildService({
      repo: { update: jest.fn(), save } as never,
    });
    await service.enqueue({
      tenantId: 'tenant-1',
      webhookConfigId: 'config-1',
      eventType: 'webhook.test',
      environment: 'test',
      url: 'https://example.test/webhook',
      payload: { ...event, data: { invoiceId: 'not-a-uuid' } },
      secret: 'shh',
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: undefined }),
      'tenant-1',
    );
  });

  it('logs the event and invoice when a delivery goes through', async () => {
    const { service } = buildService();
    const logSpy = jest
      .spyOn(
        (service as unknown as { logger: { log: () => void } }).logger,
        'log',
      )
      .mockImplementation();
    await service.attemptDelivery(
      { ...baseDelivery, invoiceId: 'inv-1' },
      event,
      'test-secret',
    );
    expect(String(logSpy.mock.calls[0][0])).toContain(
      'delivered successfully eventType=webhook.test invoiceId=inv-1',
    );
  });

  it('records the HTTP status code after a successful delivery', async () => {
    const { service, repo } = buildService({
      adapter: {
        sign: jest.fn().mockReturnValue('signature'),
        send: jest.fn().mockResolvedValue({ statusCode: 204 }),
      },
    });

    await service.attemptDelivery(baseDelivery, event, 'test-secret');

    expect(repo.update).toHaveBeenCalledWith(
      'delivery-1',
      'tenant-1',
      expect.objectContaining({ status: 'sent', statusCode: 204 }),
    );
  });

  it('records the HTTP status code and schedules a retry after an HTTP failure', async () => {
    const { service, repo } = buildService({
      adapter: {
        sign: jest.fn().mockReturnValue('signature'),
        send: jest.fn().mockRejectedValue(new WebhookDeliveryHttpError(405)),
      },
    });

    await service.attemptDelivery(baseDelivery, event, 'test-secret');

    expect(repo.update).toHaveBeenCalledWith(
      'delivery-1',
      'tenant-1',
      expect.objectContaining({ status: 'delayed', statusCode: 405 }),
    );
  });

  describe('alert on final failure', () => {
    const lastTry = {
      ...baseDelivery,
      environment: 'live' as const,
      eventType: 'nfse.invoice.authorized',
      retryCount: 4,
    };
    const failing = () => ({
      sign: jest.fn().mockReturnValue('signature'),
      send: jest.fn().mockRejectedValue(new WebhookDeliveryHttpError(500)),
    });

    it('warns the account once the last try fails', async () => {
      const { service, bus } = buildService({ adapter: failing() });
      await service.attemptDelivery(lastTry, event, 'test-secret');
      expect(bus.publishBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          notice: {
            kind: 'webhook-delivery-failed',
            webhookConfigId: 'config-1',
            eventType: 'nfse.invoice.authorized',
          },
        }),
      );
    });

    it('stays quiet while retries are left', async () => {
      const { service, bus } = buildService({ adapter: failing() });
      await service.attemptDelivery(
        { ...lastTry, retryCount: 1 },
        event,
        'test-secret',
      );
      expect(bus.publishBestEffort).not.toHaveBeenCalled();
    });

    it('stays quiet for test deliveries', async () => {
      const { service, bus } = buildService({ adapter: failing() });
      await service.attemptDelivery(
        { ...lastTry, environment: 'test' },
        event,
        'test-secret',
      );
      expect(bus.publishBestEffort).not.toHaveBeenCalled();
    });
  });

  it('keeps statusCode empty for transport failures', async () => {
    const { service, repo } = buildService({
      adapter: {
        sign: jest.fn().mockReturnValue('signature'),
        send: jest.fn().mockRejectedValue(new Error('network unavailable')),
      },
    });

    await service.attemptDelivery(baseDelivery, event, 'test-secret');

    expect(repo.update).toHaveBeenCalledWith(
      'delivery-1',
      'tenant-1',
      expect.not.objectContaining({ statusCode: expect.anything() }),
    );
  });

  it('uses the explicit secret passed by the caller', async () => {
    const { service, adapter, secrets } = buildService();

    await service.attemptDelivery(baseDelivery, event, 'caller-secret');

    expect(secrets.findSecret).not.toHaveBeenCalled();
    expect(adapter.sign).toHaveBeenCalledWith(event, 'caller-secret');
  });

  it('processNext reads the secret of a webhook once for many deliveries', async () => {
    const due = [1, 2, 3].map((n) => ({
      ...baseDelivery,
      id: `delivery-${n}`,
      payload: event,
    }));
    const { service, secrets } = buildService({
      repo: {
        update: jest.fn(),
        claimDelivery: jest.fn().mockResolvedValue(true),
        findPendingDeliveries: jest.fn().mockResolvedValue(due),
      },
    });

    await service.processNext();

    expect(secrets.findSecret).toHaveBeenCalledTimes(1);
  });

  it('processNext resolves the secret via WebhookSecrets for each due delivery', async () => {
    const due = [{ ...baseDelivery, payload: event }];
    const { service, repo, adapter, secrets } = buildService({
      repo: {
        update: jest.fn(),
        claimDelivery: jest.fn().mockResolvedValue(true),
        findPendingDeliveries: jest.fn().mockResolvedValue(due),
      },
      adapter: {
        sign: jest.fn().mockReturnValue('signature'),
        send: jest.fn().mockResolvedValue({ statusCode: 200 }),
      },
    });

    await service.processNext();

    expect(repo.findPendingDeliveries).toHaveBeenCalledTimes(1);
    expect(secrets.findSecret).toHaveBeenCalledWith('tenant-1', 'config-1');
    expect(adapter.send).toHaveBeenCalledWith(
      baseDelivery.url,
      event,
      'signature',
      baseDelivery.environment,
    );
  });

  it('processNext skips deliveries without a payload', async () => {
    const due = [{ ...baseDelivery }]; // no payload
    const { service, secrets } = buildService({
      repo: {
        update: jest.fn(),
        claimDelivery: jest.fn().mockResolvedValue(true),
        findPendingDeliveries: jest.fn().mockResolvedValue(due),
      },
    });

    await service.processNext();

    expect(secrets.findSecret).not.toHaveBeenCalled();
  });

  it('processNext does not send a delivery another runtime already claimed', async () => {
    const due = [{ ...baseDelivery, payload: event }];
    const { service, adapter, secrets } = buildService({
      repo: {
        update: jest.fn(),
        claimDelivery: jest.fn().mockResolvedValue(false),
        findPendingDeliveries: jest.fn().mockResolvedValue(due),
      },
      adapter: {
        sign: jest.fn().mockReturnValue('signature'),
        send: jest.fn().mockResolvedValue({ statusCode: 200 }),
      },
    });

    await service.processNext();

    expect(secrets.findSecret).not.toHaveBeenCalled();
    expect(adapter.send).not.toHaveBeenCalled();
  });
  describe('manualRetry environment', () => {
    const liveDelivery = { ...baseDelivery, environment: 'live' as const };
    const build = () => {
      const repo = {
        update: jest.fn(),
        findByIdAndTenantId: jest.fn().mockResolvedValue(liveDelivery),
      };
      return { repo, service: buildService({ repo: repo }).service };
    };

    it('lets a test API key retry only test deliveries', async () => {
      const { repo, service } = build();
      await expect(
        service.manualRetry('tenant-1', 'delivery-1', 'test'),
      ).rejects.toThrow();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets a live key (or a dashboard session) retry a live delivery', async () => {
      const { repo, service } = build();
      await service.manualRetry('tenant-1', 'delivery-1', 'live');
      await service.manualRetry('tenant-1', 'delivery-1');
      expect(repo.update).toHaveBeenCalledTimes(2);
    });
  });
});
