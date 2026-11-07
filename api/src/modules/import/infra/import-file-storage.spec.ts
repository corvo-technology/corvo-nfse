import { ConfigService } from '@nestjs/config';
import { ImportFileStorage } from './import-file-storage';

const send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const cmd = (type: string) =>
    jest.fn().mockImplementation((args) => ({ __type: type, args }));
  return {
    PutObjectCommand: cmd('Put'),
    GetObjectCommand: cmd('Get'),
    DeleteObjectCommand: cmd('Delete'),
    ListObjectsV2Command: cmd('List'),
  };
});

const sent = (i = 0) =>
  (send.mock.calls as unknown[][])[i]?.[0] as {
    __type: string;
    args: Record<string, unknown>;
  };
const T = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';

describe('ImportFileStorage', () => {
  let storage: ImportFileStorage;
  beforeEach(() => {
    jest.clearAllMocks();
    send.mockResolvedValue({});
    storage = new ImportFileStorage(
      { get: () => 'bucket-x' } as unknown as ConfigService,
      { send } as never,
    );
  });

  it('saves under imports/<tenant>/<env>/<id> and never uses a file name', async () => {
    await storage.save(T, 'live', I, Buffer.from('a;b'));
    expect(sent()).toMatchObject({
      __type: 'Put',
      args: { Bucket: 'bucket-x', Key: `imports/${T}/live/${I}` },
    });
  });

  it('reads the bytes back', async () => {
    send.mockResolvedValue({
      Body: {
        transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      },
    });
    expect(await storage.read(T, 'test', I)).toEqual(Buffer.from([1, 2, 3]));
    expect(sent().args.Key).toBe(`imports/${T}/test/${I}`);
  });

  it('removes the file, and a missing file is not an error', async () => {
    await storage.remove(T, 'live', I);
    expect(sent()).toMatchObject({
      __type: 'Delete',
      args: { Key: `imports/${T}/live/${I}` },
    });
  });

  it('lists only files older than the given hours, across pages', async () => {
    const now = Date.now();
    send
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: `imports/${T}/live/${I}`,
            LastModified: new Date(now - 30 * 3600_000),
          },
          {
            Key: `imports/${T}/test/fresh`,
            LastModified: new Date(now - 1 * 3600_000),
          },
        ],
        NextContinuationToken: 'next',
      })
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: `imports/${T}/test/old2`,
            LastModified: new Date(now - 48 * 3600_000),
          },
        ],
      });
    expect(await storage.listOlderThan(24)).toEqual([
      { tenantId: T, environment: 'live', importId: I },
      { tenantId: T, environment: 'test', importId: 'old2' },
    ]);
    expect(sent(1).args.ContinuationToken).toBe('next');
    expect(sent(0).args.Prefix).toBe('imports/');
  });
});
