import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageRef } from '../domain/document-storage';
import { S3DocumentStorage } from './s3-storage';

const mockSend = jest.fn();

type Sent = { __type: string; args: Record<string, unknown> };
const sent = (index = 0) =>
  (mockSend.mock.calls as unknown[][])[index][0] as Sent;

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  PutObjectCommand: jest
    .fn()
    .mockImplementation((args) => ({ __type: 'PutObject', args })),
  GetObjectCommand: jest
    .fn()
    .mockImplementation((args) => ({ __type: 'GetObject', args })),
  HeadObjectCommand: jest
    .fn()
    .mockImplementation((args) => ({ __type: 'HeadObject', args })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.example.com'),
}));

const nfe: StorageRef = {
  type: 'nfe',
  id: 'doc-1',
  tenantId: 't-1',
  environment: 'test',
};

describe('S3DocumentStorage by DocumentRef', () => {
  let storage: S3DocumentStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    const config = {
      get: jest.fn((key: string) =>
        key === 'storage.s3Bucket' ? 'corvo-nfse' : undefined,
      ),
    } as unknown as ConfigService;
    storage = new S3DocumentStorage(config, {
      send: mockSend,
    } as unknown as S3Client);
  });

  it('saves an NF-e file under tenant/environment/nfe/id/fileName', async () => {
    const key = await storage.saveFile(
      nfe,
      'nfe-proc.xml',
      '<nfeProc/>',
      'application/xml',
    );
    expect(key).toBe('t-1/test/nfe/doc-1/nfe-proc.xml');
    expect(sent().args).toMatchObject({
      Bucket: 'corvo-nfse',
      Key: 't-1/test/nfe/doc-1/nfe-proc.xml',
      ContentType: 'application/xml',
      Body: '<nfeProc/>',
    });
  });

  it('keeps the DANFE and the events under the same folder', async () => {
    expect(
      await storage.saveFile(
        { ...nfe, environment: 'live' },
        'danfe.pdf',
        Buffer.from('%PDF'),
        'application/pdf',
      ),
    ).toBe('t-1/live/nfe/doc-1/danfe.pdf');
    expect(
      await storage.saveFile(
        nfe,
        'events/110111-1.xml',
        '<e/>',
        'application/xml',
      ),
    ).toBe('t-1/test/nfe/doc-1/events/110111-1.xml');
  });

  it('stores an inutilization under nfe-inutilizacoes/{id}.xml', async () => {
    const key = await storage.saveFile(
      {
        type: 'nfe-inutilization',
        id: 'inu-1',
        tenantId: 't-1',
        environment: 'live',
      },
      'proc.xml',
      '<procInutNFe/>',
      'application/xml',
    );
    expect(key).toBe('t-1/live/nfe-inutilizacoes/inu-1.xml');
  });

  it('refuses a file name that could leave the folder', async () => {
    for (const name of ['../x', 'a/../b', '/abs.xml', 'A.XML', '', 'a b.xml'])
      await expect(
        storage.saveFile(nfe, name, 'x', 'application/xml'),
      ).rejects.toThrow('Invalid file name');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('refuses a document type that has no folder yet', async () => {
    await expect(
      storage.saveFile({ ...nfe, type: 'nfce' }, 'danfe.pdf', 'x', 'a/b'),
    ).rejects.toThrow('does not store files');
  });

  it('reads a file back as a Buffer', async () => {
    mockSend.mockResolvedValue({
      Body: {
        transformToByteArray: () => Promise.resolve(Uint8Array.from([1, 2])),
      },
    });
    const body = await storage.getFile(nfe, 'danfe.pdf');
    expect(body).toEqual(Buffer.from([1, 2]));
    expect(sent().args.Key).toBe('t-1/test/nfe/doc-1/danfe.pdf');
  });

  it('answers fileExists, treating 404 as false', async () => {
    mockSend.mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } });
    expect(await storage.fileExists(nfe, 'danfe.pdf')).toBe(true);
    mockSend.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await storage.fileExists(nfe, 'danfe.pdf')).toBe(false);
    mockSend.mockRejectedValueOnce(new Error('boom'));
    await expect(storage.fileExists(nfe, 'danfe.pdf')).rejects.toThrow('boom');
  });

  it('signs a download URL with the download name and the right type', async () => {
    const result = await storage.getFileSignedUrl(nfe, 'nfe-proc.xml', {
      downloadName: 'nfe-10.xml',
    });
    expect(result).toMatchObject({
      url: 'https://signed-url.example.com',
      fileName: 'nfe-10.xml',
      mimeType: 'application/xml',
    });
    const call = (getSignedUrl as jest.Mock).mock.calls[0] as unknown[];
    expect((call[1] as Sent).args).toMatchObject({
      Key: 't-1/test/nfe/doc-1/nfe-proc.xml',
      ResponseContentDisposition: 'attachment; filename="nfe-10.xml"',
      ResponseContentType: 'application/xml',
    });
    expect(call[2]).toEqual({ expiresIn: 300 });
  });

  it('leaves the NFS-e keys as they were', async () => {
    await storage.saveXml('t', 'inv', '<x/>', 'live');
    expect(sent().args.Key).toBe('t/live/invoices/inv/invoice.xml');
    await storage.savePdf('t', 'inv', Buffer.from('p'));
    expect(sent(1).args.Key).toBe('t/invoices/inv/invoice.pdf');
  });
});
