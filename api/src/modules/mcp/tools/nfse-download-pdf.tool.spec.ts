import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import { createNfseDownloadPdfHandler } from './nfse-download-pdf.tool';

const ctx = {
  activeTenantId: 'tenant-1',
  executionEnvironment: 'test',
} as unknown as AuthContext;

describe('nfse_download_pdf tool', () => {
  const getDownloadUrl = jest.fn();
  const getPdf = jest.fn();
  const findByAccessKeyAndTenantId = jest.fn();
  const handler = createNfseDownloadPdfHandler(
    { getDownloadUrl, getPdf } as never,
    { findByAccessKeyAndTenantId },
  );
  beforeEach(() => {
    jest.resetAllMocks();
    findByAccessKeyAndTenantId.mockResolvedValue({ id: 'invoice-1' });
    getDownloadUrl.mockResolvedValue({
      url: 'https://storage.example.test/signed',
      expiresAt: new Date('2026-10-22T13:00:00.000Z'),
      fileName: 'nfse-3.pdf',
      mimeType: 'application/pdf',
    });
    getPdf.mockResolvedValue(Buffer.from('pdf'));
  });

  it('returns a signed link by default, without fetching the PDF', async () => {
    await expect(handler({ access_key: 'k' }, ctx)).resolves.toEqual({
      access_key: 'k',
      download_url: 'https://storage.example.test/signed',
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
    expect(getPdf).not.toHaveBeenCalled();
  });

  it('keeps returning base64 with inline: true', async () => {
    await expect(
      handler({ access_key: 'k', inline: true }, ctx),
    ).resolves.toEqual({
      access_key: 'k',
      pdf_base64: Buffer.from('pdf').toString('base64'),
    });
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it('fails for an unknown access key', async () => {
    findByAccessKeyAndTenantId.mockResolvedValue(null);
    await expect(handler({ access_key: 'k' }, ctx)).rejects.toThrow(
      /not found/,
    );
  });
});
