import { NotFoundException } from '@nestjs/common';
import type { PlatformAdminActor } from '../platform-admin.guard';
import type { PlatformUserDetail } from '../platform-admin.contract';
import { PlatformUserDetailService } from './platform-user-detail.service';

const actor: PlatformAdminActor = {
  authUserId: '00000000-0000-4000-8000-0000000000a1',
  email: 'owner@corvo.tech',
  ipHash: 'hash',
};
const userId = '00000000-0000-4000-8000-0000000000b2';
const detail = { user: { id: userId } } as PlatformUserDetail;

function setup() {
  const calls: string[] = [];
  const repo = {
    find: jest.fn(async () => {
      calls.push('find');
      return detail;
    }),
  };
  const audit = {
    insert: jest.fn(async (_input: unknown) => {
      calls.push('audit');
      return {} as never;
    }),
  };
  const service = new PlatformUserDetailService(repo as never, audit as never);
  return { calls, repo, audit, service };
}

describe('PlatformUserDetailService', () => {
  it('view grava user_viewed ANTES de devolver os dados', async () => {
    const { calls, audit, service } = setup();
    const result = await service.view(actor, userId);
    expect(calls).toEqual(['find', 'audit']);
    expect(result).toBe(detail);
    expect(audit.insert).toHaveBeenCalledWith({
      actorUserId: actor.authUserId,
      actorEmail: actor.email,
      action: 'user_viewed',
      targetUserId: userId,
      success: true,
      ipHash: 'hash',
    });
  });

  it('se a auditoria falha, o erro sobe e nada é devolvido (fail-closed)', async () => {
    const { audit, service } = setup();
    audit.insert.mockRejectedValueOnce(new Error('db down'));
    await expect(service.view(actor, userId)).rejects.toThrow('db down');
  });

  it('usuário inexistente: 404 RESOURCE_NOT_FOUND e nenhum user_viewed', async () => {
    const { repo, audit, service } = setup();
    repo.find.mockResolvedValueOnce(null);
    const error = await service.view(actor, userId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(audit.insert).not.toHaveBeenCalled();
  });

  it('cada carregamento grava um registro (2 views = 2 inserts)', async () => {
    const { audit, service } = setup();
    await service.view(actor, userId);
    await service.view(actor, userId);
    expect(audit.insert).toHaveBeenCalledTimes(2);
  });
});
