import { ImportCleanupCron } from './import-cleanup.cron';

const old = { tenantId: 't1', environment: 'live' as const, importId: 'i1' };

describe('ImportCleanupCron', () => {
  const storage = { listOlderThan: jest.fn(), remove: jest.fn() };
  const repo = {
    findById: jest.fn(),
    deleteOlderThan: jest.fn(),
    failStuck: jest.fn(),
  };
  const reader = { markFailed: jest.fn() };
  let cron: ImportCleanupCron;

  beforeEach(() => {
    jest.resetAllMocks();
    storage.remove.mockResolvedValue(undefined);
    repo.deleteOlderThan.mockResolvedValue(0);
    repo.failStuck.mockResolvedValue(0);
    reader.markFailed.mockResolvedValue(undefined);
    cron = new ImportCleanupCron(
      storage as never,
      repo as never,
      reader as never,
    );
  });

  it('fails an import stuck in processing and deletes its file', async () => {
    storage.listOlderThan.mockResolvedValue([old]);
    repo.findById.mockResolvedValue({ status: 'processing' });
    await cron.run();
    expect(storage.listOlderThan).toHaveBeenCalledWith(24);
    expect(reader.markFailed).toHaveBeenCalledWith(
      { ...old },
      'ERROR_IMPORT_UNREADABLE',
    );
  });

  it('just deletes a leftover file of an import that already finished or no longer exists', async () => {
    storage.listOlderThan.mockResolvedValue([
      old,
      { ...old, importId: 'gone' },
    ]);
    repo.findById
      .mockResolvedValueOnce({ status: 'ready' })
      .mockResolvedValueOnce(null);
    await cron.run();
    expect(reader.markFailed).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledTimes(2);
  });

  it('drops imports older than 30 days and survives a failure on one file', async () => {
    storage.listOlderThan.mockResolvedValue([old, { ...old, importId: 'i2' }]);
    repo.findById
      .mockRejectedValueOnce(new Error('db'))
      .mockResolvedValueOnce({ status: 'ready' });
    await expect(cron.run()).resolves.toBeUndefined();
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(repo.deleteOlderThan).toHaveBeenCalledWith(30);
  });

  it('also fails an import left processing with no stored file (a crash between saving and uploading)', async () => {
    storage.listOlderThan.mockResolvedValue([]);
    repo.failStuck.mockResolvedValue(2);
    await cron.run();
    expect(repo.failStuck).toHaveBeenCalledWith(24);
  });
});
