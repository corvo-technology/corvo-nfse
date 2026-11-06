import 'reflect-metadata';
import { REQUIRED_TENANT_PERMISSION } from '@/modules/auth/require-permission.decorator';
import { IntegrationsController } from './integrations.controller';
import { ConnectorRegistry } from '../domain/connector-registry';
import type { IntegrationConnection } from '../domain/integration-connection';
import type { ConnectionService } from '../application/connection.service';
import type { OperationService } from '../application/operation.service';
import { PutRulesDto } from './integrations.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ConfigService } from '@nestjs/config';

const TENANT = '11111111-1111-4111-8111-111111111111';
const connection: IntegrationConnection = {
  id: 'c1',
  tenantId: TENANT,
  companyId: 'co',
  publicId: 'PUBLICID123456789012345',
  provider: 'woovi',
  environment: 'test',
  externalAccountId: 'acc',
  state: 'draft',
  credentialsEnc: 'SECRET-ENC',
  activeFrom: null,
  createdAt: new Date('2026-10-29'),
  updatedAt: new Date('2026-10-29'),
};
const req = { authContext: { activeTenantId: TENANT } } as never;

function setup(publicApiUrl: string | undefined = 'https://api.corvo.tech') {
  const registry = new ConnectorRegistry();
  registry.register({
    manifest: {
      id: 'woovi',
      name: 'Woovi',
      version: '1',
      credentialFields: [{ key: 'appId', label: 'AppID', secret: true }],
      webhookInstructions: { pt: '', en: '' },
      supportedFlows: [],
    },
    authenticate: () => Promise.resolve({ ok: true }),
    parse: () => ({ kind: 'test' }),
    normalize: () => Promise.reject(new Error('x')),
    validateConnection: () => Promise.resolve({ externalAccountId: 'a' }),
  });
  const connections = {
    create: jest.fn().mockResolvedValue(connection),
    get: jest.fn().mockResolvedValue(connection),
    list: jest.fn().mockResolvedValue([connection]),
    toView: jest.fn().mockReturnValue({ credentials: { appId: 'abc' } }),
    listRules: jest.fn(),
    replaceRules: jest.fn().mockResolvedValue([]),
  } as unknown as ConnectionService;
  const operations = {} as OperationService;
  const config = new ConfigService({
    app: { publicApiUrl, apiPrefix: 'v1' },
  });
  return {
    controller: new IntegrationsController(
      registry,
      connections,
      operations,
      {} as never,
      config,
    ),
    connections,
  };
}

describe('IntegrationsController webhookUrl', () => {
  const path = '/v1/integrations/inbound/PUBLICID123456789012345';
  it('is always a full address: PUBLIC_API_URL is used by its origin only', async () => {
    const { controller } = setup('https://api.corvo.tech/v1/');
    const [item] = await controller.list(req);
    expect(item.webhookUrl).toBe(`https://api.corvo.tech${path}`);
  });
  it('falls back to the address the request came in on when PUBLIC_API_URL is not set', async () => {
    const { controller } = setup('');
    const local = {
      authContext: { activeTenantId: TENANT },
      protocol: 'http',
      get: (name: string) => (name === 'host' ? 'localhost:3000' : undefined),
    } as never;
    const [item] = await controller.list(local);
    expect(item.webhookUrl).toBe(`http://localhost:3000${path}`);
  });
});

describe('IntegrationsController', () => {
  it('lists provider manifests without any credential value', () => {
    const { controller } = setup();
    expect(controller.providers()).toEqual([
      expect.objectContaining({
        id: 'woovi',
        credentialFields: [{ key: 'appId', label: 'AppID', secret: true }],
      }),
    ]);
  });
  it('create returns the webhook url and never the credentials', async () => {
    const { controller } = setup();
    const result = await controller.create(req, {
      provider: 'woovi',
      companyId: 'co',
      environment: 'test',
      credentials: { appId: 'abc' },
    });
    expect(result.webhookUrl).toBe(
      'https://api.corvo.tech/v1/integrations/inbound/PUBLICID123456789012345',
    );
    const json = JSON.stringify(result);
    expect(json).not.toContain('SECRET-ENC');
    expect(json).not.toContain('credentials');
    expect(result).not.toHaveProperty('publicId');
    expect(result).not.toHaveProperty('tenantId');
  });
  it('create reveals a once-only token without putting it in the webhook url', async () => {
    const { controller, connections } = setup();
    const registry = (controller as unknown as { registry: ConnectorRegistry })
      .registry;
    registry.register({
      manifest: {
        id: 'tokened',
        name: 'T',
        version: '1',
        credentialFields: [
          {
            key: 'webhookToken',
            label: 'Token',
            secret: true,
            generate: true,
            revealOnce: true,
          },
        ],
        webhookInstructions: { pt: '', en: '' },
        supportedFlows: [],
      },
      authenticate: () => Promise.resolve({ ok: true }),
      parse: () => ({ kind: 'test' }),
      normalize: () => Promise.reject(new Error('x')),
      validateConnection: () => Promise.resolve({ externalAccountId: 'a' }),
    });
    (connections.create as jest.Mock).mockResolvedValue({
      ...connection,
      provider: 'tokened',
    });
    (connections as unknown as { toView: jest.Mock }).toView = jest
      .fn()
      .mockReturnValue({ credentials: { webhookToken: 'tok_abc' } });
    const created = await controller.create(req, {
      provider: 'tokened',
      companyId: 'co',
      environment: 'test',
      credentials: {},
    });
    expect(created.secrets).toEqual({ webhookToken: 'tok_abc' });
    expect(created.webhookUrl).not.toContain('tok_abc');
    expect(created.webhookUrl).not.toContain('?');
  });
  it('create puts generated URL secrets in the webhook url once; reading never does', async () => {
    const { controller, connections } = setup();
    const registry = (controller as unknown as { registry: ConnectorRegistry })
      .registry;
    registry.register({
      manifest: {
        id: 'abacate',
        name: 'A',
        version: '1',
        credentialFields: [
          {
            key: 'webhookSecret',
            label: 'S',
            secret: true,
            generate: true,
            inWebhookUrl: true,
          },
        ],
        webhookInstructions: { pt: '', en: '' },
        supportedFlows: [],
      },
      authenticate: () => Promise.resolve({ ok: true }),
      parse: () => ({ kind: 'test' }),
      normalize: () => Promise.reject(new Error('x')),
      validateConnection: () => Promise.resolve({ externalAccountId: 'a' }),
    });
    const abacate = { ...connection, provider: 'abacate' };
    (connections.create as jest.Mock).mockResolvedValue(abacate);
    (connections as unknown as { toView: jest.Mock }).toView = jest
      .fn()
      .mockReturnValue({ credentials: { webhookSecret: 'a b&c' } });
    const created = await controller.create(req, {
      provider: 'abacate',
      companyId: 'co',
      environment: 'test',
      credentials: {},
    });
    expect(created.webhookUrl).toBe(
      'https://api.corvo.tech/v1/integrations/inbound/PUBLICID123456789012345?webhookSecret=a%20b%26c',
    );
    expect(created.secrets).toEqual({ webhookSecret: 'a b&c' });
    (connections.get as jest.Mock).mockResolvedValue(abacate);
    const read = await controller.get(
      req,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(read.webhookUrl).not.toContain('webhookSecret');
    expect(read).not.toHaveProperty('secrets');
  });

  it('read routes require integrations.view and write routes integrations.manage', () => {
    const permission = (name: keyof IntegrationsController) =>
      Reflect.getMetadata(
        REQUIRED_TENANT_PERMISSION,
        IntegrationsController.prototype[name],
      ) as string;
    for (const name of [
      'providers',
      'list',
      'get',
      'events',
      'operations',
      'rules',
    ] as const)
      expect(permission(name)).toBe('integrations.view');
    for (const name of [
      'create',
      'validate',
      'activate',
      'pause',
      'disconnect',
      'updateCredentials',
      'putRules',
      'completeCustomer',
      'retry',
    ] as const)
      expect(permission(name)).toBe('integrations.manage');
  });
  describe('cancelOnRefund on the rules', () => {
    const rule = (extra: Record<string, unknown> = {}) => ({
      service: { code: '010101' },
      sendEmail: true,
      ...extra,
    });
    it('is off unless asked for, and is stored when asked for', async () => {
      const { controller, connections } = setup();
      const replace = connections.replaceRules as jest.Mock;
      await controller.putRules(req, '11111111-1111-4111-8111-111111111111', {
        rules: [rule()],
      } as never);
      await controller.putRules(req, '11111111-1111-4111-8111-111111111111', {
        rules: [rule({ cancelOnRefund: true })],
      } as never);
      expect(replace.mock.calls[0][2][0].cancelOnRefund).toBe(false);
      expect(replace.mock.calls[1][2][0].cancelOnRefund).toBe(true);
    });
    it('only accepts a boolean', async () => {
      const dto = plainToInstance(PutRulesDto, {
        rules: [rule({ cancelOnRefund: 'yes' })],
      });
      expect(await validate(dto)).not.toHaveLength(0);
      const ok = plainToInstance(PutRulesDto, {
        rules: [rule({ cancelOnRefund: true })],
      });
      expect(await validate(ok)).toHaveLength(0);
    });
  });
  it('PUT rules rejects two rules for the same product and two default rules', async () => {
    const dup = plainToInstance(PutRulesDto, {
      rules: [
        {
          externalProductId: 'p1',
          service: { code: '010101' },
          sendEmail: false,
        },
        {
          externalProductId: 'p1',
          service: { code: '020202' },
          sendEmail: false,
        },
      ],
    });
    expect((await validate(dup)).length).toBeGreaterThan(0);
    const twoDefaults = plainToInstance(PutRulesDto, {
      rules: [
        { service: { code: '010101' }, sendEmail: false },
        {
          externalProductId: null,
          service: { code: '020202' },
          sendEmail: false,
        },
      ],
    });
    expect((await validate(twoDefaults)).length).toBeGreaterThan(0);
    const ok = plainToInstance(PutRulesDto, {
      rules: [
        { service: { code: '010101' }, sendEmail: true },
        {
          externalProductId: 'p1',
          service: { code: '020202' },
          sendEmail: false,
        },
      ],
    });
    expect(await validate(ok)).toHaveLength(0);
  });
});

describe('IntegrationsController API key environment', () => {
  const testKey = {
    authContext: { activeTenantId: TENANT, apiKeyEnvironment: 'test' },
  } as never;
  const liveKey = {
    authContext: { activeTenantId: TENANT, apiKeyEnvironment: 'live' },
  } as never;
  const session = { authContext: { activeTenantId: TENANT } } as never;
  const body = (environment?: 'test' | 'live') =>
    ({
      provider: 'woovi',
      companyId: 'co',
      credentials: { appId: 'abc' },
      environment,
    }) as never;

  it('does not show or open connections of the other environment to an API key', async () => {
    const { controller, connections } = setup();
    // The fixture connection is a test one.
    await expect(controller.list(liveKey)).resolves.toEqual([]);
    await expect(controller.list(testKey)).resolves.toHaveLength(1);
    await expect(controller.get(liveKey, 'c1')).rejects.toThrow(
      'Connection not found',
    );
    await expect(controller.pause(liveKey, 'c1')).rejects.toThrow(
      'Connection not found',
    );
    await expect(controller.activate(liveKey, 'c1')).rejects.toThrow(
      'Connection not found',
    );
    await expect(controller.disconnect(liveKey, 'c1')).rejects.toThrow(
      'Connection not found',
    );
    await expect(controller.rules(liveKey, 'c1')).rejects.toThrow(
      'Connection not found',
    );
    expect(
      (connections as unknown as Record<string, jest.Mock>).create,
    ).not.toHaveBeenCalled();
  });

  it('creates connections only in the key environment', async () => {
    const { controller, connections } = setup();
    await expect(controller.create(testKey, body('live'))).rejects.toThrow(
      'can only create test connections',
    );
    await controller.create(testKey, body());
    expect(connections.create).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ environment: 'test' }),
    );
  });

  it('keeps the dashboard flow: a session chooses the environment in the body', async () => {
    const { controller, connections } = setup();
    await controller.create(session, body('live'));
    expect(connections.create).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ environment: 'live' }),
    );
    await expect(controller.create(session, body())).rejects.toThrow(
      'environment must be test or live',
    );
  });
});
