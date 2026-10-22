import 'reflect-metadata';
import { createNfseCalculateHandler } from './nfse-calculate.tool';

it('nfse_calculate uses the pre-emission calculation service', async () => {
  const calculate = jest
    .fn()
    .mockResolvedValue({ response: { status: 'ready', preEmission: true } });
  const handler = createNfseCalculateHandler({ calculate } as never);
  await expect(
    handler(
      {
        company_tax_id: '11222333000181',
        amount: 100,
        competence_date: '2026-10-22',
      },
      { tenantId: 'tenant-1', executionEnvironment: 'test' } as never,
    ),
  ).resolves.toEqual({ status: 'ready', preEmission: true });
  expect(calculate).toHaveBeenCalledWith(
    expect.objectContaining({ companyTaxId: '11222333000181', amount: 100 }),
    'tenant-1',
    'test',
  );
});
