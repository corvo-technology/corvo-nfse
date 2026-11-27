import { Logger } from '@nestjs/common';
import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import type { NfeNumberGapsQuery } from '../infra/typeorm-nfe-number-gaps.query';
import { NfeNumberGapsScheduler } from './nfe-number-gaps.scheduler';

describe('NfeNumberGapsScheduler', () => {
  const visit = (tenants: string[]) =>
    jest.fn(
      async (_kind: string, work: (tenantId: string) => Promise<void>) => {
        for (const tenant of tenants) await work(tenant);
      },
    );

  it('logs one line per company and series with gaps, for every tenant, and inutilizes nothing', async () => {
    const list = jest.fn((tenantId: string, environment: string) =>
      Promise.resolve(
        environment === 'test'
          ? [
              { companyId: 'c1', series: 1, start: 2, end: 2 },
              { companyId: 'c1', series: 1, start: 4, end: 5 },
              { companyId: 'c1', series: 2, start: 1, end: 3 },
            ]
          : [],
      ),
    );
    const discovery = { visit: visit(['one', 'two']) };
    const scheduler = new NfeNumberGapsScheduler(
      discovery as unknown as TenantWorkDiscovery,
      { list } as unknown as NfeNumberGapsQuery,
    );
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    try {
      await scheduler.run();
      expect(discovery.visit).toHaveBeenCalledWith(
        'nfe-number-gaps',
        expect.any(Function),
      );
      expect(list).toHaveBeenCalledWith('two', 'test');
      const lines = log.mock.calls.map((call) => call[0] as unknown);
      for (const tenantId of ['one', 'two']) {
        expect(lines).toContainEqual({
          tenantId,
          environment: 'test',
          companyId: 'c1',
          series: 1,
          gaps: 2,
        });
        expect(lines).toContainEqual({
          tenantId,
          environment: 'test',
          companyId: 'c1',
          series: 2,
          gaps: 1,
        });
      }
      expect(lines).toHaveLength(4);
    } finally {
      log.mockRestore();
    }
  });

  it('runs every day at 06:00 in the Brasília time zone', () => {
    expect(
      Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        NfeNumberGapsScheduler.prototype.handleDaily,
      ),
    ).toMatchObject({ cronTime: '0 6 * * *', timeZone: 'America/Sao_Paulo' });
  });
});
