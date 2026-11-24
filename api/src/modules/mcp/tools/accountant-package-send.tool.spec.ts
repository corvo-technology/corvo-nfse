import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import { createAccountantPackageSendHandler } from './accountant-package-send.tool';

const ctx = {
  activeTenantId: 'tenant-1',
  executionEnvironment: 'live',
} as unknown as AuthContext;
const companyId = '09947127-2702-4f6d-9da8-cb463608d812';

describe('accountant_package_send tool', () => {
  const findById = jest.fn();
  const findByTaxId = jest.fn();
  const getSettings = jest.fn();
  const sendNow = jest.fn();
  const summary = jest.fn();
  const handler = createAccountantPackageSendHandler(
    { findById, findByTaxId },
    { getSettings, sendNow },
    { summary },
  );
  beforeEach(() => {
    jest.resetAllMocks();
    findById.mockResolvedValue({ id: companyId });
    findByTaxId.mockResolvedValue({ id: companyId });
    getSettings.mockResolvedValue({
      email: 'contador@x.com',
      lastSentMonth: null,
    });
    summary.mockResolvedValue({ count: 7, limit: 500 });
    sendNow.mockResolvedValue('sent');
  });

  it('returns a preview and sends nothing without confirm', async () => {
    await expect(
      handler({ company_id: companyId, month: '2026-10' }, ctx),
    ).resolves.toMatchObject({
      sent: false,
      status: 'preview',
      month: '2026-10',
      recipient: 'contador@x.com',
      note_count: 7,
    });
    await handler(
      { company_id: companyId, month: '2026-10', confirm: false },
      ctx,
    );
    expect(sendNow).not.toHaveBeenCalled();
  });

  it('sends with confirm: true, finding the company by CNPJ', async () => {
    await expect(
      handler(
        { tax_id: '11222333000181', month: '2026-10', confirm: true },
        ctx,
      ),
    ).resolves.toMatchObject({
      sent: true,
      status: 'sent',
      recipient: 'contador@x.com',
    });
    expect(sendNow).toHaveBeenCalledWith(
      'tenant-1',
      companyId,
      'live',
      '2026-10',
      'mcp-or-api',
    );
  });

  it('explains a too-large month, in the preview and on send', async () => {
    summary.mockResolvedValue({ count: 612, limit: 500 });
    await expect(
      handler({ company_id: companyId, month: '2026-10' }, ctx),
    ).resolves.toMatchObject({
      status: 'preview',
      message: expect.stringContaining('download it in parts'),
    });
    sendNow.mockResolvedValue('skipped-too-large');
    await expect(
      handler({ company_id: companyId, month: '2026-10', confirm: true }, ctx),
    ).resolves.toMatchObject({
      sent: false,
      status: 'skipped-too-large',
      message: expect.stringContaining('more than 500 notes'),
    });
  });

  it('reports a skipped send as not sent', async () => {
    sendNow.mockResolvedValue('skipped-no-email');
    await expect(
      handler({ company_id: companyId, month: '2026-10', confirm: true }, ctx),
    ).resolves.toMatchObject({ sent: false, status: 'skipped-no-email' });
  });

  it('defaults to the previous month and validates input', async () => {
    const result = await handler({ company_id: companyId }, ctx);
    expect(result.month).toMatch(/^\d{4}-\d{2}$/);
    await expect(
      handler({ company_id: companyId, month: '2026-13' }, ctx),
    ).rejects.toThrow(/month/);
    await expect(handler({}, ctx)).rejects.toThrow(/Invalid input/);
  });

  it('fails when the company does not exist', async () => {
    findById.mockRejectedValue(new Error('Company not found'));
    await expect(
      handler({ company_id: companyId, confirm: true }, ctx),
    ).rejects.toThrow('Company not found');
    expect(sendNow).not.toHaveBeenCalled();
  });
});
