import { AccountNoticeListener } from './account-notice.listener';
import {
  runAsPlatformAdminOnTenant,
  getDatabaseScope,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { accountNotice } from '@/shared/events/account-notice.events';

function build(
  opts: {
    first?: boolean;
    admins?: string[];
    all?: string[];
    rejectionHelp?: boolean;
  } = {},
) {
  const recipients = {
    emailsFor: jest.fn().mockResolvedValue(opts.all ?? ['a@x.com', 'b@x.com']),
    adminEmailsFor: jest.fn().mockResolvedValue(opts.admins ?? ['a@x.com']),
    ownerEmailsFor: jest.fn().mockResolvedValue(['owner@x.com']),
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
    { isOn: jest.fn().mockReturnValue(opts.rejectionHelp ?? true) } as never,
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
    expect(
      (
        email.enqueueNotice.mock.calls as unknown as Array<
          [unknown, { subject: string }]
        >
      )[0][1].subject,
    ).toBe('Créditos adicionados');
  });

  it('sends security notices to admins only', async () => {
    const { listener, email, recipients } = build();
    await listener.handle(
      accountNotice('t1', { kind: 'api-key-created', name: 'Prod' }),
    );
    expect(recipients.adminEmailsFor).toHaveBeenCalledWith('t1');
    expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
    expect(
      (
        email.enqueueNotice.mock.calls as unknown as Array<
          [unknown, { html: string }]
        >
      )[0][1].html,
    ).toContain('Prod');
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
    expect(
      (
        first.email.enqueueNotice.mock.calls as unknown as Array<
          [unknown, { html: string }]
        >
      )[0][1].html,
    ).toContain('invoices/i1');

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

  it('explains a rejection in plain words and links back to the invoice', async () => {
    const f = build();
    await f.listener.handle(
      accountNotice('t1', {
        kind: 'invoice-rejected',
        invoiceId: 'i1',
        reason:
          'Rejeição da Receita [E0120]: IM do prestador não deve ser informado',
        errorCode: 'E0120',
      }),
    );
    const [, message] = (
      f.email.enqueueNotice.mock.calls as unknown as Array<
        [string, { subject: string; html: string; text: string }]
      >
    )[0];
    expect(message.subject).toBe('Uma nota foi rejeitada');
    expect(message.text).toContain('Inscrição Municipal');
    expect(message.text).not.toContain('IM do prestador');
    expect(message.html).toContain('Corrigir e emitir de novo');
    expect(message.html).toContain('https://corvo.tech/app/invoices/i1');
  });

  it('keeps the old rejection e-mail when its switch is off', async () => {
    const f = build({ rejectionHelp: false });
    await f.listener.handle(
      accountNotice('t1', {
        kind: 'invoice-rejected',
        invoiceId: 'i1',
        reason: 'CNPJ inválido',
        errorCode: 'E0120',
      }),
    );
    const [, message] = (
      f.email.enqueueNotice.mock.calls as unknown as Array<
        [string, { html: string }]
      >
    )[0];
    expect(message.html).toContain('Motivo: CNPJ inválido');
    expect(message.html).toContain('Revisar nota');
  });

  it('tells the workspace what the portal registered about an invoice, once per invoice', async () => {
    const notices = [
      {
        kind: 'invoice-cancelled-on-portal',
        invoiceId: 'i9',
        nfseNumber: 42,
        reason: 'Erro de digitação',
      },
      {
        kind: 'invoice-rejected-by-taker',
        invoiceId: 'i9',
        nfseNumber: null,
        reason: null,
      },
      { kind: 'invoice-blocked-on-portal', invoiceId: 'i9', nfseNumber: 42 },
    ] as const;
    for (const notice of notices) {
      const { listener, email } = build();
      await listener.handle(accountNotice('t1', notice));
      expect(email.enqueueNotice).toHaveBeenCalledTimes(2);
      expect(
        (
          email.enqueueNotice.mock.calls as unknown as Array<
            [unknown, { html: string }]
          >
        )[0][1].html,
      ).toContain('invoices/i9');
      const again = build({ first: false });
      await again.listener.handle(accountNotice('t1', notice));
      expect(again.email.enqueueNotice).not.toHaveBeenCalled();
    }
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

  it('warns the workspace when the accountant package could not be sent', async () => {
    const { listener, email } = build();
    await listener.handle(
      accountNotice('t1', {
        kind: 'accountant-package-failed',
        companyId: 'c1',
        companyName: 'Acme',
        month: '2026-10',
      }),
    );
    expect(email.enqueueNotice).toHaveBeenCalledTimes(2);
  });

  it('tells only the owner when the accountant package was not sent for lack of notes or size, once per month', async () => {
    const { listener, email, recipients } = build();
    await listener.handle(
      accountNotice('t1', {
        kind: 'accountant-package-empty',
        companyId: 'c1',
        companyName: 'Acme',
        month: '2026-10',
      }),
    );
    await listener.handle(
      accountNotice('t1', {
        kind: 'accountant-package-too-large',
        companyId: 'c1',
        companyName: 'Acme',
        month: '2026-10',
        count: 700,
        limit: 500,
      }),
    );
    expect(recipients.ownerEmailsFor).toHaveBeenCalledTimes(2);
    expect(email.enqueueNotice).toHaveBeenCalledTimes(2);
    const [to, message] = email.enqueueNotice.mock.calls[0] as [
      string,
      { text: string },
    ];
    expect(to).toBe('owner@x.com');
    expect(message.text).toContain('não houve notas no mês');
  });

  it('does not repeat the empty-month notice', async () => {
    const { listener, email } = build({ first: false });
    await listener.handle(
      accountNotice('t1', {
        kind: 'accountant-package-empty',
        companyId: 'c1',
        companyName: 'Acme',
        month: '2026-10',
      }),
    );
    expect(email.enqueueNotice).not.toHaveBeenCalled();
  });

  it('does not repeat a notice inside its window', async () => {
    const { listener, email } = build({ first: false });
    await listener.handle(accountNotice('t1', { kind: 'credits-exhausted' }));
    await listener.handle(accountNotice('t1', { kind: 'payment-failed' }));
    expect(email.enqueueNotice).not.toHaveBeenCalled();
  });

  it('tells the owner when a webhook gave up, with a link and no private data', async () => {
    const { listener, email, recipients } = build();
    await listener.handle(
      accountNotice('t1', {
        kind: 'webhook-delivery-failed',
        webhookConfigId: 'w1',
        eventType: 'nfse.invoice.authorized',
      }),
    );
    expect(recipients.ownerEmailsFor).toHaveBeenCalledWith('t1');
    expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
    const [to, message] = email.enqueueNotice.mock.calls[0] as unknown as [
      string,
      { subject: string; html: string; text: string },
    ];
    expect(to).toBe('owner@x.com');
    expect(message.html).toContain('https://corvo.tech/app/webhooks');
    expect(message.html).toContain('nfse.invoice.authorized');
    expect(message.text).not.toMatch(/secret|signature|payload/i);
  });

  it('warns about the same webhook at most once an hour', async () => {
    const { listener, email } = build({ first: false });
    await listener.handle(
      accountNotice('t1', {
        kind: 'webhook-delivery-failed',
        webhookConfigId: 'w1',
        eventType: 'nfse.invoice.authorized',
      }),
    );
    expect(email.enqueueNotice).not.toHaveBeenCalled();
  });

  it('sends the invitation only to the invited address, with the token in the link fragment', async () => {
    const { listener, email, recipients } = build();
    await listener.handle(
      accountNotice('t1', {
        kind: 'member-invited',
        email: 'new@x.com',
        name: 'Maria <b>Silva</b>',
        role: 'billing',
        token: 'tok_123',
        inviterName: 'Ana',
      }),
    );
    expect(recipients.emailsFor).not.toHaveBeenCalled();
    expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
    const [to, message] = email.enqueueNotice.mock.calls[0] as unknown as [
      string,
      { subject: string; html: string },
    ];
    expect(to).toBe('new@x.com');
    expect(message.subject).toContain('Convite');
    expect(message.html).toContain(
      'https://corvo.tech/accept-invite#token=tok_123',
    );
    expect(message.html).not.toContain('accept-invite?token');
    // The invitee is greeted by the name the admin typed, and it cannot inject markup.
    expect(message.html).toContain('Olá, Maria &lt;b&gt;Silva&lt;/b&gt;.');
    expect(message.html).not.toContain('<b>Silva</b>');
  });

  it('tells only the main admin that the invite was accepted', async () => {
    const { listener, email, recipients } = build();
    await listener.handle(
      accountNotice('t1', {
        kind: 'member-joined',
        name: 'Maria',
        email: 'maria@x.com',
        role: 'developer',
      }),
    );
    expect(recipients.ownerEmailsFor).toHaveBeenCalledWith('t1');
    expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
    const [to, message] = email.enqueueNotice.mock.calls[0] as unknown as [
      string,
      { subject: string; html: string },
    ];
    expect(to).toBe('owner@x.com');
    expect(message.html).toContain('Maria');
    expect(message.html).toContain('já tem acesso');
  });

  it("delivers a notice emitted from another tenant's request scope (platform admin grant)", async () => {
    const { listener, email, recipients } = build();
    let seen: string | undefined;
    recipients.emailsFor.mockImplementation(() => {
      seen = getDatabaseScope()?.tenantId;
      return Promise.resolve(['a@x.com']);
    });
    await runAsPlatformAdminOnTenant(
      '11111111-1111-4111-8111-111111111111',
      () =>
        listener.onNotice(
          accountNotice('22222222-2222-4222-8222-222222222222', {
            kind: 'credits-added',
            units: 10,
          }),
        ),
    );
    expect(seen).toBe('22222222-2222-4222-8222-222222222222');
    expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
  });

  it('logs and skips instead of throwing when the notice cannot be handled', async () => {
    const { listener, recipients } = build();
    recipients.emailsFor.mockRejectedValue(new Error('tenant gone'));
    await expect(
      listener.onNotice(
        accountNotice('22222222-2222-4222-8222-222222222222', {
          kind: 'credits-added',
          units: 10,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  describe('integration sale waiting for the client', () => {
    const sale = (operationId: string, pendingCount = 1) =>
      accountNotice('t1', {
        kind: 'integration-sale-needs-attention',
        operationId,
        connectionId: 'c1',
        provider: 'woovi',
        amountCents: 990,
        paidAt: new Date('2026-11-26T15:00:00Z'),
        buyerName: 'ACME LTDA',
        reason: 'customer_tax_id_missing',
        pendingCount,
      });
    const withMemoryLocks = () => {
      const made = build();
      const taken = new Set<string>();
      const locks = {
        acquire: jest.fn((key: string) => {
          if (taken.has(key)) return Promise.resolve(null);
          taken.add(key);
          return Promise.resolve({});
        }),
      };
      const listener = new AccountNoticeListener(
        {
          emailsFor: jest.fn(),
          ownerEmailsFor: jest.fn().mockResolvedValue(['owner@x.com']),
        } as never,
        made.email as never,
        { get: jest.fn().mockReturnValue('https://corvo.tech/app') } as never,
        locks as never,
      );
      return { listener, email: made.email };
    };
    const sent = (email: { enqueueNotice: jest.Mock }) =>
      email.enqueueNotice.mock.calls as unknown as Array<
        [string, { subject: string; html: string; text: string }]
      >;

    it('tells the owner platform, amount, date, buyer, plain reason and a button to the sale', async () => {
      const { listener, email } = withMemoryLocks();
      await listener.handle(sale('op1'));
      const [to, message] = sent(email)[0];
      expect(to).toBe('owner@x.com');
      expect(message.text).toContain('Woovi');
      expect(message.text).toContain('R$');
      expect(message.text).toContain('26/11/2026');
      expect(message.text).toContain('ACME LTDA');
      expect(message.text).toContain('Falta o CPF ou CNPJ do cliente');
      expect(message.html).toContain('app/integrations/sales/op1');
    });

    it('sends one notice per sale, however many times it is announced', async () => {
      const { listener, email } = withMemoryLocks();
      await listener.handle(sale('op1'));
      await listener.handle(sale('op1'));
      expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
    });

    it('after 5 sales in a day sends a single summary and then stays quiet', async () => {
      const { listener, email } = withMemoryLocks();
      for (let n = 1; n <= 8; n++) await listener.handle(sale(`op${n}`, n));
      const subjects = sent(email).map(([, m]) => m.subject);
      expect(subjects).toHaveLength(6);
      expect(subjects[5]).toBe('Vendas esperando você para virar nota');
    });
  });
});
