import { ImportReviewService } from './import-review.service';

const T = 't1';
const record = (over: object = {}) => ({
  id: 'i1',
  tenantId: T,
  environment: 'live',
  status: 'ready',
  fileName: 'n.csv',
  companyId: null,
  createdAt: new Date(),
  ...over,
});
const counters = {
  total: 2,
  valid: 1,
  invalid: 1,
  accepted: 0,
  authorized: 0,
  failed: 1,
  pending: 1,
};

describe('ImportReviewService', () => {
  const repo = {
    updateStatus: jest.fn(),
    markDone: jest.fn(),
    updateEditableRow: jest.fn(),
    findById: jest.fn(),
    counters: jest.fn(),
    listRows: jest.fn(),
    findRow: jest.fn(),
    updateRow: jest.fn(),
    delete: jest.fn(),
  };
  const storage = { remove: jest.fn() };
  const batch = { checkItem: jest.fn() };
  let service: ImportReviewService;

  beforeEach(() => {
    jest.resetAllMocks();
    repo.findById.mockResolvedValue(record());
    repo.counters.mockResolvedValue(counters);
    storage.remove.mockResolvedValue(undefined);
    service = new ImportReviewService(
      repo as never,
      storage as never,
      batch as never,
    );
  });

  it('returns the import with its counters', async () => {
    expect(await service.get(T, 'live', 'i1')).toMatchObject({
      id: 'i1',
      status: 'ready',
      counters,
    });
  });

  it('closes an emitting import once nothing is pending, and not before', async () => {
    repo.findById.mockResolvedValue(record({ status: 'emitting' }));
    repo.counters.mockResolvedValue({ ...counters, pending: 2 });
    expect((await service.get(T, 'live', 'i1')).status).toBe('emitting');
    expect(repo.updateStatus).not.toHaveBeenCalled();
    repo.counters.mockResolvedValue({ ...counters, pending: 0 });
    const done = await service.get(T, 'live', 'i1');
    expect(done.status).toBe('done');
    expect(repo.updateStatus).toHaveBeenCalledWith(T, 'i1', {
      status: 'done',
      emitFinishedAt: expect.any(Date),
    });
  });

  it('answers not found for another tenant or environment', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.get(T, 'live', 'x')).rejects.toMatchObject({
      name: 'ImportNotFoundError',
    });
    await expect(
      service.listRows(T, 'live', 'x', { limit: 50 }),
    ).rejects.toMatchObject({ name: 'ImportNotFoundError' });
  });

  it('lists rows one page at a time and refuses a page bigger than 200', async () => {
    repo.listRows.mockResolvedValue({ items: [], nextCursor: null });
    await service.listRows(T, 'live', 'i1', { limit: 50 });
    expect(repo.listRows).toHaveBeenCalledWith(T, 'live', 'i1', { limit: 50 });
    await expect(
      service.listRows(T, 'live', 'i1', { limit: 201 }),
    ).rejects.toThrow();
  });

  it('corrects a row and revalidates it', async () => {
    repo.findRow.mockResolvedValue({
      line: 4,
      status: 'invalid',
      data: { amount: 'abc', companyId: 'c1' },
    });
    batch.checkItem.mockResolvedValue({ ok: true });
    repo.updateEditableRow.mockResolvedValue(true);
    const out = await service.updateRow(T, 'live', 'i1', 4, { amount: 10 });
    expect(batch.checkItem).toHaveBeenCalledWith(
      { amount: 10, companyId: 'c1', idempotencyKey: 'import:i1:4' },
      T,
      expect.anything(),
    );
    expect(repo.updateEditableRow).toHaveBeenCalledWith(T, 'i1', 4, {
      data: { amount: 10, companyId: 'c1' },
      status: 'valid',
      errorCode: null,
      errorMessage: null,
    });
    expect(out.status).toBe('valid');
  });

  it('keeps the row invalid with the new error when the correction is still wrong', async () => {
    repo.findRow.mockResolvedValue({ line: 4, status: 'invalid', data: {} });
    batch.checkItem.mockResolvedValue({
      ok: false,
      error: { code: 'ERROR_VALIDATION', message: 'bad' },
    });
    repo.updateEditableRow.mockResolvedValue(true);
    const out = await service.updateRow(T, 'live', 'i1', 4, { amount: 'x' });
    expect(out).toMatchObject({
      status: 'invalid',
      errorCode: 'ERROR_VALIDATION',
      errorMessage: 'bad',
    });
  });

  it('refuses the edit when the row was queued for emission meanwhile (lost the race)', async () => {
    repo.findRow.mockResolvedValue({ line: 4, status: 'valid', data: {} });
    batch.checkItem.mockResolvedValue({ ok: true });
    repo.updateEditableRow.mockResolvedValue(false);
    await expect(
      service.updateRow(T, 'live', 'i1', 4, { amount: 5 }),
    ).rejects.toMatchObject({ name: 'ImportStateError' });
  });

  it('exposes an ownership check that answers not found for a foreign import', async () => {
    await expect(service.assertOwned(T, 'live', 'i1')).resolves.toBeUndefined();
    repo.findById.mockResolvedValue(null);
    await expect(service.assertOwned(T, 'live', 'x')).rejects.toMatchObject({
      name: 'ImportNotFoundError',
    });
  });

  it.each(['=HYPERLINK("x")', '+cmd', '-1+2', '@SUM(A1)'])(
    'neutralizes the spreadsheet formula %s in the error csv',
    async (text) => {
      repo.listRows
        .mockResolvedValueOnce({
          items: [
            {
              line: 2,
              status: 'invalid',
              errorCode: 'ERROR_VALIDATION',
              errorMessage: 'm',
              data: { amount: 5, service: { description: text } },
            },
          ],
          nextCursor: null,
        })
        .mockResolvedValueOnce({ items: [], nextCursor: null });
      let out = '';
      for await (const chunk of service.errorsCsv(T, 'live', 'i1'))
        out += chunk;
      expect(out).toContain(
        `;'${text.includes('"') ? text.replaceAll('"', '""') : text}`.replace(
          `;'`,
          text.includes('"') ? `;"'` : `;'`,
        ),
      );
      expect(out).not.toMatch(
        new RegExp(`;${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[;\n]`),
      );
    },
  );

  it('refuses edits once the import is no longer ready, and on rows already emitted', async () => {
    repo.findById.mockResolvedValue(record({ status: 'emitting' }));
    await expect(
      service.updateRow(T, 'live', 'i1', 4, {}),
    ).rejects.toMatchObject({ name: 'ImportStateError' });
    repo.findById.mockResolvedValue(record());
    repo.findRow.mockResolvedValue({ line: 4, status: 'accepted', data: {} });
    await expect(
      service.updateRow(T, 'live', 'i1', 4, {}),
    ).rejects.toMatchObject({ name: 'ImportStateError' });
    repo.findRow.mockResolvedValue(null);
    await expect(
      service.updateRow(T, 'live', 'i1', 9, {}),
    ).rejects.toMatchObject({ name: 'ImportNotFoundError' });
  });

  it('discards an import that was not emitted, and the file if it is still stored', async () => {
    repo.findById.mockResolvedValue(record({ status: 'processing' }));
    await service.discard(T, 'live', 'i1');
    expect(storage.remove).toHaveBeenCalledWith(T, 'live', 'i1');
    expect(repo.delete).toHaveBeenCalledWith(T, 'i1');
  });

  it('refuses to discard an import that is emitting or done', async () => {
    repo.findById.mockResolvedValue(record({ status: 'done' }));
    await expect(service.discard(T, 'live', 'i1')).rejects.toMatchObject({
      name: 'ImportStateError',
    });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('streams the error csv page by page, with a BOM, ; separators and escaped cells', async () => {
    repo.listRows
      .mockResolvedValueOnce({
        items: [
          {
            line: 2,
            status: 'invalid',
            errorCode: 'ERROR_VALIDATION',
            errorMessage: 'a; "b"',
            data: { amount: 'x', service: { description: 'Desc' } },
          },
        ],
        nextCursor: '2',
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({
        items: [
          {
            line: 5,
            status: 'rejected',
            errorCode: 'ERROR_QUOTA_EXCEEDED',
            errorMessage: 'limit',
            data: {},
          },
        ],
        nextCursor: null,
      });
    let text = '';
    for await (const chunk of service.errorsCsv(T, 'live', 'i1')) text += chunk;
    expect(text.startsWith('﻿linha;codigo;mensagem;descricao;valor\n')).toBe(
      true,
    );
    expect(text).toContain('2;ERROR_VALIDATION;"a; ""b""";Desc;x\n');
    expect(text).toContain('5;ERROR_QUOTA_EXCEEDED;limit;;\n');
    expect(repo.listRows).toHaveBeenNthCalledWith(1, T, 'live', 'i1', {
      status: 'invalid',
      limit: 200,
      cursor: undefined,
    });
  });
});
