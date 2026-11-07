import { createHash } from 'node:crypto';
import { ImportIntakeService } from './import-intake.service';

const T = 't1';
const base = {
  tenantId: T,
  environment: 'live' as const,
  userId: 'u1',
  fileName: 'notas.csv',
  bytes: Buffer.from('valor\n1\n'),
};

describe('ImportIntakeService', () => {
  const repo = {
    create: jest.fn(),
    findByFileHash: jest.fn(),
    delete: jest.fn(),
  };
  const storage = { save: jest.fn(), remove: jest.fn() };
  const queue = { add: jest.fn() };
  const companies = { findById: jest.fn() };
  let service: ImportIntakeService;

  beforeEach(() => {
    jest.resetAllMocks();
    repo.create.mockImplementation((input: object) =>
      Promise.resolve({ ...input, status: 'processing' }),
    );
    repo.findByFileHash.mockResolvedValue(null);
    storage.save.mockResolvedValue(undefined);
    queue.add.mockResolvedValue(undefined);
    storage.remove.mockResolvedValue(undefined);
    repo.delete.mockResolvedValue(undefined);
    service = new ImportIntakeService(
      repo as never,
      storage as never,
      queue as never,
      companies as never,
    );
  });

  it('stores the file, creates the import and queues the reading', async () => {
    const out = await service.start(base);
    const hash = createHash('sha256').update(base.bytes).digest('hex');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: T,
        environment: 'live',
        fileHash: hash,
        companyId: null,
      }),
    );
    expect(storage.save).toHaveBeenCalledWith(T, 'live', out.id, base.bytes);
    expect(queue.add).toHaveBeenCalledWith(
      'read',
      { tenantId: T, environment: 'live', importId: out.id },
      expect.objectContaining({ attempts: 3 }),
    );
    expect(out).toMatchObject({ status: 'processing', duplicateOf: null });
  });

  it('rejects anything that is not csv or xlsx, and files over 10 MB, before touching storage', async () => {
    await expect(
      service.start({ ...base, fileName: 'x.pdf' }),
    ).rejects.toMatchObject({ name: 'ImportFileInvalidError' });
    await expect(
      service.start({ ...base, bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ name: 'ImportFileTooLargeError' });
    expect(storage.save).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('warns about an earlier import of the same file without blocking', async () => {
    repo.findByFileHash.mockResolvedValue({ id: 'old' });
    const out = await service.start(base);
    expect(out.duplicateOf).toBe('old');
    expect(queue.add).toHaveBeenCalled();
  });

  it('checks that the chosen company exists in this tenant and environment', async () => {
    companies.findById.mockRejectedValue(new Error('CompanyNotFoundError'));
    await expect(service.start({ ...base, companyId: 'c1' })).rejects.toThrow(
      'CompanyNotFoundError',
    );
    expect(companies.findById).toHaveBeenCalledWith('c1', T, 'live');
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('undoes everything when queueing fails', async () => {
    queue.add.mockRejectedValue(new Error('redis down'));
    await expect(service.start(base)).rejects.toThrow('redis down');
    expect(storage.remove).toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalled();
  });
});
