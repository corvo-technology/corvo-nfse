import { WebhookDeliveryController } from './webhook-delivery.controller';

const tenantId = '11111111-1111-4111-8111-111111111111';

function setup() {
  const deliveries = {
    listPage: jest.fn().mockResolvedValue([]),
    getStats: jest.fn().mockResolvedValue({}),
  };
  const outbox = { manualRetry: jest.fn().mockResolvedValue(undefined) };
  return {
    deliveries,
    outbox,
    controller: new WebhookDeliveryController(
      deliveries as never,
      outbox as never,
    ),
  };
}

const keyOf = (environment?: 'test' | 'live') =>
  ({
    authContext: { activeTenantId: tenantId, apiKeyEnvironment: environment },
  }) as never;

describe('WebhookDeliveryController environment', () => {
  it('forces an API key to its own environment, whatever the query asks', async () => {
    const { controller, deliveries } = setup();
    await controller.findAll(keyOf('test'), { environment: 'live' } as never);
    await controller.findAll(keyOf('test'), {});
    expect(deliveries.listPage).toHaveBeenNthCalledWith(
      1,
      tenantId,
      expect.objectContaining({ environment: 'test' }),
    );
    expect(deliveries.listPage).toHaveBeenNthCalledWith(
      2,
      tenantId,
      expect.objectContaining({ environment: 'test' }),
    );
  });

  it('forces the stats to the key environment', async () => {
    const { controller, deliveries } = setup();
    await controller.getStats(keyOf('live'), {
      hours: 24,
      environment: 'test',
    } as never);
    expect(deliveries.getStats).toHaveBeenCalledWith(tenantId, 24, 'live');
  });

  it('passes the invoice, event and status filters to the list', async () => {
    const { controller, deliveries } = setup();
    const filters = {
      invoice_id: '22222222-2222-4222-8222-222222222222',
      event_type: 'nfse.invoice.authorized',
      status: 'failed',
      hours: 720,
    };
    await controller.findAll(keyOf(), filters);
    expect(deliveries.listPage).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining(filters),
    );
  });

  it('keeps the dashboard filter for sessions', async () => {
    const { controller, deliveries } = setup();
    await controller.findAll(keyOf(), { environment: 'live' } as never);
    expect(deliveries.listPage).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ environment: 'live' }),
    );
  });

  it('passes the key environment to the retry', async () => {
    const { controller, outbox } = setup();
    await controller.retryDelivery(keyOf('test'), 'delivery-1');
    expect(outbox.manualRetry).toHaveBeenCalledWith(
      tenantId,
      'delivery-1',
      'test',
    );
  });
});
