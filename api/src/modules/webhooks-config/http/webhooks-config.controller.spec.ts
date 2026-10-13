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
});
