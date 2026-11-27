import {
  LifecycleMonthlySummaryScheduler,
  LifecyclePaymentReminderScheduler,
} from './lifecycle-emails.scheduler';

const now = new Date('2026-11-01T12:00:00Z');

function build(options: { on?: boolean; turn?: boolean } = {}) {
  const settings = { isOn: jest.fn().mockReturnValue(options.on ?? true) };
  const discovery = {
    visit: jest.fn(
      async (_kind: string, work: (tenantId: string) => Promise<void>) => {
        await work('tenant-a');
        await work('tenant-b');
      },
    ),
  };
  const lifecycle = {
    sendMonthlySummary: jest.fn().mockResolvedValue('sent'),
    sendPaymentReminder: jest.fn().mockResolvedValue('sent'),
  };
  const locks = {
    acquire: jest
      .fn()
      .mockResolvedValue(options.turn === false ? null : { key: 'k' }),
  };
  return { settings, discovery, lifecycle, locks };
}

describe('LifecycleMonthlySummaryScheduler', () => {
  it('visits the workspaces that issued in the month and sends each summary', async () => {
    const f = build();
    const scheduler = new LifecycleMonthlySummaryScheduler(
      f.settings as never,
      f.discovery as never,
      f.lifecycle as never,
      f.locks as never,
    );
    await scheduler.run(now);
    expect(f.discovery.visit).toHaveBeenCalledWith(
      'lifecycle-monthly-summary',
      expect.any(Function),
    );
    expect(f.lifecycle.sendMonthlySummary).toHaveBeenCalledWith(
      'tenant-a',
      now,
    );
    expect(f.lifecycle.sendMonthlySummary).toHaveBeenCalledWith(
      'tenant-b',
      now,
    );
  });

  it('takes one Redis lock per month and day, so a second worker skips the pass', async () => {
    const f = build({ turn: false });
    const scheduler = new LifecycleMonthlySummaryScheduler(
      f.settings as never,
      f.discovery as never,
      f.lifecycle as never,
      f.locks as never,
    );
    await scheduler.run(now);
    expect(f.locks.acquire).toHaveBeenCalledWith(
      'lifecycle:monthly-summary:2026-11:2026-11-01',
      expect.objectContaining({ ttlMs: expect.any(Number) }),
    );
    expect(f.discovery.visit).not.toHaveBeenCalled();
  });

  it('does nothing when its switch is off', async () => {
    const f = build({ on: false });
    const scheduler = new LifecycleMonthlySummaryScheduler(
      f.settings as never,
      f.discovery as never,
      f.lifecycle as never,
      f.locks as never,
    );
    await scheduler.run(now);
    expect(f.locks.acquire).not.toHaveBeenCalled();
    expect(f.discovery.visit).not.toHaveBeenCalled();
  });

  it('runs on days 1 and 2 at 09:00 in São Paulo', () => {
    const meta = Reflect.getMetadataKeys(
      LifecycleMonthlySummaryScheduler.prototype.handleMonthly,
    );
    expect(meta.length).toBeGreaterThan(0);
    const options = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      LifecycleMonthlySummaryScheduler.prototype.handleMonthly,
    ) as { cronTime: string; timeZone: string };
    expect(options.cronTime).toBe('0 9 1,2 * *');
    expect(options.timeZone).toBe('America/Sao_Paulo');
  });
});

describe('LifecyclePaymentReminderScheduler', () => {
  it('visits the workspaces with an unpaid checkout and reminds each', async () => {
    const f = build();
    const scheduler = new LifecyclePaymentReminderScheduler(
      f.settings as never,
      f.discovery as never,
      f.lifecycle as never,
      f.locks as never,
    );
    await scheduler.run(now);
    expect(f.discovery.visit).toHaveBeenCalledWith(
      'lifecycle-payment-pending',
      expect.any(Function),
    );
    expect(f.lifecycle.sendPaymentReminder).toHaveBeenCalledTimes(2);
    expect(f.locks.acquire).toHaveBeenCalledWith(
      'lifecycle:payment-reminder:2026-11-01T12',
      expect.anything(),
    );
  });

  it('skips the pass when another worker has it or the switch is off', async () => {
    const taken = build({ turn: false });
    await new LifecyclePaymentReminderScheduler(
      taken.settings as never,
      taken.discovery as never,
      taken.lifecycle as never,
      taken.locks as never,
    ).run(now);
    expect(taken.discovery.visit).not.toHaveBeenCalled();

    const off = build({ on: false });
    await new LifecyclePaymentReminderScheduler(
      off.settings as never,
      off.discovery as never,
      off.lifecycle as never,
      off.locks as never,
    ).run(now);
    expect(off.locks.acquire).not.toHaveBeenCalled();
  });
});
