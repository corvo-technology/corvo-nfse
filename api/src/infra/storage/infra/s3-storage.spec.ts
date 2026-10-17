import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3DocumentStorage } from './s3-storage';

const mockSend = jest.fn();

const firstSentCommand = () =>
  (mockSend.mock.calls as unknown[][])[0][0] as {
    args: Record<string, unknown>;
  };

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

describe('S3DocumentStorage', () => {
  let storage: S3DocumentStorage;
  let mockClient: jest.Mocked<S3Client>;
  const tenantId = 'tenant-1';
  const invoiceId = 'inv-123';

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockClient = {
      send: mockSend,
    } as unknown as jest.Mocked<S3Client>;

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string | boolean> = {
          'storage.s3Bucket': 'corvo-nfse',
          'storage.s3Endpoint': 'https://s3.example.com',
          'storage.s3Region': 'us-east-1',
          'storage.s3ForcePathStyle': true,
        };
        return config[key];
      }),
    } as unknown as ConfigService;

    storage = new S3DocumentStorage(mockConfigService, mockClient);
  });

  describe('saveXml', () => {
    it('sends PutObjectCommand with correct key format', async () => {
      const xml = '<xml>test</xml>';
      await storage.saveXml(tenantId, invoiceId, xml);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = firstSentCommand();
      expect(call.args.Key).toBe(
        `${tenantId}/invoices/${invoiceId}/invoice.xml`,
      );
      expect(call.args.Bucket).toBe('corvo-nfse');
      expect(call.args.ContentType).toBe('application/xml');
    });
  });

  describe('savePdf', () => {
    it('sends PutObjectCommand with correct key format', async () => {
      const pdf = Buffer.from('%PDF-1.4');
      await storage.savePdf(tenantId, invoiceId, pdf);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = firstSentCommand();
      expect(call.args.Key).toBe(
        `${tenantId}/invoices/${invoiceId}/invoice.pdf`,
      );
      expect(call.args.ContentType).toBe('application/pdf');
    });
  });

  describe('getXml', () => {
    it('sends GetObjectCommand with correct key and returns transformed string', async () => {
      const xmlBody = {
        transformToString: jest.fn().mockResolvedValue('<xml>content</xml>'),
      };
      mockSend.mockResolvedValue({ Body: xmlBody });

      const result = await storage.getXml(tenantId, invoiceId);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = firstSentCommand();
      expect(call.args.Key).toBe(
        `${tenantId}/invoices/${invoiceId}/invoice.xml`,
      );
      expect(result).toBe('<xml>content</xml>');
    });
  });

  describe('getPdf', () => {
    it('sends GetObjectCommand and returns byte array as Buffer', async () => {
      const pdfBody = {
        transformToByteArray: jest
          .fn()
          .mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
      };
      mockSend.mockResolvedValue({ Body: pdfBody });

      const result = await storage.getPdf(tenantId, invoiceId);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = firstSentCommand();
      expect(call.args.Key).toBe(
        `${tenantId}/invoices/${invoiceId}/invoice.pdf`,
      );
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('exists', () => {
    it('returns true when HeadObject returns 200', async () => {
      mockSend.mockResolvedValue({ $metadata: { httpStatusCode: 200 } });

      const result = await storage.exists(tenantId, invoiceId, 'xml');

      expect(result).toBe(true);
      const call = firstSentCommand();
      expect(call.args.Key).toBe(
        `${tenantId}/invoices/${invoiceId}/invoice.xml`,
      );
    });

    it('returns false when HeadObject returns 404', async () => {
      mockSend.mockRejectedValue({ $metadata: { httpStatusCode: 404 } });

      const result = await storage.exists(tenantId, invoiceId, 'xml');

      expect(result).toBe(false);
    });

    it('throws non-404 errors', async () => {
      mockSend.mockRejectedValue({ $metadata: { httpStatusCode: 500 } });

      await expect(storage.exists(tenantId, invoiceId, 'xml')).rejects.toEqual({
        $metadata: { httpStatusCode: 500 },
      });
    });
  });

  describe('getSignedUrl', () => {
    it('returns SignedDocumentUrl with correct fields', async () => {
      const result = await storage.getSignedUrl(tenantId, invoiceId, 'xml', {
        fileName: 'nota-fiscal.xml',
        expiresInSeconds: 600,
      });

      expect(result).toMatchObject({
        url: 'https://signed-url.example.com',
        fileName: 'nota-fiscal.xml',
        mimeType: 'application/xml',
      });
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('uses default 300s expiration when expiresInSeconds not provided', async () => {
      (getSignedUrl as jest.Mock).mockClear();

      await storage.getSignedUrl(tenantId, invoiceId, 'pdf', {
        fileName: 'nota-fiscal.pdf',
      });

      expect(getSignedUrl).toHaveBeenCalled();
    });
  });
});
