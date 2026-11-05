import { BillingController } from './billing.controller';

const req = { authContext: { activeTenantId: 'tenant-1' } } as never;

describe('BillingController Pix Automático cancel', () => {
  it('cancels the tenant contract and answers with the paid period kept', async () => {
    const pix = {
      cancelPixSubscription: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new BillingController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      pix as never,
    );
    await expect(controller.cancelPix(req)).resolves.toEqual({
      data: { cancelled: true },
    });
    expect(pix.cancelPixSubscription).toHaveBeenCalledWith('tenant-1');
  });
});
