import { NotFoundException } from '@nestjs/common';
import { BillingController } from './billing.controller';

const req = { authContext: { activeTenantId: 'tenant-1' } } as never;
const build = (pix: unknown) =>
  new BillingController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    pix as never,
    {} as never,
  );

describe('BillingController payment status', () => {
  it('asks for the payment inside the caller tenant only', async () => {
    const view = { id: 'p1', status: 'paid' };
    const pix = { paymentStatus: jest.fn().mockResolvedValue(view) };
    await expect(
      build(pix).paymentStatus({ paymentId: 'p1' }, req),
    ).resolves.toEqual({ data: view });
    expect(pix.paymentStatus).toHaveBeenCalledWith('tenant-1', 'p1');
  });

  it("answers 404 when the payment is not this tenant's", async () => {
    const pix = { paymentStatus: jest.fn().mockResolvedValue(null) };
    await expect(
      build(pix).paymentStatus({ paymentId: 'p2' }, req),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
