import { BadRequestException } from '@nestjs/common';
import { InvoiceSchedule } from '../domain/invoice-schedule';
import { ScheduleNotFoundError } from '../domain/schedule-errors';
import { REQUIRED_TENANT_PERMISSION } from '@/modules/auth/require-permission.decorator';
import { ScheduleController } from './schedule.controller';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-06T15:00:00Z');
const ALL = [
  'nfse.invoices.view',
  'nfse.invoices.issue',
  'nfe.documents.view',
  'nfe.documents.issue',
];
const req = (
  apiKeyEnvironment: 'test' | 'live' = 'live',
  permissions: string[] = ALL,
) =>
  ({
    authContext: { activeTenantId: TENANT, apiKeyEnvironment, permissions },
  }) as never;

const schedule = (
  environment: 'test' | 'live' = 'live',
  documentType: 'nfse' | 'nfe' = 'nfse',
) =>
  InvoiceSchedule.create(
    {
      tenantId: TENANT,
      environment,
      documentType,
      companyId: 'c1',
      kind: 'recurring',
      frequency: 'WEEKLY',
      firstOn: '2026-11-09',
      endsOn: null,
      invoiceInput: { amount: 10 },
      createdBy: null,
    },
    NOW,
    15,
  );

function build(found = schedule()) {
  const service = {
    get: jest.fn().mockResolvedValue(found),
    list: jest.fn().mockResolvedValue({ items: [found], total: 3 }),
    runs: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    update: jest.fn().mockResolvedValue(found),
    pause: jest.fn().mockResolvedValue(found),
    resume: jest.fn().mockResolvedValue(found),
    cancel: jest.fn().mockResolvedValue(found),
  };
  return { controller: new ScheduleController(service as never), service };
}

describe('ScheduleController', () => {
  it('lists only the schedules of the caller environment, as a cursor page in snake_case', async () => {
    const { controller, service } = build();
    const page = await controller.list({ limit: 1 }, req('test'));
    expect(service.list).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ environment: 'test' }),
      { limit: 1, offset: 0 },
    );
    expect(page.data[0]).toMatchObject({
      kind: 'recurring',
      frequency: 'WEEKLY',
      next_run_on: '2026-11-09',
      company_id: 'c1',
      status: 'active',
    });
    expect(page.pagination).toEqual({
      limit: 1,
      hasMore: true,
      nextCursor: '1',
    });
  });

  it('the cursor is the offset of the next item; a bad one is a 400', async () => {
    const { controller, service } = build();
    await controller.list({ cursor: '1', limit: 2 }, req());
    expect(service.list).toHaveBeenCalledWith(TENANT, expect.anything(), {
      limit: 2,
      offset: 1,
    });
    await expect(
      controller.list({ cursor: 'x' }, req()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a schedule of the other environment is not found', async () => {
    const { controller } = build(schedule('test'));
    await expect(controller.get(ID, req('live'))).rejects.toBeInstanceOf(
      ScheduleNotFoundError,
    );
  });

  it.each(['pause', 'resume', 'cancel'] as const)(
    '%s acts on the workspace schedule and answers it',
    async (action) => {
      const { controller, service } = build();
      const out = await controller[action](ID, req());
      expect(service[action]).toHaveBeenCalledWith(ID, TENANT);
      expect(out.data).toMatchObject({ id: expect.any(String) as string });
    },
  );

  it('update passes only what the body carries', async () => {
    const { controller, service } = build();
    await controller.update(ID, { frequency: 'MONTHLY', endsOn: null }, req());
    expect(service.update).toHaveBeenCalledWith(ID, TENANT, {
      invoice: undefined,
      endsOn: null,
      frequency: 'MONTHLY',
      anchorOn: undefined,
    });
  });

  it('mutating routes need the issue permission, reading routes the view permission', () => {
    const permission = (name: keyof ScheduleController) =>
      Reflect.getMetadata(
        REQUIRED_TENANT_PERMISSION,
        ScheduleController.prototype[name],
      ) as string;
    for (const name of ['list', 'get', 'runs'] as const)
      expect(permission(name)).toEqual([
        'nfse.invoices.view',
        'nfe.documents.view',
      ]);
    for (const name of ['update', 'pause', 'resume', 'cancel'] as const)
      expect(permission(name)).toEqual([
        'nfse.invoices.issue',
        'nfe.documents.issue',
      ]);
  });

  it('answers the type of document each schedule issues', async () => {
    const { controller } = build(schedule('live', 'nfe'));
    expect((await controller.get(ID, req())).data).toMatchObject({
      type: 'nfe',
    });
  });

  it('a key without the NF-e permission does not see an NF-e schedule, and a view-only key cannot change it', async () => {
    const { controller } = build(schedule('live', 'nfe'));
    const nfseOnly = req('live', ['nfse.invoices.view', 'nfse.invoices.issue']);
    await expect(controller.get(ID, nfseOnly)).rejects.toBeInstanceOf(
      ScheduleNotFoundError,
    );
    await expect(controller.pause(ID, nfseOnly)).rejects.toBeInstanceOf(
      ScheduleNotFoundError,
    );
    const nfeViewOnly = req('live', ['nfe.documents.view']);
    await expect(controller.get(ID, nfeViewOnly)).resolves.toBeDefined();
    await expect(controller.pause(ID, nfeViewOnly)).rejects.toBeInstanceOf(
      ScheduleNotFoundError,
    );
  });

  it('the list only holds the kinds of document the key can view, narrowed by ?type=', async () => {
    const { controller, service } = build();
    await controller.list({}, req('live', ['nfse.invoices.view']));
    expect(service.list).toHaveBeenLastCalledWith(
      TENANT,
      expect.objectContaining({ documentTypes: ['nfse'] }),
      expect.anything(),
    );
    await controller.list({ type: 'nfe' }, req());
    expect(service.list).toHaveBeenLastCalledWith(
      TENANT,
      expect.objectContaining({ documentTypes: ['nfe'] }),
      expect.anything(),
    );
  });
});
