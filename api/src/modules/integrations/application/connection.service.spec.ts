import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConnectionService } from './connection.service';
import { CredentialsService } from './credentials.service';
import { ConnectorRegistry } from '../domain/connector-registry';
import type { Connector } from '../domain/connector';
import type { IntegrationConnection } from '../domain/integration-connection';
import { IIntegrationConnectionRepository } from '../domain/integration-connection.repository';
import { IIntegrationRuleRepository } from '../domain/integration-rule.repository';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { SecretsCipherService } from '@/infra/shared/secrets-cipher.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';

class MemoryConnections extends IIntegrationConnectionRepository {
  rows = new Map<string, IntegrationConnection>();
  insert(c: IntegrationConnection) {
    this.rows.set(c.id, c);
    return Promise.resolve(c);
  }
  update(c: IntegrationConnection) {
    this.rows.set(c.id, c);
    return Promise.resolve(c);
  }
  findById(id: string, tenantId: string) {
    const c = this.rows.get(id);
    return Promise.resolve(c && c.tenantId === tenantId ? c : null);
  }
  listByTenant(tenantId: string) {
    return Promise.resolve(
      [...this.rows.values()].filter((c) => c.tenantId === tenantId),
    );
  }
  findByPublicId(publicId: string) {
    return Promise.resolve(
      [...this.rows.values()].find((c) => c.publicId === publicId) ?? null,
    );
  }
}

class FakeRules extends IIntegrationRuleRepository {
  count = 0;
  countByConnection() {
    return Promise.resolve(this.count);
  }
  listByConnection() {
    return Promise.resolve([]);
  }
  replaceForConnection() {
    return Promise.resolve([]);
  }
}

const connector: Connector = {
  manifest: {
    id: 'woovi',
    name: 'Woovi',
    version: '1',
    credentialFields: [
      { key: 'appId', label: 'AppID', secret: true },
      { key: 'hook', label: 'Hook', secret: true, generate: true },
    ],
    webhookInstructions: { pt: '', en: '' },
    supportedFlows: [],
  },
  authenticate: () => Promise.resolve({ ok: true }),
  parse: () => ({ kind: 'test' }),
  normalize: () => Promise.reject(new Error('unused')),
  validateConnection: () => Promise.resolve({ externalAccountId: 'acc-1' }),
};

function setup() {
  const registry = new ConnectorRegistry();
  registry.register(connector);
  const repo = new MemoryConnections();
  const rules = new FakeRules();
  const cipher = {
    encrypt: (s: string) => Buffer.from(s).toString('base64'),
    decrypt: (s: string) => Buffer.from(s, 'base64').toString(),
  } as unknown as SecretsCipherService;
  const company = {
    findById: jest.fn().mockResolvedValue({ id: COMPANY }),
  } as unknown as CompanyService;
  const service = new ConnectionService(
    registry,
    repo,
    rules,
    new CredentialsService(cipher),
    company,
  );
  return {
    service,
    repo,
    rules,
    company: company as unknown as { findById: jest.Mock },
  };
}

const input = {
  provider: 'woovi',
  companyId: COMPANY,
  environment: 'test' as const,
  credentials: { appId: 'abc' },
};

describe('ConnectionService', () => {
  it('create() generates a 24-char base64url publicId, generates declared fields and keeps credentials sealed', async () => {
    const { service } = setup();
    const c = await service.create(TENANT, input);
    expect(c.publicId).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(c.state).toBe('draft');
    expect(c.credentialsEnc).not.toContain('abc');
    expect(service.toView(c).credentials.hook).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('create() rejects an unknown provider', async () => {
    const { service } = setup();
    await expect(
      service.create(TENANT, { ...input, provider: 'nope' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create() rejects credentials missing a field declared in the manifest', async () => {
    const { service } = setup();
    await expect(
      service.create(TENANT, { ...input, credentials: {} }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create() checks the company exists in that environment', async () => {
    const { service, company } = setup();
    await service.create(TENANT, input);
    expect(company.findById).toHaveBeenCalledWith(COMPANY, TENANT, 'test');
  });

  it('validate() hands the connection environment to the connector', async () => {
    const { service } = setup();
    const spy = jest.spyOn(connector, 'validateConnection');
    const c = await service.create(TENANT, { ...input, environment: 'live' });
    await service.validate(TENANT, c.id);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'abc' }),
      'live',
      { publicId: c.publicId },
    );
  });

  it('validate() stores the external account id from the connector', async () => {
    const { service } = setup();
    const c = await service.create(TENANT, input);
    const validated = await service.validate(TENANT, c.id);
    expect(validated.externalAccountId).toBe('acc-1');
  });

  describe('updateCredentials()', () => {
    async function validated(state?: 'reauth_required') {
      const ctx = setup();
      const c = await ctx.service.create(TENANT, input);
      await ctx.service.validate(TENANT, c.id);
      if (state)
        ctx.repo.rows.set(c.id, { ...ctx.repo.rows.get(c.id)!, state });
      return { ...ctx, id: c.id };
    }

    it('replaces the credential, keeps the generated ones and checks the new value with the platform before saving', async () => {
      const { service, id } = await validated();
      const before = service.toView(await service.get(TENANT, id)).credentials;
      const spy = jest.spyOn(connector, 'validateConnection');
      const updated = await service.updateCredentials(TENANT, id, {
        appId: 'new-key',
      });
      expect(spy).toHaveBeenLastCalledWith(
        { appId: 'new-key', hook: before.hook },
        'test',
        { publicId: expect.any(String) as string },
      );
      const after = service.toView(updated).credentials;
      expect(after).toEqual({ appId: 'new-key', hook: before.hook });
      expect(updated.credentialsEnc).not.toContain('new-key');
    });

    it('keeps the old credential when the platform refuses the new one', async () => {
      const { service, id } = await validated();
      const before = (await service.get(TENANT, id)).credentialsEnc;
      jest
        .spyOn(connector, 'validateConnection')
        .mockRejectedValueOnce(new Error('refused'));
      await expect(
        service.updateCredentials(TENANT, id, { appId: 'bad' }),
      ).rejects.toThrow('refused');
      expect((await service.get(TENANT, id)).credentialsEnc).toBe(before);
    });

    it('brings a connection that needed new credentials back to active', async () => {
      const { service, id } = await validated('reauth_required');
      const updated = await service.updateCredentials(TENANT, id, {
        appId: 'fresh',
      });
      expect(updated.state).toBe('active');
    });

    it('does not change the state of an active or paused connection', async () => {
      const { service, rules, id } = await validated();
      rules.count = 1;
      await service.activate(TENANT, id);
      await service.pause(TENANT, id);
      const updated = await service.updateCredentials(TENANT, id, {
        appId: 'fresh',
      });
      expect(updated.state).toBe('paused');
    });

    it('rejects unknown fields, generated fields, blank values and an empty change', async () => {
      const { service, id } = await validated();
      const attempts: Array<Record<string, string>> = [
        { nope: 'x' },
        { hook: 'x' },
        { appId: '   ' },
        {},
      ];
      for (const credentials of attempts)
        await expect(
          service.updateCredentials(TENANT, id, credentials),
        ).rejects.toThrow(BadRequestException);
    });

    it('refuses a disconnected connection', async () => {
      const { service, id } = await validated();
      await service.disconnect(TENANT, id);
      await expect(
        service.updateCredentials(TENANT, id, { appId: 'x' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  it('activate() fails while externalAccountId is null', async () => {
    const { service, rules } = setup();
    rules.count = 1;
    const c = await service.create(TENANT, input);
    await expect(service.activate(TENANT, c.id)).rejects.toThrow(
      ConflictException,
    );
  });

  it('activate() fails when the connection has no rule', async () => {
    const { service } = setup();
    const c = await service.create(TENANT, input);
    await service.validate(TENANT, c.id);
    await expect(service.activate(TENANT, c.id)).rejects.toThrow('rule');
  });

  it('activate() / pause() / disconnect() follow the state machine', async () => {
    const { service, rules } = setup();
    rules.count = 1;
    const c = await service.create(TENANT, input);
    await service.validate(TENANT, c.id);
    expect((await service.activate(TENANT, c.id)).state).toBe('active');
    expect((await service.pause(TENANT, c.id)).state).toBe('paused');
    expect((await service.disconnect(TENANT, c.id)).state).toBe('disconnected');
  });

  it('another tenant gets not found for a connection it does not own', async () => {
    const { service } = setup();
    const c = await service.create(TENANT, input);
    await expect(
      service.validate('33333333-3333-4333-8333-333333333333', c.id),
    ).rejects.toThrow(NotFoundException);
  });

  it('findByPublicId() returns null for an unknown id', async () => {
    const { service } = setup();
    await expect(service.findByPublicId('missing')).resolves.toBeNull();
  });
});
