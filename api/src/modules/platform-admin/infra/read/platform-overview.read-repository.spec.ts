import {
  PlatformOverviewReadRepository,
  rejectionRate,
  saoPauloDayStart,
} from './platform-overview.read-repository';
import type { DataSource } from 'typeorm';
import type { PlatformReadSession } from '../platform-read-session';

describe('platform overview helpers', () => {
  it('rejectionRate', () => {
    expect(rejectionRate(9, 1)).toBe(0.1);
    expect(rejectionRate(0, 0)).toBeNull();
    expect(rejectionRate(0, 3)).toBe(1);
  });

  it('saoPauloDayStart: 02:30Z ainda é o dia anterior em BRT', () => {
    expect(
      saoPauloDayStart(new Date('2026-11-23T02:30:00Z')).toISOString(),
    ).toBe('2026-11-22T03:00:00.000Z');
    expect(
      saoPauloDayStart(new Date('2026-11-23T03:00:00Z')).toISOString(),
    ).toBe('2026-11-23T03:00:00.000Z');
    expect(
      saoPauloDayStart(new Date('2026-11-23T15:00:00Z')).toISOString(),
    ).toBe('2026-11-23T03:00:00.000Z');
  });
});

describe('PlatformOverviewReadRepository', () => {
  it('monta o contrato a partir das consultas, numa única sessão', async () => {
    const q = jest
      .fn()
      .mockResolvedValueOnce([{ total: '10', new7d: '2', new30d: '4' }])
      .mockResolvedValueOnce([
        {
          environment: 'live',
          auth_today: '1',
          rej_today: '0',
          auth_d7: '9',
          rej_d7: '1',
          auth_d30: '0',
          rej_d30: '0',
        },
      ])
      .mockResolvedValueOnce([
        {
          sub_d7: '1000',
          avulso_d7: '500',
          sub_d30: '3000',
          avulso_d30: '0',
          stripe_since: new Date('2026-11-01T00:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([{ units7d: '5', units30d: '7' }]);
    const run = jest.fn((work: (qq: typeof q) => Promise<unknown>) => work(q));
    const repo = new PlatformOverviewReadRepository(
      { run } as unknown as PlatformReadSession,
      { options: { schema: 'corvo' } } as unknown as DataSource,
    );
    const out = await repo.snapshot(new Date('2026-11-23T15:00:00Z'));
    expect(run).toHaveBeenCalledTimes(1);
    for (const call of q.mock.calls as unknown[][])
      expect(String(call[0])).not.toMatch(/credit_transactions/);
    expect(out.users).toEqual({ total: 10, new7d: 2, new30d: 4 });
    expect(out.invoices.live.d7).toEqual({
      authorized: 9,
      rejected: 1,
      rejectionRate: 0.1,
    });
    expect(out.invoices.live.d30.rejectionRate).toBeNull();
    expect(out.invoices.test.today).toEqual({
      authorized: 0,
      rejected: 0,
      rejectionRate: null,
    });
    expect(out.revenue.d7).toEqual({
      subscriptionCents: 1000,
      avulsoCents: 500,
      totalCents: 1500,
    });
    expect(out.revenue.stripeRecordedSince).toBe('2026-11-01T00:00:00.000Z');
    expect(out.adminGrants).toEqual({ units7d: 5, units30d: 7 });
  });
});
