import { CreditsLowNotifier } from './credits-low.notifier';
import { TenantRecipientsService } from './tenant-recipients.service';

const tenantId = 'tenant-1';

function build(
  period: { included: number; authorized: number; reserved: number },
  options: {
    lockHeld?: boolean;
    perDay?: number | null;
    forecastOn?: boolean;
    periodDaysLeft?: number;
  } = {},
) {
  const usage = {
    status: jest.fn().mockResolvedValue({
      plan: { name: 'Gratuito' },
      period: {
        id: 'period-1',
        periodEnd: new Date(
          Date.now() + (options.periodDaysLeft ?? 10) * 86_400_000 - 60_000,
        ),
        ...period,
      },
    }),
  };
  const members = [
    { authUserId: 'u-admin', role: 'admin', isActive: true },
    { authUserId: 'u-billing', role: 'billing', isActive: true },
    { authUserId: 'u-dev', role: 'developer', isActive: true },
    { authUserId: 'u-gone', role: 'admin', isActive: false },
  ];
  const memberships = { listForTenant: jest.fn().mockResolvedValue(members) };
  const emails: Record<string, string> = {
    'u-admin': 'Admin@Example.com',
    'u-billing': 'billing@example.com',
    'u-dev': 'dev@example.com',
    'u-gone': 'gone@example.com',
  };
  const users = {
    getUsersByIds: jest.fn(async (ids: string[]) => {
      const map = new Map<string, { email: string }>();
      for (const id of ids) map.set(id, { email: emails[id] });
      return map;
    }),
  };
  const email = { enqueueCreditsLow: jest.fn().mockResolvedValue(undefined) };
  const locks = {
    acquire: jest
      .fn()
      .mockResolvedValue(
        options.lockHeld ? null : { key: 'k', token: 't', ttlMs: 1 },
      ),
  };
  const pace = {
    perDay: jest.fn().mockResolvedValue(options.perDay ?? null),
  };
  const settings = {
    isOn: jest.fn().mockReturnValue(options.forecastOn ?? true),
  };
  const notifier = new CreditsLowNotifier(
    usage as never,
    new TenantRecipientsService(memberships as never, users as never),
    email as never,
    locks as never,
    pace as never,
    settings as never,
  );
  return { notifier, email, locks, users, pace, settings };
}

describe('CreditsLowNotifier', () => {
  it('does not notify below 80% of the included credits', async () => {
    const f = build({ included: 15, authorized: 9, reserved: 2 });
    await f.notifier.notify(tenantId);
    expect(f.locks.acquire).not.toHaveBeenCalled();
    expect(f.email.enqueueCreditsLow).not.toHaveBeenCalled();
  });

  it('notifies admin and billing members once usage reaches 80% (authorized + reserved)', async () => {
    const f = build({ included: 15, authorized: 10, reserved: 2 });
    await f.notifier.notify(tenantId);

    expect(f.locks.acquire).toHaveBeenCalledWith(
      'credits-low:tenant-1:period-1',
      expect.objectContaining({ ttlMs: expect.any(Number) }),
    );
    const sent = f.email.enqueueCreditsLow.mock.calls.map(
      ([input]) => input as { to: string },
    );
    expect(sent.map((input) => input.to).sort()).toEqual([
      'admin@example.com',
      'billing@example.com',
    ]);
    expect(f.email.enqueueCreditsLow).toHaveBeenCalledWith({
      to: 'admin@example.com',
      planName: 'Gratuito',
      remaining: 3,
      total: 15,
      daysLeft: null,
    });
  });

  it('adds how many days the credits last at the recent pace', async () => {
    const f = build(
      { included: 15, authorized: 12, reserved: 0 },
      { perDay: 1.5 },
    );
    await f.notifier.notify(tenantId);
    expect(f.pace.perDay).toHaveBeenCalledWith(tenantId);
    expect(f.email.enqueueCreditsLow).toHaveBeenCalledWith(
      expect.objectContaining({ remaining: 3, daysLeft: 2 }),
    );
  });

  it('leaves the forecast out without enough history', async () => {
    const f = build({ included: 15, authorized: 12, reserved: 0 });
    await f.notifier.notify(tenantId);
    expect(f.email.enqueueCreditsLow).toHaveBeenCalledWith(
      expect.objectContaining({ daysLeft: null }),
    );
  });

  it('leaves the forecast out when the plan renews before the credits end', async () => {
    const f = build(
      { included: 15, authorized: 12, reserved: 0 },
      { perDay: 0.1, periodDaysLeft: 10 },
    );
    await f.notifier.notify(tenantId);
    expect(f.email.enqueueCreditsLow).toHaveBeenCalledWith(
      expect.objectContaining({ daysLeft: null }),
    );
  });

  it('skips the forecast when its switch is off, and still warns', async () => {
    const f = build(
      { included: 15, authorized: 12, reserved: 0 },
      { perDay: 1.5, forecastOn: false },
    );
    await f.notifier.notify(tenantId);
    expect(f.pace.perDay).not.toHaveBeenCalled();
    expect(f.email.enqueueCreditsLow).toHaveBeenCalledWith(
      expect.objectContaining({ daysLeft: null }),
    );
  });

  it('still warns when the pace cannot be read', async () => {
    const f = build({ included: 15, authorized: 12, reserved: 0 });
    f.pace.perDay.mockRejectedValue(new Error('db down'));
    await f.notifier.notify(tenantId);
    expect(f.email.enqueueCreditsLow).toHaveBeenCalledTimes(2);
  });

  it('never goes below zero remaining', async () => {
    const f = build({ included: 15, authorized: 15, reserved: 1 });
    await f.notifier.notify(tenantId);
    expect(f.email.enqueueCreditsLow).toHaveBeenCalledWith(
      expect.objectContaining({ remaining: 0 }),
    );
  });

  it('sends only one warning per period', async () => {
    const f = build(
      { included: 15, authorized: 12, reserved: 0 },
      { lockHeld: true },
    );
    await f.notifier.notify(tenantId);
    expect(f.email.enqueueCreditsLow).not.toHaveBeenCalled();
  });

  it('ignores plans without included credits', async () => {
    const f = build({ included: 0, authorized: 0, reserved: 0 });
    await f.notifier.notify(tenantId);
    expect(f.locks.acquire).not.toHaveBeenCalled();
  });
});
