import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { WebhookDelivery } from '@/modules/webhooks-config/domain/webhook-delivery';
import { ITenantMembershipRepository } from '../../auth/domain/tenant-membership.repository';
import {
  missingMemberPermissionMessage,
  missingScopeMessage,
} from '../mcp-client-policy';
import { McpServer } from '../mcp.server';
import { McpService } from '../mcp.service';
import { toPublicWebhookDelivery } from './public-shapes';
import {
  createWebhookDeliveriesListHandler,
  createWebhookDeliveryRetryHandler,
} from './webhook-delivery.tools';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INVOICE = '22222222-2222-4222-8222-222222222222';
const DELIVERY = '33333333-3333-4333-8333-333333333333';
const ctx = (environment: 'test' | 'live' = 'live') =>
  ({
    activeTenantId: TENANT,
    executionEnvironment: environment,
  }) as AuthContext;

const delivery = (extra: Partial<WebhookDelivery> = {}): WebhookDelivery => ({
  id: DELIVERY,
  tenantId: TENANT,
  webhookConfigId: '44444444-4444-4444-8444-444444444444',
  invoiceId: INVOICE,
  eventType: 'nfse.invoice.authorized',
  environment: 'live',
  url: 'https://cliente.example/hook?token=segredo',
  payload: {
    id: 'evt_1',
    type: 'nfse.invoice.authorized',
    environment: 'live',
    createdAt: '2026-11-25T10:00:00.000Z',
    data: { invoiceId: INVOICE, customer: 'Maria' },
  },
  statusCode: 500,
  responseBody: 'x'.repeat(5000),
  status: 'failed',
  retryCount: 5,
  lastError: 'HTTP 500',
  createdAt: new Date('2026-11-25T10:00:00Z'),
  ...extra,
});

describe('toPublicWebhookDelivery', () => {
  it('exposes only the safe fields', () => {
    const shape = toPublicWebhookDelivery(delivery());
    expect(shape).toMatchObject({
      id: DELIVERY,
      event_type: 'nfse.invoice.authorized',
      invoice_id: INVOICE,
      status: 'failed',
      http_status: 500,
      attempts: 5,
      error: 'HTTP 500',
    });
    const text = JSON.stringify(shape);
    expect(text).not.toContain('segredo');
    expect(text).not.toContain('cliente.example');
    expect(text).not.toContain('Maria');
    expect(text).not.toMatch(/payload|secret|signature|url/i);
    expect(shape.response_snippet).toHaveLength(200);
  });
});

describe('webhook_deliveries_list', () => {
  function build() {
    const listPage = jest.fn().mockResolvedValue({
      data: [delivery()],
      pagination: { limit: 50, hasMore: true, nextCursor: 'next' },
    });
    return {
      listPage,
      handler: createWebhookDeliveriesListHandler({ listPage }),
    };
  }

  it('passes the filters and keeps the connection in its own environment', async () => {
    const { handler, listPage } = build();
    const result = (await handler(
      {
        invoice_id: INVOICE,
        event_type: 'nfse.invoice.authorized',
        status: 'failed',
        hours: 720,
      },
      ctx('test'),
    )) as { deliveries: unknown[]; next_cursor: string };
    expect(listPage).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({
        invoice_id: INVOICE,
        event_type: 'nfse.invoice.authorized',
        status: 'failed',
        hours: 720,
        environment: 'test',
      }),
    );
    expect(result.deliveries).toHaveLength(1);
    expect(result.next_cursor).toBe('next');
  });

  it.each([
    { hours: 721 },
    { invoice_id: 'nope' },
    { status: 'broken' },
    { limit: 5000 },
  ])('refuses %j', async (input) => {
    const { handler, listPage } = build();
    await expect(handler(input, ctx())).rejects.toThrow(/Invalid input/);
    expect(listPage).not.toHaveBeenCalled();
  });
});

describe('webhook_delivery_retry', () => {
  it('queues the retry inside the environment of the connection', async () => {
    const manualRetry = jest.fn().mockResolvedValue(undefined);
    const handler = createWebhookDeliveryRetryHandler({ manualRetry });
    await expect(
      handler({ delivery_id: DELIVERY }, ctx('live')),
    ).resolves.toEqual({ delivery_id: DELIVERY, retried: true });
    expect(manualRetry).toHaveBeenCalledWith(TENANT, DELIVERY, 'live');
  });

  it('refuses an id that is not a UUID', async () => {
    const manualRetry = jest.fn();
    const handler = createWebhookDeliveryRetryHandler({ manualRetry });
    await expect(handler({ delivery_id: 'x' }, ctx())).rejects.toThrow(
      /Invalid input/,
    );
    expect(manualRetry).not.toHaveBeenCalled();
  });
});

describe('webhook tools scopes', () => {
  function register(role: string) {
    const tools: Record<string, (p: unknown, c: unknown) => Promise<unknown>> =
      {};
    const spy = jest
      .spyOn(McpServer.prototype, 'registerTool')
      .mockImplementation((definition, handler) => {
        tools[definition.name] = handler;
      });
    const deps: unknown[] = Array.from({ length: McpService.length }, () => ({
      listPage: () => Promise.resolve({ data: [], pagination: {} }),
      manualRetry: () => Promise.resolve(),
    }));
    const injected = Reflect.getMetadata('self:paramtypes', McpService) as {
      index: number;
      param: unknown;
    }[];
    const slot = injected.find((p) => p.param === ITenantMembershipRepository)!;
    deps[slot.index] = {
      findByAuthUserAndTenant: () => Promise.resolve({ role, isActive: true }),
    };
    new (McpService as unknown as new (...args: unknown[]) => McpService)(
      ...deps,
    );
    spy.mockRestore();
    return tools;
  }
  const auth = (scope: string) => ({
    scope,
    authUserId: 'u',
    activeTenantId: TENANT,
    executionEnvironment: 'live',
  });

  it('lists with nfse:read and the webhooks.view permission', async () => {
    const tools = register('admin');
    await expect(
      tools['webhook_deliveries_list']({}, auth('nfse:write')),
    ).rejects.toThrow(missingScopeMessage('nfse:read'));
    await expect(
      tools['webhook_deliveries_list']({}, auth('nfse:read')),
    ).resolves.toMatchObject({ deliveries: [] });
  });

  it('retries only with nfse:write and the webhooks.manage permission', async () => {
    const tools = register('billing');
    await expect(
      tools['webhook_delivery_retry'](
        { delivery_id: DELIVERY },
        auth('nfse:read'),
      ),
    ).rejects.toThrow(missingScopeMessage('nfse:write'));
    await expect(
      tools['webhook_delivery_retry'](
        { delivery_id: DELIVERY },
        auth('nfse:read nfse:write'),
      ),
    ).rejects.toThrow(missingMemberPermissionMessage('webhooks.manage'));
    const admin = register('admin');
    await expect(
      admin['webhook_delivery_retry'](
        { delivery_id: DELIVERY },
        auth('nfse:read nfse:write'),
      ),
    ).resolves.toEqual({ delivery_id: DELIVERY, retried: true });
  });
});
