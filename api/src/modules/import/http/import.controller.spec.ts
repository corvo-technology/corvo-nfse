import { ImportController } from './import.controller';

describe('ImportController POST /imports', () => {
  const intake = { start: jest.fn() };
  const controller = new ImportController(intake as never);
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
      data: { id: 'i1', status: 'processing', duplicateOf: null },
    });
  });

  it('rejects a request with no file', async () => {
    await expect(controller.start(req, undefined, {})).rejects.toMatchObject({
      name: 'ImportFileInvalidError',
    });
    expect(intake.start).not.toHaveBeenCalled();
  });
});
