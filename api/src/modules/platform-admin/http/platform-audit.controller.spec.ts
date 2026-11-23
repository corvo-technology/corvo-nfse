import { CursorPage } from '@/shared/http/pagination';
import type {
  PlatformAdminAuditRepository,
  PlatformAuditEvent,
} from '../infra/platform-admin-audit.repository';
import { PlatformAuditController } from './platform-audit.controller';

const row: PlatformAuditEvent = {
  id: 'e1',
  actorUserId: 'secret-actor-id',
  actorEmail: 'admin@corvo.tech',
  action: 'credit_grant',
  targetTenantId: 't1',
  targetUserId: 'u1',
  reason: 'cortesia',
  payload: { amount: 5 },
  success: true,
  idempotencyKey: 'secret-key',
  createdAt: new Date('2026-11-23T10:00:00.000Z'),
};

describe('PlatformAuditController', () => {
  it('mapeia as linhas e devolve a página com cursor', async () => {
    const listPage = jest
      .fn()
      .mockResolvedValue(
        new CursorPage([row], { limit: 1, hasMore: true, nextCursor: 'abc' }),
      );
    const controller = new PlatformAuditController({
      listPage,
    } as unknown as PlatformAdminAuditRepository);
    const page = await controller.list({ limit: 1 });
    expect(listPage).toHaveBeenCalledWith({ limit: 1 });
    expect(page.pagination).toEqual({
      limit: 1,
      hasMore: true,
      nextCursor: 'abc',
    });
    expect(page.data).toEqual([
      {
        id: 'e1',
        actorEmail: 'admin@corvo.tech',
        action: 'credit_grant',
        targetTenantId: 't1',
        targetUserId: 'u1',
        reason: 'cortesia',
        payload: { amount: 5 },
        success: true,
        createdAt: '2026-11-23T10:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(page)).not.toContain('secret');
  });
});
