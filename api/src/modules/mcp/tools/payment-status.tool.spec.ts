import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import { createPaymentStatusHandler } from './payment-status.tool';

const ctx = { activeTenantId: 'tenant-1' } as AuthContext;
const ID = '4a6f2f4e-0d3b-4a54-9a2a-0b9f3a1b2c3d';

function setup(view: unknown = null) {
  const pix = { paymentStatus: jest.fn().mockResolvedValue(view) };
  const billing = { checkoutStatus: jest.fn() };
  const usage = {
    status: jest.fn().mockResolvedValue({
      blocked: false,
      included_remaining: 2,
      avulsoBalance: 50,
    }),
  };
  const handler = createPaymentStatusHandler(pix, billing, usage);
  return { handler, pix, billing, usage };
}

const view = (status: string) => ({
  id: ID,
  status,
  kind: 'avulso',
  units: 50,
  plan_slug: null,
  paid_at: status === 'paid' ? '2026-11-24T12:00:00.000Z' : null,
});

describe('payment_status', () => {
  it('maps pending, paid, expired and failed', async () => {
    for (const [from, to] of [
      ['pending', 'pending'],
      ['paid', 'paid'],
      ['expired', 'expired'],
      ['failed', 'cancelled'],
    ]) {
      const f = setup(view(from));
      await expect(f.handler({ payment_id: ID }, ctx)).resolves.toMatchObject({
        payment_id: ID,
        status: to,
        units: 50,
      });
    }
  });

  it('returns the new credit balance once paid', async () => {
    const f = setup(view('paid'));
    const out = await f.handler({ payment_id: ID }, ctx);
    expect(out.balance).toBe(52);
    expect(out.paid_at).toBe('2026-11-24T12:00:00.000Z');
    const pending = setup(view('pending'));
    expect(
      (await pending.handler({ payment_id: ID }, ctx)).balance,
    ).toBeUndefined();
  });

  it('answers "pagamento não encontrado" for an unknown or foreign id', async () => {
    const f = setup(null);
    const call = f.handler({ payment_id: ID }, ctx);
    await expect(call).rejects.toThrow('Pagamento não encontrado');
    await expect(call).rejects.not.toThrow(ID);
    expect(f.pix.paymentStatus).toHaveBeenCalledWith('tenant-1', ID);
  });

  it('accepts session_id for card and maps activated to paid', async () => {
    const f = setup();
    f.billing.checkoutStatus.mockResolvedValue({
      session_id: 'cs_1',
      status: 'complete',
      payment_status: 'paid',
      activated: true,
    });
    await expect(f.handler({ session_id: 'cs_1' }, ctx)).resolves.toMatchObject(
      { status: 'paid', balance: 52 },
    );
    f.billing.checkoutStatus.mockResolvedValue({
      session_id: 'cs_1',
      status: 'expired',
      payment_status: 'unpaid',
      activated: false,
    });
    await expect(f.handler({ session_id: 'cs_1' }, ctx)).resolves.toMatchObject(
      { status: 'expired' },
    );
    f.billing.checkoutStatus.mockResolvedValue({
      session_id: 'cs_1',
      status: 'open',
      payment_status: 'unpaid',
      activated: false,
    });
    await expect(f.handler({ session_id: 'cs_1' }, ctx)).resolves.toMatchObject(
      { status: 'pending' },
    );
  });

  it('answers not found for a foreign session', async () => {
    const f = setup();
    f.billing.checkoutStatus.mockRejectedValue(
      Object.assign(new Error('Checkout not found'), {
        code: 'checkout_not_found',
      }),
    );
    await expect(f.handler({ session_id: 'cs_x' }, ctx)).rejects.toThrow(
      'Pagamento não encontrado',
    );
  });

  it('requires exactly one of payment_id or session_id', async () => {
    const f = setup(view('paid'));
    await expect(f.handler({}, ctx)).rejects.toThrow(/exactly one/);
    await expect(
      f.handler({ payment_id: ID, session_id: 'cs_1' }, ctx),
    ).rejects.toThrow(/exactly one/);
  });
});
