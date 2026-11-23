import { HttpException, Logger } from '@nestjs/common';
import { getDatabaseScope } from '@/infra/persistence/typeorm/tenant-context.storage';
import type { PlatformAuditInput } from '../infra/platform-admin-audit.repository';
import { PlatformCreditGrantService } from './platform-credit-grant.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const actor = {
  authUserId: '33333333-3333-4333-8333-333333333333',
  email: 'admin@corvo.tech',
  ipHash: 'hash',
};
const input = { amount: 10, reason: 'cortesia de teste', notifyUser: false };

type AuditRow = PlatformAuditInput & { id: string };

/** In-memory world with a transactional unit of work (rolls back on throw). */
function build(opts: { tenantExists?: boolean } = {}) {
  const log: string[] = [];
  const committed = {
    credits: [] as Record<string, unknown>[],
    audits: [] as AuditRow[],
  };
  let pending: typeof committed | null = null;
  let balance = 100;
  let cached: number | null = null;
  const view = () => pending ?? committed;

  const uow = {
    execute: jest.fn(async (work: () => Promise<unknown>) => {
      pending = {
        credits: [...committed.credits],
        audits: [...committed.audits],
      };
      const balanceBefore = balance;
      log.push('begin');
      try {
        const r = await work();
        committed.credits = pending.credits;
        committed.audits = pending.audits;
        log.push('commit');
        return r;
      } catch (e) {
        balance = balanceBefore;
        log.push('rollback');
        throw e;
      } finally {
        pending = null;
      }
    }),
  };
  const credits = {
    grantBonus: jest.fn(
      async (tenantId: string, amount: number, description: string) => {
        log.push('grantBonus');
        view().credits.push({ tenantId, amount, description });
        balance += amount;
        cached = balance; // the cache keeps the in-transaction balance
        return { tenantId, balance };
      },
    ),
    invalidateBalance: jest.fn(async () => {
      log.push('invalidate');
      cached = null;
    }),
  };
  const audit = {
    insert: jest.fn(async (row: PlatformAuditInput) => {
      log.push(`audit:${row.success ? 'ok' : 'fail'}`);
      view().audits.push({ ...row, id: `a${view().audits.length}` });
      return {} as never;
    }),
    findSuccessfulGrantByKey: jest.fn(async (key: string): Promise<unknown> => {
      const row = view().audits.find(
        (a) =>
          a.success && a.action === 'credit_grant' && a.idempotencyKey === key,
      );
      return row ?? null;
    }),
  };
  const tenants = {
    findById: jest.fn(async (id: string) => {
      log.push(`scope:${getDatabaseScope()?.tenantId}`);
      return opts.tenantExists === false ? null : { id, planId: null };
    }),
  };
  const bus = { publishBestEffort: jest.fn(() => void log.push('publish')) };
  const service = new PlatformCreditGrantService(
    uow as never,
    audit as never,
    credits as never,
    tenants as never,
    bus as never,
  );
  return {
    service,
    uow,
    credits,
    audit,
    tenants,
    bus,
    log,
    committed,
    cache: () => cached,
    setBalance: (n: number) => (balance = n),
  };
}

const code = (e: unknown) =>
  (((e as HttpException).getResponse?.() ?? {}) as { code?: string }).code;

describe('PlatformCreditGrantService', () => {
  it('audita na mesma transação: audit.insert roda dentro de uow.execute, depois de grantBonus', async () => {
    const w = build();
    await w.service.grant(actor, TENANT, input, 'key-1');
    expect(w.log.slice(w.log.indexOf('begin'))).toEqual([
      'begin',
      'grantBonus',
      'audit:ok',
      'commit',
      'invalidate',
    ]);
    expect(w.committed.audits).toHaveLength(1);
    expect(w.committed.audits[0]).toMatchObject({
      action: 'credit_grant',
      success: true,
      idempotencyKey: 'key-1',
      targetTenantId: TENANT,
      reason: input.reason,
      actorEmail: actor.email,
      payload: { amount: 10, balanceAfter: 110 },
    });
  });

  it('roda tudo no escopo do tenant alvo e devolve o contrato', async () => {
    const w = build();
    const result = await w.service.grant(actor, TENANT, input, 'key-1');
    expect(w.log).toContain(`scope:${TENANT}`);
    expect(result).toEqual({
      tenantId: TENANT,
      amount: 10,
      balance: 110,
      replayed: false,
    });
  });

  it('falha ao auditar desfaz o crédito (fail-closed), grava linha de falha fora da transação e propaga o erro', async () => {
    const w = build();
    const boom = new Error('db down');
    w.audit.insert.mockImplementationOnce(async () => {
      w.log.push('audit:throws');
      throw boom;
    });
    await expect(w.service.grant(actor, TENANT, input, 'key-1')).rejects.toBe(
      boom,
    );
    expect(w.committed.credits).toHaveLength(0);
    expect(w.log).toEqual([
      `scope:${TENANT}`,
      'begin',
      'grantBonus',
      'audit:throws',
      'rollback',
      'audit:fail',
      'invalidate',
    ]);
    expect(w.committed.audits).toHaveLength(1);
    expect(w.committed.audits[0]).toMatchObject({
      success: false,
      idempotencyKey: 'key-1',
      payload: { error: 'INTERNAL_ERROR' },
    });
  });

  it('se até a linha de falha não grava, só registra no log e propaga o erro original', async () => {
    const w = build();
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const boom = new Error('db down');
    w.audit.insert.mockRejectedValue(boom);
    await expect(w.service.grant(actor, TENANT, input, 'key-1')).rejects.toBe(
      boom,
    );
    expect(w.credits.invalidateBalance).toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'platform_admin_failure_audit_lost' }),
    );
    logError.mockRestore();
  });

  it('invalidateBalance falhando não mascara o resultado: 200, notice publicado e erro logado', async () => {
    const w = build();
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    w.credits.invalidateBalance.mockRejectedValue(new Error('redis down'));
    const result = await w.service.grant(
      actor,
      TENANT,
      { ...input, notifyUser: true },
      'key-1',
    );
    expect(result).toMatchObject({ replayed: false, amount: 10 });
    expect(w.bus.publishBestEffort).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'platform_admin_balance_invalidation_failed',
      }),
    );
    logError.mockRestore();
  });

  it('mesma chave, mesmo valor e motivo: devolve o original, replayed true, sem novo grantBonus', async () => {
    const w = build();
    await w.service.grant(actor, TENANT, input, 'key-1');
    w.setBalance(999); // balance moved on; replay returns the original result
    const again = await w.service.grant(actor, TENANT, input, 'key-1');
    expect(again).toEqual({
      tenantId: TENANT,
      amount: 10,
      balance: 110,
      replayed: true,
    });
    expect(w.credits.grantBonus).toHaveBeenCalledTimes(1);
    expect(w.committed.audits.filter((a) => a.success)).toHaveLength(1);
  });

  it.each([
    ['outro valor', TENANT, { ...input, amount: 11 }],
    ['outro motivo', TENANT, { ...input, reason: 'outro motivo qualquer' }],
    ['outro tenant', OTHER_TENANT, input],
  ])(
    'mesma chave com %s: 409 IDEMPOTENCY_KEY_REUSED',
    async (_n, tenant, body) => {
      const w = build();
      await w.service.grant(actor, TENANT, input, 'key-1');
      const err = await w.service
        .grant(actor, tenant, body, 'key-1')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(409);
      expect(code(err)).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(w.credits.grantBonus).toHaveBeenCalledTimes(1);
    },
  );

  it('duas chamadas simultâneas com a mesma chave: 23505 vira o resultado da primeira e um só crédito persiste', async () => {
    const w = build();
    // Both requests passed the "no prior" check; the loser hits the unique index at audit time.
    const real = w.audit.findSuccessfulGrantByKey.getMockImplementation()!;
    w.audit.findSuccessfulGrantByKey.mockImplementationOnce(async () => null);
    await w.service.grant(actor, TENANT, input, 'key-1'); // winner commits
    const loserCredits = w.credits.grantBonus.mock.calls.length;
    w.audit.findSuccessfulGrantByKey.mockImplementationOnce(async () => null);
    w.audit.insert.mockImplementationOnce(async () => {
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    });
    w.audit.findSuccessfulGrantByKey.mockImplementation(real);
    const result = await w.service.grant(actor, TENANT, input, 'key-1');
    expect(result).toMatchObject({ replayed: true, amount: 10, balance: 110 });
    expect(w.credits.grantBonus.mock.calls.length).toBe(loserCredits + 1); // attempted, then rolled back
    expect(w.committed.credits).toHaveLength(1);
    expect(w.committed.audits.filter((a) => a.success)).toHaveLength(1);
    expect(w.committed.audits.filter((a) => !a.success)).toHaveLength(0);
  });

  it('23505 também aceita o formato driverError do TypeORM', async () => {
    const w = build();
    await w.service.grant(actor, TENANT, input, 'key-1');
    w.audit.findSuccessfulGrantByKey.mockImplementationOnce(async () => null);
    w.audit.insert.mockImplementationOnce(async () => {
      throw Object.assign(new Error('duplicate'), {
        driverError: { code: '23505' },
      });
    });
    await expect(
      w.service.grant(actor, TENANT, input, 'key-1'),
    ).resolves.toMatchObject({
      replayed: true,
    });
  });

  it('23505 com corpo diferente: 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const w = build();
    await w.service.grant(actor, TENANT, input, 'key-1');
    w.audit.findSuccessfulGrantByKey.mockImplementationOnce(async () => null);
    w.audit.insert.mockImplementationOnce(async () => {
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    });
    const err = await w.service
      .grant(actor, TENANT, { ...input, amount: 20 }, 'key-1')
      .catch((e: unknown) => e);
    expect(code(err)).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('invalida o cache de saldo também quando a transação falha', async () => {
    const w = build();
    w.audit.insert.mockRejectedValueOnce(new Error('nope'));
    await w.service.grant(actor, TENANT, input, 'key-1').catch(() => undefined);
    expect(w.cache()).toBeNull(); // the in-transaction balance cached by grantBonus is gone
  });

  it('o lançamento não carrega motivo nem e-mail do admin; a descrição é genérica', async () => {
    const w = build();
    await w.service.grant(
      actor,
      TENANT,
      { ...input, reason: 'segredo interno' },
      'key-1',
    );
    expect(w.credits.grantBonus).toHaveBeenCalledWith(
      TENANT,
      10,
      'Notas cedidas pela Corvo',
    );
    const stored = JSON.stringify(w.committed.credits);
    expect(stored).not.toContain('segredo interno');
    expect(stored).not.toContain(actor.email);
    expect(stored).not.toContain('metadata');
    expect(stored).not.toContain('platform_admin');
  });

  it('notifyUser publica credits-added só após o commit e não em repetição; padrão não publica', async () => {
    const w = build();
    await w.service.grant(actor, TENANT, input, 'k0');
    expect(w.bus.publishBestEffort).not.toHaveBeenCalled();

    await w.service.grant(actor, TENANT, { ...input, notifyUser: true }, 'k1');
    expect(w.bus.publishBestEffort).toHaveBeenCalledTimes(1);
    expect(w.bus.publishBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        notice: { kind: 'credits-added', units: 10 },
      }),
    );
    expect(w.log.indexOf('publish')).toBeGreaterThan(
      w.log.lastIndexOf('commit') - 1,
    );

    await w.service.grant(actor, TENANT, { ...input, notifyUser: true }, 'k1');
    expect(w.bus.publishBestEffort).toHaveBeenCalledTimes(1);
  });

  it('não publica quando a transação falha', async () => {
    const w = build();
    w.audit.insert.mockRejectedValueOnce(new Error('nope'));
    await w.service
      .grant(actor, TENANT, { ...input, notifyUser: true }, 'k1')
      .catch(() => undefined);
    expect(w.bus.publishBestEffort).not.toHaveBeenCalled();
  });

  it('tenant inexistente: 404 RESOURCE_NOT_FOUND com linha de falha na auditoria', async () => {
    const w = build({ tenantExists: false });
    const err = await w.service
      .grant(actor, TENANT, input, 'key-1')
      .catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(404);
    expect(code(err)).toBe('RESOURCE_NOT_FOUND');
    expect(w.credits.grantBonus).not.toHaveBeenCalled();
    expect(w.committed.audits).toHaveLength(1);
    expect(w.committed.audits[0]).toMatchObject({
      success: false,
      payload: { error: 'RESOURCE_NOT_FOUND' },
    });
  });

  it.each([undefined, '', '   ', 'x'.repeat(201)])(
    'chave %p: IDEMPOTENCY_KEY_INVALID',
    async (key) => {
      const w = build();
      const err = await w.service
        .grant(actor, TENANT, input, key as never)
        .catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(400);
      expect(code(err)).toBe('IDEMPOTENCY_KEY_INVALID');
      expect(w.credits.grantBonus).not.toHaveBeenCalled();
    },
  );

  it('aceita chave de 200 caracteres', async () => {
    const w = build();
    await expect(
      w.service.grant(actor, TENANT, input, 'x'.repeat(200)),
    ).resolves.toMatchObject({ replayed: false });
  });
});
