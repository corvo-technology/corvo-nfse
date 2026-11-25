import { DataSource } from 'typeorm';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import * as sentry from '@/infra/observability/sentry-reporter';
import { SYSTEM_ACTOR } from '../domain/account-audit';
import { TypeOrmAccountAuditRepository } from '../infra/typeorm-account-audit.repository';
import { AccountAuditService } from './account-audit.service';
import { runWithAuditActor } from './audit-actor.context';

const TENANT = '11111111-1111-4111-8111-111111111111';

function setup() {
  const insert = jest.fn().mockResolvedValue(undefined);
  const repository = { insert } as unknown as TypeOrmAccountAuditRepository;
  const resolve = jest.fn(
    ({
      type,
    }: {
      type: string;
    }): Promise<{ label: string; onBehalfOf: string | null }> =>
      Promise.resolve(
        type === 'agent'
          ? { label: 'Claude', onBehalfOf: 'Pedro Henrique' }
          : type === 'system'
            ? { label: 'Sistema', onBehalfOf: null }
            : { label: 'Maria', onBehalfOf: null },
      ),
  );
  const service = new AccountAuditService(repository, { resolve }, 'api');
  return { service, insert, resolve };
}

describe('AccountAuditService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('records the request actor with resolved labels', async () => {
    const { service, insert } = setup();
    await runWithAuditActor(
      { type: 'agent', id: 'c1', onBehalfOfUserId: 'u1', ipHash: 'h' },
      () =>
        service.record({
          tenantId: TENANT,
          environment: 'live',
          action: 'certificate.uploaded',
          target: { type: 'company', id: 'co1', label: '12.345.678/0001-90' },
        }),
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        environment: 'live',
        actorType: 'agent',
        actorId: 'c1',
        actorLabel: 'Claude',
        actorOnBehalfOfLabel: 'Pedro Henrique',
        targetLabel: '12.345.678/0001-90',
        ipHash: 'h',
      }),
    );
  });

  it('records SYSTEM_ACTOR with label "Sistema" outside a request', async () => {
    const { service, insert } = setup();
    await service.record({
      tenantId: TENANT,
      action: 'billing.payment_confirmed',
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'system',
        actorId: null,
        actorLabel: 'Sistema',
        environment: null,
      }),
    );
  });

  it('uses the explicit actor over the request actor', async () => {
    const { service, insert } = setup();
    await runWithAuditActor({ type: 'user', id: 'u1' }, () =>
      service.record({
        tenantId: TENANT,
        action: 'billing.payment_confirmed',
        actor: SYSTEM_ACTOR,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'system' }),
    );
  });

  it('never stores secrets in metadata', async () => {
    const { service, insert } = setup();
    await service.record({
      tenantId: TENANT,
      action: 'certificate.uploaded',
      metadata: { password: 'p', pfx_base64: 'b', units: 3 },
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { units: 3 } }),
    );
  });

  it('resolves without throwing and reports to Sentry when the insert fails', async () => {
    const { service, insert } = setup();
    insert.mockRejectedValue(new Error('boom'));
    const capture = jest
      .spyOn(sentry, 'captureRuntimeException')
      .mockReturnValue(undefined);
    await expect(
      service.record({ tenantId: TENANT, action: 'company.created' }),
    ).resolves.toBeUndefined();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.any(Error),
      'api',
      'account-audit.record',
    );
  });

  it('record resolves and writes outside the ambient transaction when the insert fails', async () => {
    const txInsert = jest.fn();
    const txManager = {
      getRepository: () => ({ insert: txInsert }),
    };
    const ownInsert = jest.fn().mockRejectedValue(new Error('insert failed'));
    const dataSource = {
      manager: { getRepository: () => ({ insert: ownInsert }) },
    } as unknown as DataSource;
    const service = new AccountAuditService(
      new TypeOrmAccountAuditRepository(dataSource),
      {
        resolve: () => Promise.resolve({ label: 'Maria', onBehalfOf: null }),
      },
      'api',
    );
    jest.spyOn(sentry, 'captureRuntimeException').mockReturnValue(undefined);
    const context = new TypeOrmTransactionContext();
    await expect(
      context.run(txManager as never, () =>
        service.record({ tenantId: TENANT, action: 'company.created' }),
      ),
    ).resolves.toBeUndefined();
    expect(ownInsert).toHaveBeenCalledTimes(1);
    expect(txInsert).not.toHaveBeenCalled();
  });
});
