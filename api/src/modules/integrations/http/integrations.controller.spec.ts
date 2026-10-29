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

function setup() {
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
    listRules: jest.fn(),
    replaceRules: jest.fn().mockResolvedValue([]),
  } as unknown as ConnectionService;
  const operations = {} as OperationService;
  const config = new ConfigService({
    app: { publicApiUrl: 'https://api.corvo.tech', apiPrefix: 'v1' },
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
      'putRules',
      'completeCustomer',
      'retry',
    ] as const)
      expect(permission(name)).toBe('integrations.manage');
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
