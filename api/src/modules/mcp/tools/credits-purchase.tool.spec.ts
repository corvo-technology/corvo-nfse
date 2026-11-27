import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import type { AuthContext } from '@/modules/auth/auth-context';
import { McpToolResult } from '../mcp.server';
import {
  CREDITS_PURCHASE_TOOL,
  createCreditsPurchaseHandler,
} from './credits-purchase.tool';

jest.setTimeout(30000);

const ctx = { activeTenantId: 'tenant-1', tenantId: 'tenant-1' } as AuthContext;
const pix = {
  method: 'pix',
  brCode: '00020126580014br.gov.bcb.pix0136test',
  qrCodeImage: null,
  paymentLinkUrl: 'https://woovi.test/pay/1',
  expiresAt: '2026-11-25T10:00:00.000Z',
  paymentId: 'pay-1',
};

function text(result: McpToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (first.type !== 'text') throw new Error('expected text');
  return JSON.parse(first.text) as Record<string, unknown>;
}

const firstCompany = (
  legalName = 'Escritório Silva Ltda',
  taxId = '11222333000181',
) => ({
  listPage: jest.fn().mockResolvedValue({
    data: [{ toSnapshot: () => ({ legalName, taxId }) }],
  }),
});

describe('credits_purchase', () => {
  it('starts an avulso Pix charge for the first company, with a tool-generated idempotency key', async () => {
    const start = jest.fn().mockResolvedValue(pix);
    await createCreditsPurchaseHandler({ start }, firstCompany())(
      { units: 50, method: 'pix' },
      ctx,
    );
    expect(start).toHaveBeenCalledWith(
      'tenant-1',
      {
        kind: 'avulso',
        units: 50,
        method: 'pix',
        customer: { name: 'Escritório Silva Ltda', taxID: '11222333000181' },
      },
      expect.stringMatching(/^mcp-[0-9a-f-]{36}$/),
    );
  });

  it('uses the tax_id and name given, without looking at companies', async () => {
    const start = jest.fn().mockResolvedValue(pix);
    const companies = firstCompany();
    await createCreditsPurchaseHandler({ start }, companies)(
      { units: 5, method: 'pix', tax_id: '529.982.247-25', name: 'Ana' },
      ctx,
    );
    expect(companies.listPage).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        customer: { name: 'Ana', taxID: '529.982.247-25' },
      }),
      expect.any(String),
    );
  });

  it('asks for a tax_id in Portuguese when Pix has no buyer and no company', async () => {
    const start = jest.fn();
    const none = { listPage: jest.fn().mockResolvedValue({ data: [] }) };
    await expect(
      createCreditsPurchaseHandler({ start }, none)(
        { units: 5, method: 'pix' },
        ctx,
      ),
    ).rejects.toThrow(/tax_id/);
    expect(start).not.toHaveBeenCalled();
  });

  it('card does not need a buyer', async () => {
    const start = jest
      .fn()
      .mockResolvedValue({ method: 'card', url: 'https://stripe.test/pay' });
    await createCreditsPurchaseHandler({ start }, firstCompany())(
      { units: 5, method: 'card' },
      ctx,
    );
    expect(start).toHaveBeenCalledWith(
      'tenant-1',
      { kind: 'avulso', units: 5, method: 'card' },
      expect.any(String),
    );
  });

  it('returns the copy-and-paste code, the payment link and a PNG QR image', async () => {
    const start = jest.fn().mockResolvedValue(pix);
    const result = await createCreditsPurchaseHandler(
      { start },
      firstCompany(),
    )({ units: 3, method: 'pix' }, ctx);
    expect(result).toBeInstanceOf(McpToolResult);
    expect(text(result)).toMatchObject({
      payment_id: 'pay-1',
      method: 'pix',
      units: 3,
      pix_copy_paste: pix.brCode,
      payment_link_url: pix.paymentLinkUrl,
      expires_at: pix.expiresAt,
      next_step: expect.stringContaining('payment_status'),
    });
    const image = result.content[1];
    expect(image.type).toBe('image');
    if (image.type !== 'image') return;
    expect(image.mimeType).toBe('image/png');
    const bytes = Buffer.from(image.data, 'base64');
    expect(bytes[0]).toBe(0x89);
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  });

  it('returns the payment link and no image when Pix has no copy-and-paste code', async () => {
    const start = jest.fn().mockResolvedValue({ ...pix, brCode: null });
    const result = await createCreditsPurchaseHandler(
      { start },
      firstCompany(),
    )({ units: 3, method: 'pix' }, ctx);
    expect(result.content).toHaveLength(1);
    expect(text(result).payment_link_url).toBe(pix.paymentLinkUrl);
  });

  it('returns the Stripe checkout url and session for card', async () => {
    const start = jest.fn().mockResolvedValue({
      method: 'card',
      url: 'https://stripe.test/pay',
      paymentId: 'pay-2',
      sessionId: 'cs_1',
    });
    const result = await createCreditsPurchaseHandler(
      { start },
      firstCompany(),
    )({ units: 10, method: 'card' }, ctx);
    expect(result.content).toHaveLength(1);
    expect(text(result)).toMatchObject({
      payment_id: 'pay-2',
      session_id: 'cs_1',
      method: 'card',
      checkout_url: 'https://stripe.test/pay',
    });
  });

  it('shows the price: 50 units cost 4950 cents and "R$ 49,50"', async () => {
    const start = jest.fn().mockResolvedValue(pix);
    const result = await createCreditsPurchaseHandler(
      { start },
      firstCompany(),
    )({ units: 50, method: 'pix' }, ctx);
    expect(text(result)).toMatchObject({
      amount_cents: 4950,
      amount: 'R$ 49,50',
    });
  });

  it('refuses fewer than 3 units without charging', async () => {
    const start = jest.fn();
    await expect(
      createCreditsPurchaseHandler({ start }, firstCompany())(
        { units: 2, method: 'pix' },
        ctx,
      ),
    ).rejects.toThrow(/Invalid input: units/);
    expect(start).not.toHaveBeenCalled();
  });

  it('explains when Pix is unavailable and suggests card', async () => {
    const start = jest.fn().mockRejectedValue(
      new ServiceUnavailableException({
        code: 'PIX_UNAVAILABLE',
        message: 'Pix payments are not enabled',
      }),
    );
    await expect(
      createCreditsPurchaseHandler({ start }, firstCompany())(
        { units: 5, method: 'pix' },
        ctx,
      ),
    ).rejects.toThrow(
      'Pix indisponível agora. Tente com cartão (method: card).',
    );
  });

  it('describes the unit price and asks the agent to confirm amount and quantity with the person', () => {
    expect(CREDITS_PURCHASE_TOOL.description).toContain('0.99');
    expect(CREDITS_PURCHASE_TOOL.description).toContain('confirm');
  });
});
