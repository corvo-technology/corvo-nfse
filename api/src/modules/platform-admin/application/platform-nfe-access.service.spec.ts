import { NotFoundException } from '@nestjs/common';
import { getDatabaseScope } from '@/infra/persistence/typeorm/tenant-context.storage';
import { PlatformNfeAccessService } from './platform-nfe-access.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const actor = {
  authUserId: '33333333-3333-4333-8333-333333333333',
  email: 'admin@corvo.tech',
  ipHash: 'hash',
};

function build(updateResult: unknown) {
  const log: string[] = [];
  const uow = {
    execute: jest.fn(async (work: () => Promise<unknown>) => {
      log.push('begin');
      try {
        const result = await work();
        log.push('commit');
        return result;
      } catch (error) {
        log.push('rollback');
        throw error;
      }
    }),
  };
  const query = jest.fn(async () => {
    log.push(`update:${getDatabaseScope()?.tenantId}`);
    return updateResult;
  });
  const db = {
    manager: () => ({
      getRepository: () => ({
        metadata: { tablePath: 'corvo.tenants' },
      }),
      query,
    }),
  };
  const audit = {
    insert: jest.fn(async () => {
      log.push('audit');
      return {} as never;
    }),
  };
  const cache = {
    delete: jest.fn(async () => {
      log.push('cache-delete');
    }),
  };
  const service = new PlatformNfeAccessService(
    uow as never,
    db as never,
    audit as never,
    cache as never,
  );
  return { service, log, query, audit, cache };
}

describe('PlatformNfeAccessService', () => {
  it('liga: grava a coluna e a auditoria na mesma transação e limpa o cache depois do commit', async () => {
    const at = new Date('2026-11-26T12:00:00Z');
    const { service, log, query, audit, cache } = build([
      [{ nfe_enabled_at: at }],
      1,
    ]);

    const result = await service.set(actor, TENANT, {
      enabled: true,
      reason: 'teste do dono',
    });

    expect(result).toEqual({
      tenantId: TENANT,
      enabled: true,
      enabledAt: at.toISOString(),
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('nfe_enabled_at'),
      [TENANT, true],
    );
    expect(audit.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'nfe_access_changed',
        targetTenantId: TENANT,
        reason: 'teste do dono',
        payload: { enabled: true },
        success: true,
      }),
    );
    expect(cache.delete).toHaveBeenCalledWith(`nfe:enabled:${TENANT}`);
    expect(log).toEqual([
      'begin',
      `update:${TENANT}`,
      'audit',
      'commit',
      'cache-delete',
    ]);
  });

  it('desliga: coluna nula', async () => {
    const { service, audit } = build([[{ nfe_enabled_at: null }], 1]);
    const result = await service.set(actor, TENANT, {
      enabled: false,
      reason: 'fim do teste',
    });
    expect(result).toEqual({
      tenantId: TENANT,
      enabled: false,
      enabledAt: null,
    });
    expect(audit.insert).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { enabled: false } }),
    );
  });

  it('tenant que não existe: 404, sem auditoria e sem limpar o cache', async () => {
    const { service, audit, cache, log } = build([[], 0]);
    await expect(
      service.set(actor, TENANT, { enabled: true, reason: 'tenant fantasma' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.insert).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(log).toContain('rollback');
  });
});
