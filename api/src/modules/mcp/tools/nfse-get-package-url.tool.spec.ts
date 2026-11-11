import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import {
  NFSE_GET_PACKAGE_URL_TOOL,
  createNfseGetPackageUrlHandler,
} from './nfse-get-package-url.tool';

const ctx = {
  activeTenantId: 'tenant-1',
  executionEnvironment: 'live',
} as AuthContext;

const summary = (count: number) => ({
  month: '2026-10',
  count,
  total: '10.00',
  limit: 500,
  companyName: 'Acme',
  companyTaxId: '11222333000181',
});

function handlerFor(count: number) {
  const findByTaxId = jest.fn().mockResolvedValue({ id: 'company-1' });
  const summaryFn = jest.fn().mockResolvedValue(summary(count));
  const create = jest.fn().mockReturnValue({
    token: 'tok',
    expiresAt: new Date('2026-11-08T11:00:00.000Z'),
  });
  const handler = createNfseGetPackageUrlHandler(
    { findByTaxId },
    { summary: summaryFn },
    { create, url: (token: string) => `https://api.example/${token}` },
  );
  return { handler, findByTaxId, summaryFn, create };
}

describe('nfse_get_package_url tool', () => {
  it('returns a temporary link scoped to the caller workspace', async () => {
    const { handler, findByTaxId, create } = handlerFor(12);
    await expect(
      handler({ tax_id: '11.222.333/0001-81', month: '2026-10' }, ctx),
    ).resolves.toEqual({
      month: '2026-10',
      note_count: 12,
      download_url: 'https://api.example/tok',
      expires_at: '2026-11-08T11:00:00.000Z',
      mime_type: 'application/zip',
    });
    expect(findByTaxId).toHaveBeenCalledWith(
      '11.222.333/0001-81',
      'tenant-1',
      'live',
    );
    expect(create).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      environment: 'live',
      month: '2026-10',
    });
  });

  it('rejects a malformed month before touching anything', async () => {
    const { handler, findByTaxId } = handlerFor(1);
    await expect(
      handler({ tax_id: '11222333000181', month: '2026-13' }, ctx),
    ).rejects.toThrow('Invalid input: month');
    expect(findByTaxId).not.toHaveBeenCalled();
  });

  it('refuses an empty month and one above the limit', async () => {
    await expect(
      handlerFor(0).handler({ tax_id: '1', month: '2026-10' }, ctx),
    ).rejects.toThrow('No authorized or cancelled notes');
    await expect(
      handlerFor(501).handler({ tax_id: '1', month: '2026-10' }, ctx),
    ).rejects.toThrow('at most 500');
  });

  it('documents the 7-day expiry', () => {
    expect(NFSE_GET_PACKAGE_URL_TOOL.description).toContain('7 days');
  });
});
