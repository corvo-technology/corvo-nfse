import { ConfigService } from '@nestjs/config';
import type { AccountantCompany } from '../../domain/accountant-package.repository';
import { AccountantPackageService } from './accountant-package.service';
import { PackageLinkService } from './package-link.service';
import { monthLabel, previousMonth } from './package-month';

const TENANT = '11111111-1111-4111-8111-111111111111';

type Row = {
  id: string;
  tenantId: string;
  legalName: string;
  tradeName?: string;
  environment: string;
  accountantEmail: string | null;
  accountantPackageLastSentMonth: string | null;
};

const row = (over: Partial<Row> = {}): Row => ({
  id: 'company-1',
  tenantId: TENANT,
  legalName: 'Acme Ltda',
  environment: 'live',
  accountantEmail: 'contador@example.com',
  accountantPackageLastSentMonth: null,
  ...over,
});

function setup(
  company: Row,
  summary = {
    month: '2026-10',
    count: 3,
    total: '300.00',
    limit: 500,
    companyName: 'Acme Ltda',
    companyTaxId: '11222333000181',
  },
) {
  const state = { ...company };
  const view = (): AccountantCompany => ({
    id: state.id,
    tenantId: state.tenantId,
    name: state.tradeName ?? state.legalName,
    taxId: '11222333000181',
    environment: state.environment as 'test' | 'live',
    accountantEmail: state.accountantEmail,
    lastSentMonth: state.accountantPackageLastSentMonth,
  });
  const repo = {
    find: jest.fn(async () => view()),
    listEnabled: jest.fn(async () => (state.accountantEmail ? [view()] : [])),
    setEmail: jest.fn(async (_t: string, _c: string, email: string | null) => {
      state.accountantEmail = email;
    }),
    claimMonth: jest.fn(
      async (_t: string, _c: string, month: string, force: boolean) => {
        if (!force && state.accountantPackageLastSentMonth === month)
          return false;
        state.accountantPackageLastSentMonth = month;
        return true;
      },
    ),
    recordSend: jest.fn(),
    hasSend: jest.fn(),
    listSends: jest.fn(),
    setLastSentMonth: jest.fn(
      async (_t: string, _c: string, month: string | null) => {
        state.accountantPackageLastSentMonth = month;
      },
    ),
  };
  const sends: Array<Record<string, unknown>> = [];
  repo.recordSend.mockImplementation(async (entry: Record<string, unknown>) => {
    sends.push(entry);
  });
  repo.hasSend.mockImplementation(
    async (_t: string, _c: string, month: string, status: string) =>
      sends.some((entry) => entry.month === month && entry.status === status),
  );
  const packages = { summary: jest.fn().mockResolvedValue(summary) };
  const email = { enqueueNotice: jest.fn().mockResolvedValue(undefined) };
  const events = { publishBestEffort: jest.fn() };
  const links = new PackageLinkService(
    new ConfigService({
      auth: { csrfSigningSecret: 's'.repeat(32) },
      app: { apiPrefix: 'v1' },
      PUBLIC_API_URL: 'https://api.corvo.example',
    }),
  );
  const service = new AccountantPackageService(
    repo,
    packages as never,
    links,
    email as never,
    events as never,
  );
  return { service, state, repo, packages, email, events, sends };
}

const dayOne = new Date('2026-11-01T11:30:00Z');

describe('AccountantPackageService', () => {
  it('sends the previous month once, with a 7-day link and the totals', async () => {
    const { service, email, packages, state } = setup(row());
    await service.sendMonthly(TENANT, dayOne, false);
    expect(packages.summary).toHaveBeenCalledWith(
      expect.objectContaining({ month: '2026-10', environment: 'live' }),
    );
    expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
    const [to, message] = email.enqueueNotice.mock.calls[0] as [
      string,
      { html: string; text: string },
    ];
    expect(to).toBe('contador@example.com');
    expect(message.text).toContain('outubro de 2026');
    expect(message.text).toContain('Acme Ltda');
    expect(message.text).toContain('11.222.333/0001-81');
    expect(message.text).toMatch(
      /https:\/\/api\.corvo\.example\/v1\/invoice-package-links\//,
    );
    expect(message.text).toContain('Notas: 3');
    expect(state.accountantPackageLastSentMonth).toBe('2026-10');
  });

  it('records every send in the history with count, total, recipient and trigger', async () => {
    const { service, sends } = setup(row());
    await service.sendMonthly(TENANT, dayOne, false);
    await service.sendNow(TENANT, 'company-1', 'live', '2026-10');
    await service.sendNow(TENANT, 'company-1', 'live', '2026-10', 'mcp-or-api');
    expect(sends).toEqual([
      expect.objectContaining({
        tenantId: TENANT,
        companyId: 'company-1',
        month: '2026-10',
        recipient: 'contador@example.com',
        invoiceCount: 3,
        totalCents: 30000,
        status: 'sent',
        trigger: 'scheduled',
      }),
      expect.objectContaining({ status: 'sent', trigger: 'manual' }),
      expect.objectContaining({ status: 'sent', trigger: 'mcp-or-api' }),
    ]);
  });

  it('keeps a send even when the history cannot be written', async () => {
    const { service, repo, email, state } = setup(row());
    repo.recordSend.mockRejectedValue(new Error('db down'));
    await expect(
      service.sendNow(TENANT, 'company-1', 'live', '2026-10'),
    ).resolves.toBe('sent');
    expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
    expect(state.accountantPackageLastSentMonth).toBe('2026-10');
  });

  it('does not send the same month twice when the job runs again', async () => {
    const { service, email } = setup(row());
    await service.sendMonthly(TENANT, dayOne, false);
    await service.sendMonthly(TENANT, dayOne, false);
    expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
  });

  it('skips a month with no notes without marking it sent', async () => {
    const { service, email, state } = setup(row(), {
      month: '2026-10',
      count: 0,
      total: '0.00',
      limit: 500,
      companyName: 'Acme',
      companyTaxId: '1',
    });
    await service.sendMonthly(TENANT, dayOne, false);
    expect(email.enqueueNotice).not.toHaveBeenCalled();
    expect(state.accountantPackageLastSentMonth).toBeNull();
  });

  describe('months that cannot be sent', () => {
    const empty = {
      month: '2026-10',
      count: 0,
      total: '0.00',
      limit: 500,
      companyName: 'Acme',
      companyTaxId: '1',
    };
    const big = { ...empty, count: 700, total: '70000.00' };

    it('warns the owners once and records once when the scheduled month is empty', async () => {
      const { service, events, sends } = setup(row(), empty);
      await service.sendMonthly(TENANT, dayOne, false);
      await service.sendMonthly(TENANT, dayOne, false);
      expect(sends).toEqual([
        expect.objectContaining({
          status: 'skipped-empty',
          trigger: 'scheduled',
          invoiceCount: 0,
        }),
      ]);
      expect(events.publishBestEffort).toHaveBeenCalledTimes(1);
      expect(events.publishBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          notice: expect.objectContaining({
            kind: 'accountant-package-empty',
            companyId: 'company-1',
            month: '2026-10',
          }),
        }),
      );
    });

    it('does not send a month over the limit, and warns with the size', async () => {
      const { service, email, events, sends, state } = setup(row(), big);
      await service.sendMonthly(TENANT, dayOne, false);
      expect(email.enqueueNotice).not.toHaveBeenCalled();
      expect(state.accountantPackageLastSentMonth).toBeNull();
      expect(sends).toEqual([
        expect.objectContaining({
          status: 'skipped-too-large',
          invoiceCount: 700,
          totalCents: 7000000,
        }),
      ]);
      expect(events.publishBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          notice: expect.objectContaining({
            kind: 'accountant-package-too-large',
            count: 700,
            limit: 500,
          }),
        }),
      );
    });

    it('records a manual skip each time, without a notice', async () => {
      const { service, events, sends } = setup(row(), empty);
      await expect(
        service.sendNow(TENANT, 'company-1', 'live', '2026-10'),
      ).resolves.toBe('skipped-empty');
      await service.sendNow(TENANT, 'company-1', 'live', '2026-10');
      expect(sends).toHaveLength(2);
      expect(events.publishBestEffort).not.toHaveBeenCalled();
    });
  });

  it('never sends for a test company or one without an e-mail', async () => {
    const test = setup(row({ environment: 'test' }));
    await expect(
      test.service.sendNow(TENANT, 'company-1', 'live', '2026-10'),
    ).resolves.toBe('skipped-test');
    const off = setup(row({ accountantEmail: null }));
    await expect(
      off.service.sendNow(TENANT, 'company-1', 'live', '2026-10'),
    ).resolves.toBe('skipped-no-email');
    await off.service.sendMonthly(TENANT, dayOne, false);
    expect(test.email.enqueueNotice).not.toHaveBeenCalled();
    expect(off.email.enqueueNotice).not.toHaveBeenCalled();
  });

  it('send now repeats a month that was already sent', async () => {
    const { service, email } = setup(
      row({ accountantPackageLastSentMonth: '2026-10' }),
    );
    await expect(
      service.sendNow(TENANT, 'company-1', 'live', '2026-10'),
    ).resolves.toBe('sent');
    expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
  });

  it('frees the month for a retry when the e-mail cannot be queued, and warns on the last attempt', async () => {
    const { service, email, state, events } = setup(row());
    email.enqueueNotice.mockRejectedValueOnce(new Error('queue down'));
    await service.sendMonthly(TENANT, dayOne, false);
    expect(state.accountantPackageLastSentMonth).toBeNull();
    expect(events.publishBestEffort).not.toHaveBeenCalled();

    email.enqueueNotice.mockRejectedValueOnce(new Error('queue down'));
    await service.sendMonthly(TENANT, dayOne, true);
    expect(events.publishBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        notice: expect.objectContaining({
          kind: 'accountant-package-failed',
          month: '2026-10',
        }),
      }),
    );

    await service.sendMonthly(TENANT, dayOne, false);
    expect(state.accountantPackageLastSentMonth).toBe('2026-10');
  });

  it('records a failure in the history only on the last scheduled attempt, and on a manual send', async () => {
    const { service, email, sends } = setup(row());
    email.enqueueNotice.mockRejectedValueOnce(new Error('queue down'));
    await service.sendMonthly(TENANT, dayOne, false);
    expect(sends).toEqual([]);
    email.enqueueNotice.mockRejectedValueOnce(new Error('queue down'));
    await service.sendMonthly(TENANT, dayOne, true);
    email.enqueueNotice.mockRejectedValueOnce(new Error('queue down'));
    await expect(
      service.sendNow(TENANT, 'company-1', 'live', '2026-10'),
    ).rejects.toThrow('queue down');
    expect(sends).toEqual([
      expect.objectContaining({ status: 'failed', trigger: 'scheduled' }),
      expect.objectContaining({ status: 'failed', trigger: 'manual' }),
    ]);
  });

  it('only sends companies of the tenant it is asked about', async () => {
    const { service, repo } = setup(row());
    await service.sendMonthly(TENANT, dayOne, false);
    expect(repo.listEnabled).toHaveBeenCalledWith(TENANT);
  });

  describe('accountant e-mail', () => {
    it('rejects an invalid address', async () => {
      const { service, repo } = setup(row());
      await expect(
        service.setEmail(TENANT, 'company-1', 'live', 'not-an-email'),
      ).rejects.toMatchObject({
        response: { code: 'ACCOUNTANT_EMAIL_INVALID' },
      });
      expect(repo.setEmail).not.toHaveBeenCalled();
    });

    it('sends a short test e-mail to a new address only, never twice for the same one', async () => {
      const { service, email } = setup(row({ accountantEmail: null }));
      const first = await service.setEmail(
        TENANT,
        'company-1',
        'live',
        'novo@example.com',
      );
      expect(first.testEmailSent).toBe(true);
      expect(email.enqueueNotice).toHaveBeenCalledTimes(1);
      const [to, message] = email.enqueueNotice.mock.calls[0] as [
        string,
        { text: string },
      ];
      expect(to).toBe('novo@example.com');
      expect(message.text).toContain('Acme Ltda');
      expect(message.text).toContain('11.222.333/0001-81');
      expect(message.text).toContain('todo dia 1º');

      const same = await service.setEmail(
        TENANT,
        'company-1',
        'live',
        ' Novo@Example.com ',
      );
      expect(same.testEmailSent).toBe(false);
      const off = await service.setEmail(TENANT, 'company-1', 'live', null);
      expect(off.testEmailSent).toBe(false);
      expect(email.enqueueNotice).toHaveBeenCalledTimes(1);

      await service.setEmail(TENANT, 'company-1', 'live', 'outro@example.com');
      expect(email.enqueueNotice).toHaveBeenCalledTimes(2);
    });

    it('still saves the address when the test e-mail cannot be queued', async () => {
      const { service, email, state } = setup(row({ accountantEmail: null }));
      email.enqueueNotice.mockRejectedValueOnce(new Error('queue down'));
      const result = await service.setEmail(
        TENANT,
        'company-1',
        'live',
        'novo@example.com',
      );
      expect(result.testEmailSent).toBe(false);
      expect(state.accountantEmail).toBe('novo@example.com');
    });

    it('does not send a test e-mail for a test-mode company', async () => {
      const { service, email } = setup(
        row({ accountantEmail: null, environment: 'test' }),
      );
      await service.setEmail(TENANT, 'company-1', 'test', 'novo@example.com');
      expect(email.enqueueNotice).not.toHaveBeenCalled();
    });

    it('saves a valid address in lower case and turns off with blank', async () => {
      const { service, state } = setup(row({ accountantEmail: null }));
      await service.setEmail(
        TENANT,
        'company-1',
        'live',
        ' Conta@Example.COM ',
      );
      expect(state.accountantEmail).toBe('conta@example.com');
      await service.setEmail(TENANT, 'company-1', 'live', '  ');
      expect(state.accountantEmail).toBeNull();
    });
  });
});

describe('AccountantPackageService history', () => {
  it('lists the last 12 attempts of the company with ISO dates', async () => {
    const { service, repo } = setup(row());
    repo.listSends.mockResolvedValue([
      {
        id: 's1',
        month: '2026-10',
        recipient: 'contador@example.com',
        invoiceCount: 3,
        totalCents: 30000,
        status: 'sent',
        trigger: 'scheduled',
        createdAt: new Date('2026-11-01T11:03:00Z'),
      },
    ]);
    await expect(
      service.listSends(TENANT, 'company-1', 'live'),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 's1',
        status: 'sent',
        createdAt: '2026-11-01T11:03:00.000Z',
      }),
    ]);
    expect(repo.listSends).toHaveBeenCalledWith(TENANT, 'company-1', 12);
  });
});

describe('package months', () => {
  it('uses the São Paulo calendar', () => {
    // 01:00 UTC on Dec 1 is still Nov 30 in São Paulo.
    expect(previousMonth(new Date('2026-12-01T01:00:00Z'))).toBe('2026-10');
    expect(previousMonth(new Date('2026-12-01T12:00:00Z'))).toBe('2026-11');
    expect(previousMonth(new Date('2027-01-01T12:00:00Z'))).toBe('2026-12');
  });
  it('labels a month in Portuguese', () => {
    expect(monthLabel('2026-03')).toBe('março de 2026');
  });
});
