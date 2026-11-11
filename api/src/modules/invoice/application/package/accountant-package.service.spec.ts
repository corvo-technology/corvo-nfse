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
    setLastSentMonth: jest.fn(
      async (_t: string, _c: string, month: string | null) => {
        state.accountantPackageLastSentMonth = month;
      },
    ),
  };
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
  return { service, state, repo, packages, email, events };
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
