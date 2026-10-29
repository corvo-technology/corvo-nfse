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
  companyIssRate: string | undefined,
) => {
  const companies = {
    findByIdAndTenantId: jest
      .fn()
      .mockResolvedValue({ simplesIssRate: companyIssRate }),
  };
  const reader = new TypeOrmCompanyFiscalProfileReader(
    { list: jest.fn().mockResolvedValue(profiles) } as never,
    companies as never,
  );
  return { reader, companies };
};

describe('TypeOrmCompanyFiscalProfileReader ISS rate', () => {
  it('uses the ISS rate of the company on a Simples profile', async () => {
    const { reader } = build([profile()], '2.01');
    const [found] = await reader.findEffectiveByDate('c1', 't1', '2026-10-15');
    expect(found?.simplesIssRate).toBe('2.01');
  });

  it('keeps the profile value when the company has no ISS rate', async () => {
    const [found] = await build(
      [profile()],
      undefined,
    ).reader.findEffectiveByDate('c1', 't1', '2026-10-15');
    expect(found?.simplesIssRate).toBe('3.00');
  });

  it('never touches a MEI or any other regime', async () => {
    const { reader, companies } = build(
      [profile({ taxRegime: 'MEI', simplesIssRate: null })],
      '2.01',
    );
    const [found] = await reader.findEffectiveByDate('c1', 't1', '2026-10-15');
    expect(found?.simplesIssRate).toBeNull();
    expect(companies.findByIdAndTenantId).not.toHaveBeenCalled();
  });
});
