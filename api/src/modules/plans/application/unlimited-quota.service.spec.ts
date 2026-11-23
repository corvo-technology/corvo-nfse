import { UnlimitedQuotaService } from './unlimited-quota.service';

describe('UnlimitedQuotaService', () => {
  const companies = { countActiveByTenantId: jest.fn().mockResolvedValue(25) };
  const service = new UnlimitedQuotaService(companies as never);

  it('never refuses an emission or a new company, however many exist', async () => {
    await expect(service.assertCanEmit()).resolves.toBeUndefined();
    await expect(service.assertCanCreateCompany()).resolves.toBeUndefined();
  });

  it('reports no daily limit, no credit use and the real company count', async () => {
    expect(await service.getStatus('tenant')).toMatchObject({
      canEmit: true,
      dailyLimit: null,
      dailyUsage: 0,
      creditsUsed: 0,
      creditsReserved: 0,
      activeCompanies: 25,
      maxActiveCompanies: 999999,
    });
    expect((await service.getStatus('tenant')).reason).toBeUndefined();
  });
});
