import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import {
  NFSE_GET_DOWNLOAD_URL_TOOL,
  createNfseGetDownloadUrlHandler,
} from './nfse-get-download-url.tool';

const ctx = {
  activeTenantId: 'tenant-1',
  executionEnvironment: 'test',
} as AuthContext;

describe('nfse_get_download_url tool', () => {
  it('returns the temporary signed URL generated for the caller tenant', async () => {
    const getDownloadUrl = jest.fn().mockResolvedValue({
      url: 'https://storage.example.test/signed-url',
      expiresAt: new Date('2026-10-22T13:00:00.000Z'),
      fileName: 'nfse-3.pdf',
      mimeType: 'application/pdf',
    });
    const findByAccessKeyAndTenantId = jest.fn().mockResolvedValue({
      id: 'invoice-1',
    });
    const handler = createNfseGetDownloadUrlHandler(
      { getDownloadUrl } as never,
      { findByAccessKeyAndTenantId },
    );

    await expect(
      handler({ access_key: 'access-key', format: 'pdf' }, ctx),
    ).resolves.toEqual({
      access_key: 'access-key',
      format: 'pdf',
      download_url: 'https://storage.example.test/signed-url',
      expires_at: '2026-10-22T13:00:00.000Z',
      file_name: 'nfse-3.pdf',
      mime_type: 'application/pdf',
    });
    expect(getDownloadUrl).toHaveBeenCalledWith(
      'invoice-1',
      'tenant-1',
      'pdf',
      'test',
    );
  });

  it('rejects unsupported document formats before querying the invoice', async () => {
    const findByAccessKeyAndTenantId = jest.fn();
    const handler = createNfseGetDownloadUrlHandler(
      { getDownloadUrl: jest.fn() } as never,
      { findByAccessKeyAndTenantId },
    );

    await expect(
      handler({ access_key: 'access-key', format: 'html' }, ctx),
    ).rejects.toThrow('Invalid input: format');
    expect(findByAccessKeyAndTenantId).not.toHaveBeenCalled();
  });

  it('documents a one-hour signed URL for PDF and XML', () => {
    expect(NFSE_GET_DOWNLOAD_URL_TOOL.description).toContain('one hour');
    expect(
      NFSE_GET_DOWNLOAD_URL_TOOL.inputSchema.properties.format.enum,
    ).toEqual(['pdf', 'xml']);
  });
});
