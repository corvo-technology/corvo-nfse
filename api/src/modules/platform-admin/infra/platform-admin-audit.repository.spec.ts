import { createHash } from 'node:crypto';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type { DataSource, EntityManager } from 'typeorm';
import {
  hashIp,
  PlatformAdminAuditRepository,
  type PlatformAuditInput,
} from './platform-admin-audit.repository';

const input: PlatformAuditInput = {
  actorUserId: '11111111-1111-4111-8111-111111111111',
  actorEmail: 'admin@corvo.tech',
  action: 'credit_grant',
  success: true,
};

function fakeManager() {
  const repo = {
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: Record<string, unknown>) =>
      Promise.resolve({ ...v, createdAt: new Date() }),
    ),
  };
  const manager = {
    getRepository: jest.fn(() => repo),
  } as unknown as EntityManager;
  return { manager, repo };
}

describe('PlatformAdminAuditRepository', () => {
  it('insert usa o manager da transação ambiente', async () => {
    const txContext = new TypeOrmTransactionContext();
    const ambient = fakeManager();
    const fallback = fakeManager();
    const helper = new TypeOrmRepositoryHelper(
      { manager: fallback.manager } as unknown as DataSource,
      txContext,
    );
    const repo = new PlatformAdminAuditRepository(helper);

    const event = await txContext.run(ambient.manager, () =>
      repo.insert(input),
    );

    expect(ambient.manager.getRepository).toHaveBeenCalled();
    expect(fallback.manager.getRepository).not.toHaveBeenCalled();
    expect(event).toMatchObject({
      actorEmail: 'admin@corvo.tech',
      action: 'credit_grant',
      payload: {},
      targetTenantId: null,
      idempotencyKey: null,
    });
  });

  it('hashIp é estável e nulo sem IP', () => {
    const secret = 'a-server-secret-with-enough-length-0123';
    expect(hashIp('1.2.3.4', secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp('1.2.3.4', secret)).toBe(hashIp('1.2.3.4', secret));
    expect(hashIp('1.2.3.4', secret)).not.toBe(
      createHash('sha256').update('1.2.3.4').digest('hex'),
    );
    expect(hashIp('1.2.3.4', secret)).not.toBe(hashIp('1.2.3.4', 'other'));
    expect(hashIp(undefined, secret)).toBeNull();
  });
});
