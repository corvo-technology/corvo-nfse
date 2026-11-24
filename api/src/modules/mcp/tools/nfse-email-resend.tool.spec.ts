import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import { createNfseEmailResendHandler } from './nfse-email-resend.tool';

const ctx = {
  activeTenantId: 'tenant-1',
  executionEnvironment: 'test',
} as unknown as AuthContext;
const invoiceId = '09947127-2702-4f6d-9da8-cb463608d812';

describe('nfse_email_resend tool', () => {
  const requestEmail = jest.fn();
  beforeEach(() => {
    jest.resetAllMocks();
    requestEmail.mockResolvedValue({ emailId: 'mail-1', status: 'queued' });
  });

  it('requests the email in the caller tenant, with an optional destination', async () => {
    await expect(
      createNfseEmailResendHandler({ requestEmail })(
        { invoice_id: invoiceId, email: ' dest@x.com ' },
        ctx,
      ),
    ).resolves.toEqual({
      invoice_id: invoiceId,
      email_id: 'mail-1',
      status: 'queued',
    });
    expect(requestEmail).toHaveBeenCalledWith(
      invoiceId,
      'tenant-1',
      undefined,
      'test',
      'dest@x.com',
    );
  });

  it('rejects an invalid email or id before sending', async () => {
    const handler = createNfseEmailResendHandler({ requestEmail });
    await expect(
      handler({ invoice_id: invoiceId, email: 'nope' }, ctx),
    ).rejects.toThrow(/email/);
    await expect(handler({ invoice_id: 'abc' }, ctx)).rejects.toThrow(
      /invoice_id/,
    );
    expect(requestEmail).not.toHaveBeenCalled();
  });

  it('passes through the service error for a missing invoice', async () => {
    requestEmail.mockRejectedValue(new Error('Invoice not found'));
    await expect(
      createNfseEmailResendHandler({ requestEmail })(
        { invoice_id: invoiceId },
        ctx,
      ),
    ).rejects.toThrow('Invoice not found');
  });
});
