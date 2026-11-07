import { ImportController } from './import.controller';

describe('ImportController POST /imports', () => {
  const intake = { start: jest.fn() };
  const review = { list: jest.fn() };
  const controller = new ImportController(
    intake as never,
    review as never,
    {} as never,
  );
  const req = {
    authContext: {
      activeTenantId: 't1',
      authUserId: 'u1',
      executionEnvironment: 'live',
    },
  } as never;

  beforeEach(() => jest.resetAllMocks());

  it('hands the file, tenant, environment and user to the intake service', async () => {
    intake.start.mockResolvedValue({
      id: 'i1',
      status: 'processing',
      duplicateOf: null,
    });
    const buffer = Buffer.from('valor\n1\n');
    const out = await controller.start(
      req,
      { originalname: 'notas.csv', buffer, size: buffer.length },
      { companyId: 'c1' },
    );
    expect(intake.start).toHaveBeenCalledWith({
      tenantId: 't1',
      environment: 'live',
      userId: 'u1',
      fileName: 'notas.csv',
      bytes: buffer,
      companyId: 'c1',
    });
    expect(out).toEqual({
      data: { id: 'i1', status: 'processing', duplicate_of: null },
    });
  });

  it('rejects a request with no file', async () => {
    await expect(controller.start(req, undefined, {})).rejects.toMatchObject({
      name: 'ImportFileInvalidError',
    });
    expect(intake.start).not.toHaveBeenCalled();
  });

  it('lists the recent imports of the tenant and environment, ten by default', async () => {
    review.list.mockResolvedValue([
      {
        id: 'i1',
        status: 'done',
        fileName: 'n.csv',
        companyId: null,
        errorCode: null,
        emitStartedAt: null,
        emitFinishedAt: null,
        createdAt: new Date('2026-11-07T10:00:00Z'),
        counters: {
          total: 1,
          valid: 0,
          invalid: 0,
          accepted: 1,
          authorized: 1,
          awaitingCredits: 0,
          failed: 0,
          pending: 0,
        },
      },
    ]);
    const out = await controller.list({}, req);
    expect(review.list).toHaveBeenCalledWith('t1', 'live', 10);
    expect(out.data[0]).toMatchObject({
      id: 'i1',
      file_name: 'n.csv',
      counters: { awaiting_credits: 0 },
    });
    await controller.list({ limit: 5 }, req);
    expect(review.list).toHaveBeenLastCalledWith('t1', 'live', 5);
  });
});
