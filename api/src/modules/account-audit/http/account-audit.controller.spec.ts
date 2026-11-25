import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { REQUIRED_TENANT_PERMISSION } from '@/modules/auth/require-permission.decorator';
import type { IAccountAuditRepository } from '../domain/account-audit.repository';
import { AccountAuditController } from './account-audit.controller';
import { ListAuditEventsQuery } from './list-audit-events.query';

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const parse = (query: Record<string, unknown>) =>
  pipe.transform(query, {
    type: 'query',
    metatype: ListAuditEventsQuery,
  }) as Promise<ListAuditEventsQuery>;

describe('AccountAuditController', () => {
  it('requires settings.manage', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_TENANT_PERMISSION,
        AccountAuditController.prototype.list,
      ),
    ).toBe('settings.manage');
  });

  it('passes the session environment and filters to the repository', async () => {
    const listPage = jest.fn().mockResolvedValue({ data: [] });
    const controller = new AccountAuditController({
      listPage,
    } as unknown as IAccountAuditRepository);
    const query = await parse({
      actor_type: 'agent',
      from: '2026-11-01T00:00:00.000Z',
      limit: '20',
      cursor: 'abc',
    });
    await controller.list(query, {
      authContext: { activeTenantId: 't1', executionEnvironment: 'live' },
    } as never);
    expect(listPage).toHaveBeenCalledWith(
      't1',
      'live',
      {
        actorType: 'agent',
        from: new Date('2026-11-01T00:00:00.000Z'),
        to: undefined,
      },
      { limit: 20, cursor: 'abc' },
    );
  });

  it('rejects actor_type outside the four values and limit above 100', async () => {
    await expect(parse({ actor_type: 'robot' })).rejects.toBeDefined();
    await expect(parse({ limit: '101' })).rejects.toBeDefined();
    await expect(parse({ limit: '100' })).resolves.toMatchObject({
      limit: 100,
    });
    await expect(parse({ from: 'not-a-date' })).rejects.toBeDefined();
  });
});
