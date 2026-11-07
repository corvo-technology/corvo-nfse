import { CursorPage } from '@/shared/http/pagination';
import { WebhooksConfigController } from './webhooks-config.controller';

describe('WebhooksConfigController', () => {
  const tenantId = 'tenant-1';
  const config = {
    id: 'webhook-1',
    tenantId,
    url: 'https://example.test/webhooks/corvo',
    events: ['nfse.invoice.authorized'],
    secret: 'secret-value',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('never exposes signing secrets in list responses', async () => {
    const service = {
      listPage: jest.fn().mockResolvedValue(
        new CursorPage([config], {
          limit: 50,
          hasMore: false,
          nextCursor: null,
        }),
      ),
    };
    const controller = new WebhooksConfigController(
      service as never,
      {} as never,
    );

    const result = await controller.findAll(
      {
        authContext: { activeTenantId: tenantId },
      } as never,
      {},
    );
    expect(result.data[0]).not.toHaveProperty('secret');
    expect(result.data[0]).not.toHaveProperty('tenantId');
  });

  it('returns the signing secret only when creating a webhook', async () => {
    const service = { create: jest.fn().mockResolvedValue(config) };
    const controller = new WebhooksConfigController(
      service as never,
      {} as never,
    );

    await expect(
      controller.create(
        { authContext: { activeTenantId: tenantId } } as never,
        { url: config.url, events: ['nfse.invoice.authorized'] },
      ),
    ).resolves.toEqual(expect.objectContaining({ secret: 'secret-value' }));
  });

  it('accepts a subscription to nfse.invoice.fiscal_discrepancy', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({
        ...config,
        events: ['nfse.invoice.fiscal_discrepancy'],
      }),
    };
    const controller = new WebhooksConfigController(
      service as never,
      {} as never,
    );

    await expect(
      controller.create(
        { authContext: { activeTenantId: tenantId } } as never,
        { url: config.url, events: ['nfse.invoice.fiscal_discrepancy'] },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ events: ['nfse.invoice.fiscal_discrepancy'] }),
    );
    expect(service.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ events: ['nfse.invoice.fiscal_discrepancy'] }),
      undefined,
    );
  });
});

describe('WebhooksConfigController environment binding', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const make = () => {
    const service = {
      create: jest.fn().mockResolvedValue({
        id: 'w1',
        tenantId,
        url: 'https://example.test/hook',
        events: ['nfse.invoice.authorized'],
        secret: 's',
        environment: 'test',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      listPage: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const dispatcher = { test: jest.fn().mockResolvedValue({ sent: true }) };
    return {
      service,
      dispatcher,
      controller: new WebhooksConfigController(
        service as never,
        dispatcher as never,
      ),
    };
  };
  const testKey = {
    authContext: { activeTenantId: tenantId, apiKeyEnvironment: 'test' },
  } as never;

  it('binds an endpoint created with an API key to that key environment', async () => {
    const { controller, service } = make();
    await controller.create(testKey, {
      url: 'https://example.test/hook',
      events: ['nfse.invoice.authorized'],
    });
    expect(service.create).toHaveBeenCalledWith(
      tenantId,
      expect.anything(),
      'test',
    );
  });

  it('passes the key environment to list, delete and test', async () => {
    const { controller, service, dispatcher } = make();
    await controller.findAll(testKey, {});
    await controller.remove(testKey, 'w1');
    await controller.test(testKey, 'w1');
    expect(service.listPage).toHaveBeenCalledWith(tenantId, {}, 'test');
    expect(service.remove).toHaveBeenCalledWith(tenantId, 'w1', 'test');
    expect(dispatcher.test).toHaveBeenCalledWith(tenantId, 'w1', 'test');
  });
});
