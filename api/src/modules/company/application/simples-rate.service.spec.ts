import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import type {
  ISimplesRateRepository,
  SimplesRate,
  SimplesRateInput,
} from '../domain/simples-rate';
import { SimplesRateService } from './simples-rate.service';

const tenantId = 'tenant-1';
const companyId = 'company-1';

class FakeRepository implements ISimplesRateRepository {
  rows = new Map<string, SimplesRate>();
  upsert(
    company: string,
    _tenant: string,
    month: string,
    input: SimplesRateInput,
  ): Promise<SimplesRate> {
    const row: SimplesRate = {
      companyId: company,
      month,
      totalRate: input.totalRate,
      issRate: input.issRate ?? null,
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    };
    this.rows.set(`${company}:${month}`, row);
    return Promise.resolve(row);
  }
  list(company: string): Promise<SimplesRate[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.companyId === company)
        .sort((a, b) => b.month.localeCompare(a.month)),
    );
  }
  findAtOrBefore(company: string, _t: string, month: string) {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.companyId === company && row.month <= month)
        .sort((a, b) => b.month.localeCompare(a.month))[0] ?? null,
    );
  }
}

const build = () => {
  const repository = new FakeRepository();
  return { repository, service: new SimplesRateService(repository) };
};

describe('SimplesRateService', () => {
  it('put creates a month and replaces the same month', async () => {
    const { service, repository } = build();
    await service.put(companyId, tenantId, '2026-10', { totalRate: '6.54' });
    const second = await service.put(companyId, tenantId, '2026-10', {
      totalRate: '7.00',
      issRate: '2.50',
    });
    expect(second).toMatchObject({ totalRate: '7.00', issRate: '2.50' });
    expect(repository.rows.size).toBe(1);
  });

  it.each([
    ['a malformed month', '2026-1', { totalRate: '5.00' }, 'month'],
    ['month 13', '2026-13', { totalRate: '5.00' }, 'month'],
    ['a month in the future', '2999-01', { totalRate: '5.00' }, 'month'],
    ['a rate above 100', '2026-10', { totalRate: '100.01' }, 'totalRate'],
    ['a negative rate', '2026-10', { totalRate: '-1' }, 'totalRate'],
    ['more than 2 decimals', '2026-10', { totalRate: '5.001' }, 'totalRate'],
    ['a non numeric rate', '2026-10', { totalRate: 'abc' }, 'totalRate'],
    [
      'an invalid optional rate',
      '2026-10',
      { totalRate: '5.00', issRate: '101' },
      'issRate',
    ],
  ])('put rejects %s', async (_name, month, input, field) => {
    const { service, repository } = build();
    const error = await service
      .put(companyId, tenantId, month, input)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FiscalValidationError);
    expect((error as FiscalValidationError).issues[0]?.field).toBe(field);
    expect(repository.rows.size).toBe(0);
  });

  describe('resolve', () => {
    it('returns the competence month when present, not stale', async () => {
      const { service } = build();
      await service.put(companyId, tenantId, '2026-10', { totalRate: '6.54' });
      const resolved = await service.resolve(companyId, tenantId, '2026-10-15');
      expect(resolved.rate?.totalRate).toBe('6.54');
      expect(resolved.stale).toBe(false);
    });

    it('repeats the previous month and is not stale up to one month behind', async () => {
      const { service } = build();
      await service.put(companyId, tenantId, '2026-09', { totalRate: '6.00' });
      const resolved = await service.resolve(companyId, tenantId, '2026-10-15');
      expect(resolved.rate?.month).toBe('2026-09');
      expect(resolved.stale).toBe(false);
    });

    it('marks stale when the closest month is more than one month behind', async () => {
      const { service } = build();
      await service.put(companyId, tenantId, '2026-07', { totalRate: '6.00' });
      const resolved = await service.resolve(companyId, tenantId, '2026-10-15');
      expect(resolved.rate?.month).toBe('2026-07');
      expect(resolved.stale).toBe(true);
    });

    it('never uses a month after the competence month', async () => {
      const { service, repository } = build();
      // Written straight to the repository: put() refuses future months.
      await repository.upsert(companyId, tenantId, '2026-11', {
        totalRate: '9.00',
      });
      const resolved = await service.resolve(companyId, tenantId, '2026-10-15');
      expect(resolved).toEqual({ rate: null, stale: false });
    });

    it('returns null when the rate was never informed', async () => {
      const { service } = build();
      expect(await service.resolve(companyId, tenantId, '2026-10-15')).toEqual({
        rate: null,
        stale: false,
      });
    });
  });

  it('list returns the newest month first', async () => {
    const { service } = build();
    await service.put(companyId, tenantId, '2026-08', { totalRate: '5.00' });
    await service.put(companyId, tenantId, '2026-10', { totalRate: '6.00' });
    const months = (await service.list(companyId, tenantId)).map(
      (r) => r.month,
    );
    expect(months).toEqual(['2026-10', '2026-08']);
  });
});
