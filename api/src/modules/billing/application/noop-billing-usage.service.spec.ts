import { NoopBillingUsageService } from './noop-billing-usage.service';

describe('NoopBillingUsageService', () => {
  const service = new NoopBillingUsageService();

  it('reserves and settles nothing', async () => {
    await expect(service.reserve()).resolves.toBeNull();
    await expect(service.settle()).resolves.toBeUndefined();
  });

  it('answers a neutral status', async () => {
    const status = await service.status('tenant');
    expect(status).toMatchObject({
      blocked: false,
      dailyUsage: 0,
      avulsoBalance: 0,
      period: { authorized: 0, reserved: 0, tenantId: 'tenant' },
    });
  });
});
