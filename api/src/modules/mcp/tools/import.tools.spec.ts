import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import {
  IMPORT_CREATE_TOOL,
  IMPORT_DISCARD_TOOL,
  IMPORT_EMIT_TOOL,
  IMPORT_FIX_ROW_TOOL,
  IMPORT_GET_TOOL,
  IMPORT_LIST_TOOL,
  IMPORT_ROWS_TOOL,
  MCP_IMPORT_MAX_BYTES,
  createImportCreateHandler,
  createImportDiscardHandler,
  createImportEmitHandler,
  createImportFixRowHandler,
  createImportGetHandler,
  createImportListHandler,
  createImportRowsHandler,
} from './import.tools';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const COMPANY = '33333333-3333-4333-8333-333333333333';
const ctx = (environment: 'test' | 'live' = 'live') =>
  ({
    tenantId: TENANT,
    authUserId: 'u1',
    executionEnvironment: environment,
  }) as AuthContext;

const counters = {
  total: 3,
  valid: 2,
  invalid: 1,
  accepted: 0,
  authorized: 0,
  awaitingCredits: 0,
  validAmount: 150.5,
  awaitingAmount: 0,
  failed: 1,
  pending: 2,
};
const view = (status = 'ready') => ({
  id: ID,
  tenantId: TENANT,
  environment: 'live',
  userId: 'u1',
  fileName: 'n.csv',
  fileHash: 'h',
  status,
  companyId: null,
  errorCode: null,
  rowsExpected: 3,
  unknownColumns: [],
  emitStartedAt: null,
  emitFinishedAt: null,
  createdAt: new Date('2026-11-07T10:00:00Z'),
  counters,
});
const row = {
  line: 4,
  data: { amount: 10 },
  status: 'invalid',
  errorCode: 'ERROR_VALIDATION',
  errorMessage: 'bad',
  invoiceId: null,
};

function build() {
  const intake = {
    start: jest
      .fn()
      .mockResolvedValue({ id: ID, status: 'processing', duplicateOf: null }),
  };
  const review = {
    list: jest.fn().mockResolvedValue([view()]),
    get: jest.fn().mockResolvedValue(view()),
    listRows: jest.fn().mockResolvedValue({ items: [row], nextCursor: '4' }),
    updateRow: jest.fn().mockResolvedValue(row),
    discard: jest.fn().mockResolvedValue(undefined),
  };
  const emitter = { emit: jest.fn().mockResolvedValue(view('emitting')) };
  return { intake, review, emitter };
}

describe('MCP import tools', () => {
  describe('import_create', () => {
    it('sends csv text as the file, in the connected environment, and answers like the API', async () => {
      const { intake } = build();
      const out = await createImportCreateHandler(intake as never)(
        { content: 'valor\n1\n', company_id: COMPANY },
        ctx(),
      );
      expect(intake.start).toHaveBeenCalledWith({
        tenantId: TENANT,
        environment: 'live',
        userId: 'u1',
        fileName: 'import.csv',
        bytes: Buffer.from('valor\n1\n'),
        companyId: COMPANY,
      });
      expect(out).toEqual({ id: ID, status: 'processing', duplicate_of: null });
    });

    it('takes an xlsx as base64, named .xlsx unless told otherwise', async () => {
      const { intake } = build();
      const bytes = Buffer.from('PK\u0003\u0004fake');
      await createImportCreateHandler(intake as never)(
        { content_base64: bytes.toString('base64') },
        ctx('test'),
      );
      expect(intake.start).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'import.xlsx',
          environment: 'test',
          bytes,
        }),
      );
      await createImportCreateHandler(intake as never)(
        {
          content_base64: bytes.toString('base64'),
          file_name: 'notas-novembro.xlsx',
        },
        ctx(),
      );
      expect(intake.start).toHaveBeenLastCalledWith(
        expect.objectContaining({ fileName: 'notas-novembro.xlsx' }),
      );
    });

    it('wants exactly one of content or content_base64', async () => {
      const { intake } = build();
      const handler = createImportCreateHandler(intake as never);
      await expect(handler({}, ctx())).rejects.toThrow(
        /content or content_base64/i,
      );
      await expect(
        handler({ content: 'a', content_base64: 'YQ==' }, ctx()),
      ).rejects.toThrow(/content or content_base64/i);
      expect(intake.start).not.toHaveBeenCalled();
    });

    it('refuses more than 1 MB through the assistant, and says to use the API for bigger files', async () => {
      const { intake } = build();
      const big = 'x'.repeat(MCP_IMPORT_MAX_BYTES + 1);
      await expect(
        createImportCreateHandler(intake as never)({ content: big }, ctx()),
      ).rejects.toThrow(/1 MB.*API/i);
      expect(intake.start).not.toHaveBeenCalled();
    });

    it('rejects a company id that is not a uuid', async () => {
      const { intake } = build();
      await expect(
        createImportCreateHandler(intake as never)(
          { content: 'a', company_id: 'x' },
          ctx(),
        ),
      ).rejects.toThrow(/company_id/);
    });
  });

  it('import_list lists the recent imports with counters, ten by default', async () => {
    const { review } = build();
    const out = await createImportListHandler(review as never)({}, ctx());
    expect(review.list).toHaveBeenCalledWith(TENANT, 'live', 10);
    expect(out.imports[0]).toMatchObject({
      id: ID,
      file_name: 'n.csv',
      counters: { valid_amount: 150.5, awaiting_credits: 0 },
    });
    await createImportListHandler(review as never)({ limit: 3 }, ctx());
    expect(review.list).toHaveBeenLastCalledWith(TENANT, 'live', 3);
  });

  it('import_get returns status and counters', async () => {
    const { review } = build();
    const out = await createImportGetHandler(review as never)(
      { import_id: ID },
      ctx(),
    );
    expect(review.get).toHaveBeenCalledWith(TENANT, 'live', ID);
    expect(out).toMatchObject({ id: ID, status: 'ready', rows_expected: 3 });
  });

  it('import_rows pages through the rows, with an optional status filter', async () => {
    const { review } = build();
    const out = await createImportRowsHandler(review as never)(
      { import_id: ID, status: 'invalid', limit: 20, cursor: '2' },
      ctx(),
    );
    expect(review.listRows).toHaveBeenCalledWith(TENANT, 'live', ID, {
      status: 'invalid',
      cursor: '2',
      limit: 20,
    });
    expect(out).toEqual({
      rows: [
        {
          line: 4,
          data: { amount: 10 },
          status: 'invalid',
          error_code: 'ERROR_VALIDATION',
          error_message: 'bad',
          invoice_id: null,
        },
      ],
      next_cursor: '4',
      has_more: true,
    });
    await createImportRowsHandler(review as never)({ import_id: ID }, ctx());
    expect(review.listRows).toHaveBeenLastCalledWith(TENANT, 'live', ID, {
      status: undefined,
      cursor: undefined,
      limit: 50,
    });
  });

  it('import_rows refuses a page of more than 200 and an unknown status', async () => {
    const { review } = build();
    const handler = createImportRowsHandler(review as never);
    await expect(handler({ import_id: ID, limit: 201 }, ctx())).rejects.toThrow(
      /limit/,
    );
    await expect(
      handler({ import_id: ID, status: 'nope' }, ctx()),
    ).rejects.toThrow(/status/);
  });

  it('import_rows refuses a cursor that is not a number', async () => {
    const { review } = build();
    await expect(
      createImportRowsHandler(review as never)(
        { import_id: ID, cursor: 'abc' },
        ctx(),
      ),
    ).rejects.toThrow(/cursor/);
  });

  it('import_fix_row corrects one row and returns it checked again', async () => {
    const { review } = build();
    const out = await createImportFixRowHandler(review as never)(
      { import_id: ID, line: 4, item: { amount: 10 } },
      ctx(),
    );
    expect(review.updateRow).toHaveBeenCalledWith(TENANT, 'live', ID, 4, {
      amount: 10,
    });
    expect(out).toMatchObject({
      line: 4,
      status: 'invalid',
      error_code: 'ERROR_VALIDATION',
    });
    await expect(
      createImportFixRowHandler(review as never)(
        { import_id: ID, line: 0, item: {} },
        ctx(),
      ),
    ).rejects.toThrow(/line/);
  });

  it('import_emit emits, and is safe to call again after topping up credits', async () => {
    const { emitter } = build();
    const out = await createImportEmitHandler(emitter as never)(
      { import_id: ID },
      ctx(),
    );
    expect(emitter.emit).toHaveBeenCalledWith(TENANT, 'live', ID);
    expect(out).toMatchObject({ id: ID, status: 'emitting' });
  });

  it('import_discard drops an import that was not emitted', async () => {
    const { review } = build();
    const out = await createImportDiscardHandler(review as never)(
      { import_id: ID },
      ctx(),
    );
    expect(review.discard).toHaveBeenCalledWith(TENANT, 'live', ID);
    expect(out).toEqual({ import_id: ID, discarded: true });
  });

  it('describes every tool, and the file tools say what to send', () => {
    for (const tool of [
      IMPORT_CREATE_TOOL,
      IMPORT_LIST_TOOL,
      IMPORT_GET_TOOL,
      IMPORT_ROWS_TOOL,
      IMPORT_FIX_ROW_TOOL,
      IMPORT_EMIT_TOOL,
      IMPORT_DISCARD_TOOL,
    ]) {
      expect(tool.name).toMatch(/^import_/);
      expect(tool.description.length).toBeGreaterThan(40);
    }
    expect(IMPORT_CREATE_TOOL.description).toMatch(/csv/i);
    expect(IMPORT_CREATE_TOOL.inputSchema.properties).toHaveProperty('content');
    expect(IMPORT_CREATE_TOOL.inputSchema.properties).toHaveProperty(
      'content_base64',
    );
    expect(IMPORT_EMIT_TOOL.description).toMatch(/again|credits/i);
  });
});
