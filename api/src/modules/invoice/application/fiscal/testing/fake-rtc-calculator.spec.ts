import type { RtcCalculationInput } from '@/modules/invoice/domain/fiscal/rtc/rtc-calculator.port';
import { fiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { ok, err } from '@/modules/invoice/domain/fiscal/result';
import { FakeRtcCalculator } from './fake-rtc-calculator';

const input = (
  overrides: Partial<RtcCalculationInput> = {},
): RtcCalculationInput => ({
  competenceDate: '2026-10-13',
  grossAmount: '1000.00',
  discountAmount: '0.00',
  serviceCode: '010601',
  nbsCode: '010601001',
  cst: '000',
  classCode: '060101',
  operationIndicator: '000000',
  providerTaxId: '11222330000181',
  providerMunicipalityCode: '3550308',
  incidenceMunicipalityCode: '3550308',
  customer: {
    kind: 'CNPJ',
    taxId: '12345678000199',
    municipalityCode: '3550308',
  },
  regime: 'LUCRO_PRESUMIDO',
  ...overrides,
});

describe('FakeRtcCalculator', () => {
  it('applies the 2026 test phase rates over the gross amount (CBS 0.9, IBS 0.1)', async () => {
    const result = await new FakeRtcCalculator().calculate(input());
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.value).toEqual({
      calculatorVersion: 'fake-2026.1',
      cbs: { base: '1000.00', rate: '0.9', amount: '9.00' },
      ibsState: { base: '1000.00', rate: '0', amount: '0.00' },
      ibsCity: { base: '1000.00', rate: '0.1', amount: '1.00' },
      ibsTotal: { base: '1000.00', rate: '0.1', amount: '1.00' },
      legalReferences: ['LC 214/2025'],
      calculationMemory: [{ source: 'fake-rtc' }],
      collectionWaived: true,
    });
  });

  it('deducts the discount from the base', async () => {
    const result = await new FakeRtcCalculator().calculate(
      input({ discountAmount: '100.00' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.value.cbs).toEqual({
      base: '900.00',
      rate: '0.9',
      amount: '8.10',
    });
    expect(result.value.ibsTotal).toEqual({
      base: '900.00',
      rate: '0.1',
      amount: '0.90',
    });
    expect(result.value.ibsState).toEqual({
      base: '900.00',
      rate: '0',
      amount: '0.00',
    });
    expect(result.value.ibsCity).toEqual({
      base: '900.00',
      rate: '0.1',
      amount: '0.90',
    });
  });

  it('respects a custom handler, forwarding the calculation input', async () => {
    const seen: RtcCalculationInput[] = [];
    const calculator = new FakeRtcCalculator({
      handler: (received) => {
        seen.push(received);
        return err(
          fiscalError({
            code: 'TAX_CALCULATION_UNAVAILABLE',
            message: 'RTC engine did not answer in time',
            category: 'INTEGRATION',
            step: 'RtcCalculator',
            details: { reason: 'timeout' },
            retryable: true,
          }),
        );
      },
    });
    const result = await calculator.calculate(input());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      retryable: true,
    });
    expect(seen).toEqual([input()]);
  });

  it('exposes the calculator version (overridable) and a healthy adapter', async () => {
    expect(await new FakeRtcCalculator().version()).toEqual(ok('fake-2026.1'));
    expect(
      await new FakeRtcCalculator({ version: 'custom-1' }).version(),
    ).toEqual(ok('custom-1'));
    expect(await new FakeRtcCalculator().health()).toEqual(
      ok({ available: true }),
    );
  });
});
