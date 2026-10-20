import { InvoiceOverviewService } from './invoice-overview.service';
import type { IInvoiceOverviewRepository } from '../domain/invoice-overview.repository';

describe('InvoiceOverviewService calendar windows', () => {
  const read = jest.fn();
  const service = new InvoiceOverviewService({ read } as IInvoiceOverviewRepository);
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-19T02:59:59Z'));
    read.mockReset().mockResolvedValue({
      counts: { authorized: 1201, rejected: 2, processing: 3 },
      dailyActivity: [{ date: '2026-10-18', count: 8 }],
      recentInvoices: [],
    });
  });
  afterEach(() => jest.useRealTimers());

  it.each([['7d', '2026-10-12', 7], ['30d', '2026-09-19', 30]] as const)(
    'returns exactly %s calendar days including today in São Paulo',
    async (period, from, days) => {
      const result = await service.get('tenant-a', 'live', period);
      expect(read).toHaveBeenCalledWith('tenant-a', 'live', {
        start: new Date(`${from}T03:00:00Z`),
        end: new Date('2026-10-19T03:00:00Z'),
        timezone: 'America/Sao_Paulo',
      });
      expect(result).toMatchObject({ period, from, to: '2026-10-18', counts: { authorized: 1201 } });
      expect(result.dailyActivity).toHaveLength(days);
      expect(result.dailyActivity[0]).toEqual({ date: from, count: 0 });
      expect(result.dailyActivity.at(-1)).toEqual({ date: '2026-10-18', count: 8 });
    },
  );

  it('advances the local day only at São Paulo midnight', async () => {
    jest.setSystemTime(new Date('2026-10-19T03:00:00Z'));
    const result = await service.get('tenant-a', 'test', '7d');
    expect(result.from).toBe('2026-10-13');
    expect(result.to).toBe('2026-10-19');
    expect(result.dailyActivity.at(-1)).toEqual({ date: '2026-10-19', count: 0 });
  });
});
