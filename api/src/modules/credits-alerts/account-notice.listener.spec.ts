import { AccountNoticeListener } from './account-notice.listener';
import { accountNotice } from '@/shared/events/account-notice.events';

function build(
  opts: { first?: boolean; admins?: string[]; all?: string[] } = {},
) {
  const recipients = {
    emailsFor: jest.fn().mockResolvedValue(opts.all ?? ['a@x.com', 'b@x.com']),
    adminEmailsFor: jest.fn().mockResolvedValue(opts.admins ?? ['a@x.com']),
  };
  const email = { enqueueNotice: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue('https://corvo.tech/app') };
  const locks = {
    acquire: jest.fn().mockResolvedValue(opts.first === false ? null : {}),
  };
  const listener = new AccountNoticeListener(
    recipients as never,
    email as never,
    config as never,
    locks as never,
  );
  return { listener, recipients, email };
}

describe('AccountNoticeListener', () => {
  it('tells admin and billing members about added credits', async () => {
    const { listener, email } = build();
    await listener.handle(
      accountNotice('t1', { kind: 'credits-added', units: 10 }),
    );
    expect(email.enqueueNotice).toHaveBeenCalledTimes(2);
    expect(email.enqueueNotice.mock.calls[0][1].subject).toBe(
      'Créditos adicionados',
    );
  });

  it('sends security notices to admins only', async () => {
    const { listener, email, recipients } = build();
    await listener.handle(
      accountNotice('t1', { kind: 'api-key-created', name: 'Prod' }),
    );
    expect(recipients.adminEmailsFor).toHaveBeenCalledWith('t1');
    expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
    expect(email.enqueueNotice.mock.calls[0][1].html).toContain('Prod');
  });

  it('warns about a rejected invoice once per hour', async () => {
    const first = build();
    await first.listener.handle(
      accountNotice('t1', {
        kind: 'invoice-rejected',
        invoiceId: 'i1',
        reason: 'CNPJ inválido',
      }),
    );
    expect(first.email.enqueueNotice).toHaveBeenCalled();
    expect(first.email.enqueueNotice.mock.calls[0][1].html).toContain(
      'invoices/i1',
    );

    const again = build({ first: false });
    await again.listener.handle(
      accountNotice('t1', {
        kind: 'invoice-rejected',
        invoiceId: 'i2',
        reason: 'x',
      }),
    );
    expect(again.email.enqueueNotice).not.toHaveBeenCalled();
  });

  it('does nothing when the workspace has no recipients', async () => {
    const { listener, email } = build({ admins: [] });
    await listener.handle(
      accountNotice('t1', { kind: 'mcp-connected', clientName: 'Claude' }),
    );
    expect(email.enqueueNotice).not.toHaveBeenCalled();
  });

  it('sends the new billing and certificate notices to the workspace recipients', async () => {
    const kinds = [
      { kind: 'credits-exhausted' },
      { kind: 'payment-failed' },
      { kind: 'subscription-canceled' },
      {
        kind: 'certificate-expiring',
        companyId: 'c1',
        companyName: 'Acme',
        stage: 7,
        validUntil: new Date('2026-12-01T12:00:00Z'),
      },
    ] as const;
    for (const notice of kinds) {
      const { listener, email } = build();
      await listener.handle(accountNotice('t1', notice));
      expect(email.enqueueNotice).toHaveBeenCalledTimes(2);
    }
  });

  it('does not repeat a notice inside its window', async () => {
    const { listener, email } = build({ first: false });
    await listener.handle(accountNotice('t1', { kind: 'credits-exhausted' }));
    await listener.handle(accountNotice('t1', { kind: 'payment-failed' }));
    expect(email.enqueueNotice).not.toHaveBeenCalled();
  });

  it('e-mails only the added member', async () => {
    const { listener, email, recipients } = build();
    await listener.handle(
      accountNotice('t1', {
        kind: 'member-added',
        email: 'new@x.com',
        role: 'billing',
      }),
    );
    expect(recipients.emailsFor).not.toHaveBeenCalled();
    expect(email.enqueueNotice).toHaveBeenCalledWith(
      'new@x.com',
      expect.objectContaining({
        subject: expect.stringContaining('adicionado'),
      }),
    );
  });
});
