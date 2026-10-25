import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import { TypeOrmCompanyFiscalProfileReader } from './typeorm-company-fiscal-profile.reader';

const profile = (
  over: Partial<CompanyFiscalProfile> = {},
): CompanyFiscalProfile => ({
  id: 'p1',
  tenantId: 't1',
  companyId: 'c1',
  taxRegime: 'SIMPLES_NACIONAL',
  simpleNational: true,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  simplesIssRate: '3.00',
  validFrom: '2025-01-01',
  validUntil: null,
  source: 'manual',
  reviewStatus: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  ...over,
});

const build = (
  profiles: CompanyFiscalProfile[],
  issRate: string | null | undefined,
) => {
  const rates = {
    resolve: jest.fn().mockResolvedValue({
      rate:
        issRate === undefined
          ? null
          : { month: '2026-10', totalRate: '6.54', issRate },
      stale: false,
    }),
  };
  const reader = new TypeOrmCompanyFiscalProfileReader(
    { list: jest.fn().mockResolvedValue(profiles) } as never,
    rates as never,
  );
  return { reader, rates };
};

describe('TypeOrmCompanyFiscalProfileReader monthly ISS rate', () => {
  it('uses the ISS rate informed for the competence month on a Simples profile', async () => {
    const { reader, rates } = build([profile()], '2.01');
    const [found] = await reader.findEffectiveByDate('c1', 't1', '2026-10-15');
    expect(found?.simplesIssRate).toBe('2.01');
    expect(rates.resolve).toHaveBeenCalledWith('c1', 't1', '2026-10-15');
  });

  it('keeps the profile rate when the month has no ISS rate or no rate at all', async () => {
    for (const issRate of [null, undefined]) {
      const [found] = await build(
        [profile()],
        issRate,
      ).reader.findEffectiveByDate('c1', 't1', '2026-10-15');
      expect(found?.simplesIssRate).toBe('3.00');
    }
  });

  it('never touches a MEI or any other regime', async () => {
    const { reader, rates } = build(
      [profile({ taxRegime: 'MEI', simplesIssRate: null })],
      '2.01',
    );
    const [found] = await reader.findEffectiveByDate('c1', 't1', '2026-10-15');
    expect(found?.simplesIssRate).toBeNull();
    expect(rates.resolve).not.toHaveBeenCalled();
  });

  it('works without the rate service', async () => {
    const reader = new TypeOrmCompanyFiscalProfileReader({
      list: jest.fn().mockResolvedValue([profile()]),
    } as never);
    const [found] = await reader.findEffectiveByDate('c1', 't1', '2026-10-15');
    expect(found?.simplesIssRate).toBe('3.00');
  });
});
