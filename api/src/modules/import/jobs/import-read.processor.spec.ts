import { ImportReadProcessor } from './import-read.processor';

const data = { tenantId: 't', environment: 'live' as const, importId: 'i' };

describe('ImportReadProcessor', () => {
  const reader = { read: jest.fn(), markFailed: jest.fn() };
  const processor = new ImportReadProcessor(reader as never);
  beforeEach(() => jest.resetAllMocks());

  it('reads the import', async () => {
    reader.read.mockResolvedValue(undefined);
    await processor.process({ data, attemptsMade: 0 } as never);
    expect(reader.read).toHaveBeenCalledWith(data);
  });

  it('rethrows early failures so the queue retries', async () => {
    reader.read.mockRejectedValue(new Error('s3 down'));
    await expect(
      processor.process({ data, attemptsMade: 0 } as never),
    ).rejects.toThrow('s3 down');
    expect(reader.markFailed).not.toHaveBeenCalled();
  });

  it('on the last attempt fails the import instead of leaving it processing forever', async () => {
    reader.read.mockRejectedValue(new Error('s3 down'));
    reader.markFailed.mockResolvedValue(undefined);
    await processor.process({ data, attemptsMade: 2 } as never);
    expect(reader.markFailed).toHaveBeenCalledWith(
      data,
      'ERROR_IMPORT_UNREADABLE',
    );
  });
});
