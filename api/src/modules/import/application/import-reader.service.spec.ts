import { ImportReaderService } from './import-reader.service';

const ref = { tenantId: 't1', environment: 'live' as const, importId: 'imp1' };
const csv = (text: string) => Buffer.from(text);

describe('ImportReaderService', () => {
  const repo = {
    findById: jest.fn(),
    deleteRows: jest.fn(),
    insertRows: jest.fn(),
    updateStatus: jest.fn(),
  };
  const storage = { read: jest.fn(), remove: jest.fn() };
  const batch = { checkItem: jest.fn() };
  const companies = { findById: jest.fn() };
  let service: ImportReaderService;

  const record = (over: object = {}) => ({
    id: 'imp1',
    tenantId: 't1',
    environment: 'live',
    fileName: 'n.csv',
    companyId: null,
    status: 'processing',
    ...over,
  });
  const savedRows = () =>
    (
      repo.insertRows.mock.calls[0] as [
        string,
        string,
        Array<Record<string, unknown>>,
      ]
    )[2];

  beforeEach(() => {
    jest.resetAllMocks();
    repo.findById.mockResolvedValue(record());
    batch.checkItem.mockResolvedValue({ ok: true });
    service = new ImportReaderService(
      repo as never,
      storage as never,
      batch as never,
      companies as never,
    );
  });

  it('turns each line into a valid or invalid row, then marks the import ready and deletes the file', async () => {
    storage.read.mockResolvedValue(
      csv(
        'cnpj;descricao;valor\n12.345.678/0001-95;Consultoria;10,00\n12.345.678/0001-95;Ruim;abc\n',
      ),
    );
    batch.checkItem.mockImplementation((raw: { amount: unknown }) =>
      Promise.resolve(
        typeof raw.amount === 'number'
          ? { ok: true }
          : {
              ok: false,
              error: {
                code: 'ERROR_VALIDATION',
                message: 'amount must be a number',
              },
            },
      ),
    );
    await service.read(ref);
    const rows = savedRows();
    expect(rows).toMatchObject([
      {
        line: 2,
        status: 'valid',
        data: { companyTaxId: '12345678000195', amount: 10 },
        errorCode: null,
      },
      {
        line: 3,
        status: 'invalid',
        errorCode: 'ERROR_VALIDATION',
        errorMessage: 'amount must be a number',
      },
    ]);
    expect(repo.deleteRows.mock.invocationCallOrder[0]).toBeLessThan(
      repo.insertRows.mock.invocationCallOrder[0],
    );
    expect(repo.updateStatus).toHaveBeenCalledWith('t1', 'imp1', {
      status: 'ready',
    });
    expect(storage.remove).toHaveBeenCalledWith('t1', 'live', 'imp1');
  });

  it('uses the chosen company when the row has no CNPJ, and rejects a CNPJ that differs from it', async () => {
    repo.findById.mockResolvedValue(record({ companyId: 'c1' }));
    companies.findById.mockResolvedValue({ id: 'c1', taxId: '12345678000195' });
    storage.read.mockResolvedValue(
      csv('cnpj;valor\n;10\n12.345.678/0001-95;10\n99.999.999/0001-99;10\n'),
    );
    await service.read(ref);
    const rows = savedRows();
    expect(rows[0]).toMatchObject({
      status: 'valid',
      data: { companyId: 'c1' },
    });
    expect(rows[1]).toMatchObject({
      status: 'valid',
      data: { companyTaxId: '12345678000195' },
    });
    expect(rows[2]).toMatchObject({
      status: 'invalid',
      errorCode: 'ERROR_IMPORT_COMPANY_MISMATCH',
    });
  });

  it('flags rows with no company at all', async () => {
    storage.read.mockResolvedValue(csv('valor\n10\n'));
    await service.read(ref);
    expect(savedRows()[0]).toMatchObject({
      status: 'invalid',
      errorCode: 'ERROR_IMPORT_COMPANY_REQUIRED',
    });
    expect(batch.checkItem).not.toHaveBeenCalled();
  });

  it('fails the import and still deletes the file when the file itself is bad', async () => {
    storage.read.mockResolvedValue(csv('valor\n' + '1\n'.repeat(2001)));
    await service.read(ref);
    expect(repo.updateStatus).toHaveBeenCalledWith('t1', 'imp1', {
      status: 'failed',
      errorCode: 'ERROR_IMPORT_TOO_MANY_ROWS',
    });
    expect(repo.insertRows).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalled();
  });

  it('fails a .csv that is really an Excel file', async () => {
    storage.read.mockResolvedValue(Buffer.from('PK\x03\x04zzzz'));
    await service.read(ref);
    expect(repo.updateStatus).toHaveBeenCalledWith('t1', 'imp1', {
      status: 'failed',
      errorCode: 'ERROR_IMPORT_UNREADABLE',
    });
  });

  it('keeps the file for the retry when something unexpected happens', async () => {
    storage.read.mockRejectedValue(new Error('s3 down'));
    await expect(service.read(ref)).rejects.toThrow('s3 down');
    expect(storage.remove).not.toHaveBeenCalled();
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('does nothing for an import that is no longer processing', async () => {
    repo.findById.mockResolvedValue(record({ status: 'ready' }));
    await service.read(ref);
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('markFailed records the code and removes the file', async () => {
    await service.markFailed(ref, 'ERROR_IMPORT_UNREADABLE');
    expect(repo.updateStatus).toHaveBeenCalledWith('t1', 'imp1', {
      status: 'failed',
      errorCode: 'ERROR_IMPORT_UNREADABLE',
    });
    expect(storage.remove).toHaveBeenCalled();
  });

  it('records how many rows to expect, then saves them in chunks so progress is visible while reading', async () => {
    const lines = Array.from(
      { length: 250 },
      (_, i) => `12.345.678/0001-95;Serviço ${i};10,00`,
    ).join('\n');
    storage.read.mockResolvedValue(csv(`cnpj;descricao;valor\n${lines}\n`));
    await service.read(ref);
    expect(repo.updateStatus).toHaveBeenCalledWith('t1', 'imp1', {
      status: 'processing',
      rowsExpected: 250,
      unknownColumns: [],
    });
    expect(
      (repo.insertRows.mock.calls as unknown[][]).map(
        (call) => (call[2] as unknown[]).length,
      ),
    ).toEqual([100, 100, 50]);
    expect(repo.updateStatus).toHaveBeenLastCalledWith('t1', 'imp1', {
      status: 'ready',
    });
  });

  it('fails the import with its own code, without retrying, when the chosen company was deleted meanwhile', async () => {
    repo.findById.mockResolvedValue(record({ companyId: 'c1' }));
    storage.read.mockResolvedValue(csv('valor\n10\n'));
    const gone = new Error('Company not found');
    gone.name = 'CompanyNotFoundError';
    companies.findById.mockRejectedValue(gone);
    await service.read(ref);
    expect(repo.updateStatus).toHaveBeenCalledWith('t1', 'imp1', {
      status: 'failed',
      errorCode: 'ERROR_IMPORT_COMPANY_NOT_FOUND',
    });
    expect(storage.remove).toHaveBeenCalled();
  });

  it('records the columns it did not recognize so the screen can say they were ignored', async () => {
    storage.read.mockResolvedValue(
      csv('cnpj;valor;obs;cor\n12.345.678/0001-95;10;x;y\n'),
    );
    await service.read(ref);
    expect(repo.updateStatus).toHaveBeenCalledWith('t1', 'imp1', {
      status: 'processing',
      rowsExpected: 1,
      unknownColumns: ['obs', 'cor'],
    });
  });
});
