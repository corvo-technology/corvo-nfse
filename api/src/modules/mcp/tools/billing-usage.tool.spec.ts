import { createBillingUsageHandler } from './billing-usage.tool';

it('billing_usage reads the authenticated workspace quota', async () => {
  const getStatus = jest.fn().mockResolvedValue({ canEmit: true });
  await expect(
    createBillingUsageHandler({ getStatus } as never)({}, {
      tenantId: 'tenant-1',
    } as never),
  ).resolves.toEqual({ canEmit: true });
  expect(getStatus).toHaveBeenCalledWith('tenant-1');
});
