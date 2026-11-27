import { LifecycleEmailsService } from './lifecycle-emails.service';
import type { LifecycleEmailKind } from './infra/lifecycle-email.ledger';
import type {
  MonthSummary,
  PendingPurchase,
} from './infra/lifecycle-stats.repository';
import type { LiveInvoiceAuthorizedEvent } from '@/shared/events/live-invoice-authorized.events';
import { LIVE_INVOICE_AUTHORIZED } from '@/shared/events/live-invoice-authorized.events';

const tenantId = '3f2b6c1e-8a4d-4c55-9b0e-1d2f3a4b5c6d';
const now = new Date('2026-11-01T12:00:00Z'); // 09:00 in São Paulo

/** Ledger with the real rule: one row per tenant, kind and period. */
function fakeLedger(preset: Array<[LifecycleEmailKind, string, Date?]> = []) {
  const rows = new Map<string, Date>();
  for (const [kind, period, at] of preset)
    rows.set(`${kind}|${period}`, at ?? new Date(now.getTime() - 5_000));
  return {
    rows,
    claim: jest.fn(async (_t: string, kind: string, period: string) => {
      const key = `${kind}|${period}`;
      if (rows.has(key)) return false;
      rows.set(key, now);
      return true;
    }),
    release: jest.fn(async (_t: string, kind: string, period: string) => {
      rows.delete(`${kind}|${period}`);
    }),
    countSince: jest.fn(
      async (_t: string, since: Date) =>
        [...rows.values()].filter((at) => at >= since).length,
    ),
  };
}

const summary = (over: Partial<MonthSummary> = {}): MonthSummary => ({
  count: 12,
  totalCents: 345_000,
  topCustomers: ['Ana Silva', 'Beta Ltda', 'Casa Verde'],
  rejected: 2,
  mainCompany: { id: 'company-1', hasAccountant: false },
  ...over,
});

function build(
  options: {
    ledger?: ReturnType<typeof fakeLedger>;
    on?: boolean;
    owners?: string[];
    summary?: MonthSummary;
    earlier?: boolean;
    purchases?: PendingPurchase[];
    markerHeld?: boolean;
  } = {},
) {
  const ledger = options.ledger ?? fakeLedger();
  const settings = { isOn: jest.fn().mockReturnValue(options.on ?? true) };
  const stats = {
    hasEarlierLiveAuthorization: jest
      .fn()
      .mockResolvedValue(options.earlier ?? false),
    monthSummary: jest.fn().mockResolvedValue(options.summary ?? summary()),
    pendingPurchases: jest.fn().mockResolvedValue(options.purchases ?? []),
  };
  const recipients = {
    ownerEmailsFor: jest
      .fn()
      .mockResolvedValue(options.owners ?? ['dono@example.com']),
  };
  const usage = {
    status: jest
      .fn()
      .mockResolvedValue({ included_remaining: 30, avulsoBalance: 8 }),
  };
  const email = { enqueueNotice: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue('https://corvo.tech/app') };
  const marker = { key: 'k', token: 't', ttlMs: 1 };
  const locks = {
    acquire: jest.fn().mockResolvedValue(options.markerHeld ? null : marker),
    release: jest.fn().mockResolvedValue(true),
  };
  const service = new LifecycleEmailsService(
    settings as never,
    ledger as never,
    stats as never,
    recipients as never,
    usage as never,
    email as never,
    config as never,
    locks as never,
  );
  return {
    service,
    ledger,
    settings,
    stats,
    recipients,
    usage,
    email,
    locks,
    marker,
  };
}

const sent = (f: ReturnType<typeof build>) =>
  (
    f.email.enqueueNotice.mock.calls as unknown as Array<
      [string, { subject: string; html: string; text: string }]
    >
  ).map(([to, message]) => ({ to, ...message }));

const event = (
  over: Partial<LiveInvoiceAuthorizedEvent> = {},
): LiveInvoiceAuthorizedEvent => ({
  name: LIVE_INVOICE_AUTHORIZED,
  tenantId,
  invoiceId: 'inv-1',
  authorizedAt: now,
  customerEmailed: true,
  ...over,
});

describe('LifecycleEmailsService: first invoice', () => {
  it('congratulates the owner on the first live invoice', async () => {
    const f = build();
    await expect(f.service.onLiveInvoiceAuthorized(event())).resolves.toBe(
      'sent',
    );
    const [mail] = sent(f);
    expect(mail.to).toBe('dono@example.com');
    expect(mail.subject).toBe('Sua primeira nota fiscal saiu');
    expect(mail.html).toContain('https://corvo.tech/app/integrations');
    expect(mail.text).toContain('enviada por e-mail ao seu cliente');
    expect(f.recipients.ownerEmailsFor).toHaveBeenCalledWith(tenantId);
    expect(f.ledger.rows.has('first-invoice|once')).toBe(true);
  });

  it('says the PDF is on the invoice page when the customer is not e-mailed', async () => {
    const f = build();
    await f.service.onLiveInvoiceAuthorized(event({ customerEmailed: false }));
    expect(sent(f)[0].text).toContain('baixar o PDF e o XML');
  });

  it('does nothing when an earlier live invoice was authorized', async () => {
    const f = build({ earlier: true });
    await expect(f.service.onLiveInvoiceAuthorized(event())).resolves.toBe(
      'nothing-to-report',
    );
    expect(f.email.enqueueNotice).not.toHaveBeenCalled();
    expect(f.ledger.claim).not.toHaveBeenCalled();
    expect(f.locks.release).not.toHaveBeenCalled();
  });

  it('does not even look at the database once the marker says it was handled', async () => {
    const f = build({ markerHeld: true });
    await expect(f.service.onLiveInvoiceAuthorized(event())).resolves.toBe(
      'already-sent',
    );
    expect(f.stats.hasEarlierLiveAuthorization).not.toHaveBeenCalled();
  });

  it('never sends twice, even if the marker is lost', async () => {
    const f = build();
    await f.service.onLiveInvoiceAuthorized(event());
    // A second worker with no marker and a race on the same first invoice.
    await expect(f.service.onLiveInvoiceAuthorized(event())).resolves.toBe(
      'already-sent',
    );
    expect(f.email.enqueueNotice).toHaveBeenCalledTimes(1);
  });

  it('is off when its switch is off', async () => {
    const f = build({ on: false });
    await expect(f.service.onLiveInvoiceAuthorized(event())).resolves.toBe(
      'off',
    );
    expect(f.settings.isOn).toHaveBeenCalledWith('firstInvoice');
    expect(f.email.enqueueNotice).not.toHaveBeenCalled();
  });

  it('holds back when another lifecycle e-mail already went out today', async () => {
    const f = build({
      ledger: fakeLedger([['payment-pending', 'p1', new Date()]]),
    });
    await expect(f.service.onLiveInvoiceAuthorized(event())).resolves.toBe(
      'daily-limit',
    );
    expect(f.email.enqueueNotice).not.toHaveBeenCalled();
  });

  it('gives the claim and the marker back when the e-mail cannot be queued', async () => {
    const f = build();
    f.email.enqueueNotice.mockRejectedValueOnce(new Error('redis down'));
    await expect(f.service.onLiveInvoiceAuthorized(event())).resolves.toBe(
      'failed',
    );
    expect(f.ledger.rows.size).toBe(0);
    expect(f.locks.release).toHaveBeenCalledWith(f.marker);
    await expect(f.service.onLiveInvoiceAuthorized(event())).resolves.toBe(
      'sent',
    );
  });

  it('keeps quiet and tries again later when there is nobody to tell', async () => {
    const f = build({ owners: [] });
    await expect(f.service.onLiveInvoiceAuthorized(event())).resolves.toBe(
      'no-recipients',
    );
    expect(f.ledger.rows.size).toBe(0);
    expect(f.locks.release).toHaveBeenCalled();
  });

  it('never throws into the invoice flow', async () => {
    const f = build();
    f.stats.hasEarlierLiveAuthorization.mockRejectedValue(new Error('db'));
    await expect(f.service.onLiveInvoiceAuthorized(event())).resolves.toBe(
      'failed',
    );
  });
});

describe('LifecycleEmailsService: monthly summary', () => {
  it('sends the summary of the month that ended to the owner', async () => {
    const f = build();
    await expect(f.service.sendMonthlySummary(tenantId, now)).resolves.toBe(
      'sent',
    );
    const [mail] = sent(f);
    expect(mail.subject).toBe('Resumo de outubro de 2026: 12 notas emitidas');
    expect(mail.text).toContain('somando R$');
    expect(mail.text).toContain('Ana Silva, Beta Ltda, Casa Verde');
    expect(mail.text).toContain('2 notas foram rejeitadas');
    expect(mail.text).toContain('Ainda restam 38 notas');
    expect(mail.html).toContain('Cadastrar contador');
    expect(mail.html).toContain('https://corvo.tech/app/companies/company-1');
    expect(f.ledger.rows.has('monthly-summary|2026-10')).toBe(true);
    const [, start, end] = f.stats.monthSummary.mock.calls[0] as [
      string,
      Date,
      Date,
    ];
    expect(start.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('offers to send to the accountant when the company has one', async () => {
    const f = build({
      summary: summary({
        mainCompany: { id: 'company-1', hasAccountant: true },
      }),
    });
    await f.service.sendMonthlySummary(tenantId, now);
    expect(sent(f)[0].html).toContain('Enviar ao contador');
  });

  it('sends nothing when no live invoice was issued in the month', async () => {
    const f = build({ summary: summary({ count: 0 }) });
    await expect(f.service.sendMonthlySummary(tenantId, now)).resolves.toBe(
      'nothing-to-report',
    );
    expect(f.email.enqueueNotice).not.toHaveBeenCalled();
    expect(f.ledger.rows.size).toBe(0);
  });

  it('is idempotent for the same workspace and month', async () => {
    const f = build();
    await f.service.sendMonthlySummary(tenantId, now);
    const nextDay = new Date(now.getTime() + 24 * 3_600_000);
    await expect(f.service.sendMonthlySummary(tenantId, nextDay)).resolves.toBe(
      'already-sent',
    );
    expect(f.email.enqueueNotice).toHaveBeenCalledTimes(1);
  });

  it('counts the month before the run, also in January', async () => {
    const f = build();
    await f.service.sendMonthlySummary(
      tenantId,
      new Date('2027-01-01T12:00:00Z'),
    );
    expect(f.ledger.rows.has('monthly-summary|2026-12')).toBe(true);
  });

  it('holds back when another lifecycle e-mail went out today', async () => {
    const f = build({ ledger: fakeLedger([['first-invoice', 'once']]) });
    await expect(f.service.sendMonthlySummary(tenantId, now)).resolves.toBe(
      'daily-limit',
    );
    expect(f.stats.monthSummary).not.toHaveBeenCalled();
  });

  it('sends the next day an e-mail that the daily limit held back', async () => {
    const yesterday = new Date(now.getTime() - 24 * 3_600_000);
    const f = build({
      ledger: fakeLedger([['first-invoice', 'once', yesterday]]),
    });
    await expect(f.service.sendMonthlySummary(tenantId, now)).resolves.toBe(
      'sent',
    );
  });

  it('is off when its switch is off', async () => {
    const f = build({ on: false });
    await expect(f.service.sendMonthlySummary(tenantId, now)).resolves.toBe(
      'off',
    );
    expect(f.settings.isOn).toHaveBeenCalledWith('monthlySummary');
    expect(f.stats.monthSummary).not.toHaveBeenCalled();
  });

  it('gives the claim back when the e-mail cannot be queued, so the next run retries', async () => {
    const f = build();
    f.email.enqueueNotice.mockRejectedValueOnce(new Error('redis down'));
    await expect(f.service.sendMonthlySummary(tenantId, now)).resolves.toBe(
      'failed',
    );
    expect(f.ledger.rows.size).toBe(0);
    await expect(f.service.sendMonthlySummary(tenantId, now)).resolves.toBe(
      'sent',
    );
  });

  it('writes no customer name or address in the logs', async () => {
    const f = build();
    const log = jest.spyOn(
      (f.service as unknown as { logger: { log: () => void } }).logger,
      'log',
    );
    await f.service.sendMonthlySummary(tenantId, now);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /Ana Silva|dono@example/,
    );
  });
});

describe('LifecycleEmailsService: pending payment', () => {
  const purchase = (
    id: string,
    over: Partial<PendingPurchase> = {},
  ): PendingPurchase => ({
    id,
    kind: 'avulso',
    units: 50,
    createdAt: new Date(now.getTime() - 30 * 3_600_000),
    ...over,
  });

  it('asks the stats for checkouts between 24 and 72 hours old', async () => {
    const f = build();
    await f.service.sendPaymentReminder(tenantId, now);
    const [, from, until] = f.stats.pendingPurchases.mock.calls[0] as [
      string,
      Date,
      Date,
    ];
    expect(now.getTime() - from.getTime()).toBe(72 * 3_600_000);
    expect(now.getTime() - until.getTime()).toBe(24 * 3_600_000);
  });

  it('reminds once about an unpaid purchase', async () => {
    const f = build({ purchases: [purchase('p1')] });
    await expect(f.service.sendPaymentReminder(tenantId, now)).resolves.toBe(
      'sent',
    );
    const [mail] = sent(f);
    expect(mail.subject).toBe('Seu pagamento ficou pendente');
    expect(mail.text).toContain('comprar 50 notas');
    expect(mail.html).toContain('https://corvo.tech/app/billing');
    expect(f.ledger.rows.has('payment-pending|p1')).toBe(true);
  });

  it('names a subscription when the purchase was a plan', async () => {
    const f = build({
      purchases: [purchase('p1', { kind: 'plan', units: null })],
    });
    await f.service.sendPaymentReminder(tenantId, now);
    expect(sent(f)[0].text).toContain('uma assinatura do Corvo');
  });

  it('never reminds twice about the same purchase', async () => {
    const f = build({ purchases: [purchase('p1')] });
    await f.service.sendPaymentReminder(tenantId, now);
    const later = new Date(now.getTime() + 2 * 24 * 3_600_000);
    await expect(f.service.sendPaymentReminder(tenantId, later)).resolves.toBe(
      'nothing-to-report',
    );
    expect(f.email.enqueueNotice).toHaveBeenCalledTimes(1);
  });

  it('mentions only the newest purchase and counts the older ones as reminded', async () => {
    const f = build({ purchases: [purchase('new'), purchase('old')] });
    await f.service.sendPaymentReminder(tenantId, now);
    expect(f.email.enqueueNotice).toHaveBeenCalledTimes(1);
    expect(f.ledger.rows.has('payment-pending|old')).toBe(true);
  });

  it('moves on to an older purchase when the newest was already reminded', async () => {
    const f = build({
      ledger: fakeLedger([
        [
          'payment-pending',
          'new',
          new Date(now.getTime() - 3 * 24 * 3_600_000),
        ],
      ]),
      purchases: [purchase('new'), purchase('old')],
    });
    await expect(f.service.sendPaymentReminder(tenantId, now)).resolves.toBe(
      'sent',
    );
    expect(f.ledger.rows.has('payment-pending|old')).toBe(true);
  });

  it('sends nothing when there is no unpaid purchase', async () => {
    const f = build();
    await expect(f.service.sendPaymentReminder(tenantId, now)).resolves.toBe(
      'nothing-to-report',
    );
    expect(f.email.enqueueNotice).not.toHaveBeenCalled();
  });

  it('waits for the next day when another lifecycle e-mail went out today', async () => {
    const f = build({
      ledger: fakeLedger([['monthly-summary', '2026-10']]),
      purchases: [purchase('p1')],
    });
    await expect(f.service.sendPaymentReminder(tenantId, now)).resolves.toBe(
      'daily-limit',
    );
    expect(f.ledger.rows.has('payment-pending|p1')).toBe(false);
  });

  it('is off when its switch is off', async () => {
    const f = build({ on: false, purchases: [purchase('p1')] });
    await expect(f.service.sendPaymentReminder(tenantId, now)).resolves.toBe(
      'off',
    );
    expect(f.settings.isOn).toHaveBeenCalledWith('pendingPayment');
    expect(f.stats.pendingPurchases).not.toHaveBeenCalled();
  });
});
