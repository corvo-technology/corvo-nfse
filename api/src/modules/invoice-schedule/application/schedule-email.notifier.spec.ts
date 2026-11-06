import { InvoiceSchedule } from '../domain/invoice-schedule';
import { ScheduleEmailNotifier } from './schedule-email.notifier';

const NOW = new Date('2026-11-06T15:00:00Z');
const TENANT = '11111111-1111-4111-8111-111111111111';

function schedule(
  over: { companyId?: string; invoiceInput?: Record<string, unknown> } = {},
) {
  return InvoiceSchedule.create(
    {
      tenantId: TENANT,
      environment: 'live',
      companyId: over.companyId ?? 'c1',
      kind: 'recurring',
      frequency: 'WEEKLY',
      firstOn: '2026-11-09',
      endsOn: null,
      invoiceInput: over.invoiceInput ?? { amount: 150 },
      createdBy: null,
    },
    NOW,
    15,
  );
}
const item = (
  s: InvoiceSchedule,
  code = 'ERROR_QUOTA_EXCEEDED',
  reason = 'Plan quota exceeded',
) => ({ schedule: s, code, reason });
const brl = (value: string) => value.replace(/[\u00a0]/g, ' ');

function build(
  recipients: string[] = ['admin@example.com', 'billing@example.com'],
) {
  const email = {
    enqueueScheduleRetry: jest.fn().mockResolvedValue(undefined),
    enqueueSchedulePaused: jest.fn().mockResolvedValue(undefined),
  };
  const companies = {
    findById: jest.fn((id: string) =>
      id === 'gone'
        ? Promise.reject(new Error('not found'))
        : Promise.resolve({
            legalName: id === 'c1' ? 'Acme Ltda' : 'Beta ME',
            tradeName: undefined,
          }),
    ),
  };
  const notifier = new ScheduleEmailNotifier(
    { emailsFor: jest.fn().mockResolvedValue(recipients) } as never,
    email as never,
    companies as never,
  );
  return { notifier, email, companies };
}

describe('ScheduleEmailNotifier.retryNotice', () => {
  it('sends one e-mail per recipient listing every failed schedule of the workspace', async () => {
    const { notifier, email } = build();
    await notifier.retryNotice(TENANT, [
      item(schedule({ companyId: 'c1', invoiceInput: { amount: 150 } })),
      item(schedule({ companyId: 'c2', invoiceInput: { amount: 90.5 } })),
    ]);
    expect(email.enqueueScheduleRetry).toHaveBeenCalledTimes(2);
    const [first] = email.enqueueScheduleRetry.mock.calls[0] as [
      Record<string, string | number>,
    ];
    expect(first).toMatchObject({ to: 'admin@example.com', count: 2 });
    expect(brl(String(first.schedules))).toBe(
      'Acme Ltda (R$ 150,00); Beta ME (R$ 90,50)',
    );
  });

  it('explains a credit failure in plain words', async () => {
    const { notifier, email } = build();
    await notifier.retryNotice(TENANT, [item(schedule())]);
    const [sent] = email.enqueueScheduleRetry.mock.calls[0] as [
      { reason: string },
    ];
    expect(sent.reason).toMatch(/notas disponíveis/);
  });

  it('other failures carry the refusal message, once per distinct reason', async () => {
    const { notifier, email } = build();
    await notifier.retryNotice(TENANT, [
      item(schedule(), 'ERROR_VALIDATION', 'Request validation failed'),
      item(schedule(), 'ERROR_VALIDATION', 'Request validation failed'),
    ]);
    const [sent] = email.enqueueScheduleRetry.mock.calls[0] as [
      { reason: string },
    ];
    expect(sent.reason).toBe('Request validation failed');
  });

  it('a schedule whose total comes from itemized services still shows its amount', async () => {
    const { notifier, email } = build(['a@example.com']);
    await notifier.retryNotice(TENANT, [
      item(
        schedule({
          invoiceInput: {
            services: [
              { description: 'A', quantity: 2, unit_price: 10 },
              { description: 'B', quantity: 1, unit_price: 5.5 },
            ],
          },
        }),
      ),
    ]);
    const [sent] = email.enqueueScheduleRetry.mock.calls[0] as [
      { schedules: string },
    ];
    expect(brl(sent.schedules)).toBe('Acme Ltda (R$ 25,50)');
  });

  it('a company that cannot be read is named generically instead of failing the notice', async () => {
    const { notifier, email } = build(['a@example.com']);
    await notifier.retryNotice(TENANT, [item(schedule({ companyId: 'gone' }))]);
    const [sent] = email.enqueueScheduleRetry.mock.calls[0] as [
      { schedules: string },
    ];
    expect(brl(sent.schedules)).toBe('sua empresa (R$ 150,00)');
  });

  it('sends nothing when the workspace has no one to tell', async () => {
    const { notifier, email } = build([]);
    await notifier.retryNotice(TENANT, [item(schedule())]);
    expect(email.enqueueScheduleRetry).not.toHaveBeenCalled();
  });
});

describe('ScheduleEmailNotifier.paused', () => {
  it('sends one pause e-mail per recipient for that schedule', async () => {
    const { notifier, email } = build();
    await notifier.paused(item(schedule()));
    expect(email.enqueueSchedulePaused).toHaveBeenCalledTimes(2);
    const [sent] = email.enqueueSchedulePaused.mock.calls[0] as [
      Record<string, string>,
    ];
    expect(sent).toMatchObject({
      to: 'admin@example.com',
      companyName: 'Acme Ltda',
    });
    expect(brl(sent.amount)).toBe('R$ 150,00');
    expect(sent.reason).toMatch(/notas disponíveis/);
  });

  it('sends nothing when there is no recipient', async () => {
    const { notifier, email } = build([]);
    await notifier.paused(item(schedule()));
    expect(email.enqueueSchedulePaused).not.toHaveBeenCalled();
  });
});
