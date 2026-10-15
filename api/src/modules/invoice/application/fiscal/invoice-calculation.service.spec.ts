import { recordCalculate } from './fiscal.metrics';
jest.mock('./fiscal.metrics', () => ({
  ...jest.requireActual<typeof import('./fiscal.metrics')>('./fiscal.metrics'),
  recordCalculate: jest.fn(),
}));
import { DateTime } from 'luxon';
import { Company } from '@/modules/company/domain/company';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { InvoiceDomainService } from '../../domain/invoice-domain.service';
import { fiscalError } from '../../domain/fiscal/fiscal-error';
import { InvoiceIntakeService } from '../invoice-intake.service';
import { FiscalEngineService } from './fiscal-engine.service';
import { InvoiceCalculationService } from './invoice-calculation.service';
import { calculationEngine } from './testing/calculation-fixtures';
import { contextFor } from './testing/context';

describe('InvoiceCalculationService', () => {
  beforeEach(() => jest.clearAllMocks());
  const company = Company.create(
    {
      legalName: 'Empresa',
      taxId: '11222333000181',
      taxRegime: 'MEI',
      municipalityCode: '3550308',
      defaultServiceCode: '060101',
    },
    'ten-1',
  );
  const intake = new InvoiceIntakeService(
    { findById: async () => company } as never,
    new InvoiceDomainService(),
  );
  const dto = {
    companyId: company.id,
    service: {},
    amount: 50,
    competenceDate: '2026-01-01',
  };
  it('only injects intake and engine, so it has no write dependencies', () => {
    expect(
      Reflect.getMetadata('design:paramtypes', InvoiceCalculationService),
    ).toEqual([InvoiceIntakeService, FiscalEngineService]);
  });
  it('accepts future competence without options.type', async () => {
    const future = DateTime.now()
      .setZone('America/Sao_Paulo')
      .plus({ days: 1 })
      .toISODate();
    if (!future) throw new Error('Invalid date');
    const result = await new InvoiceCalculationService(
      intake,
      calculationEngine(),
    ).calculate({ ...dto, competenceDate: future }, 'ten-1', 'test');
    expect(result).toHaveProperty('response.competenceDate', future);
    expect(result).toHaveProperty('response.status', 'ready');
    expect(recordCalculate).toHaveBeenCalledWith('ready', expect.any(Number));
  });
  it.each(['INTEGRATION', 'INTERNAL'] as const)(
    'returns an HTTP failure for %s',
    async (category) => {
      const error = fiscalError({
        code: 'FISCAL_INTERNAL_ERROR',
        message: 'private',
        category,
      });
      const engine = {
        calculatePartial: async () => ({
          context: contextFor(),
          result: null,
          error,
        }),
      };
      const result = await new InvoiceCalculationService(
        intake,
        engine as never,
      ).calculate(dto, 'ten-1', 'test');
      expect(result).toEqual({ httpError: error });
      expect(recordCalculate).toHaveBeenCalledWith('error', expect.any(Number));
    },
  );
  it('returns blocked for configuration failures', async () => {
    const result = await new InvoiceCalculationService(
      intake,
      new FiscalEngineService([
        {
          name: 'profile',
          required: true,
          execute: async () => ({
            ok: false,
            error: fiscalError({
              code: 'FISCAL_PROFILE_MISSING',
              message: 'profile',
              category: 'CONFIGURATION',
            }),
          }),
        },
      ]),
    ).calculate(dto, 'ten-1', 'test');
    expect(result).toHaveProperty('response.status', 'blocked');
    expect(recordCalculate).toHaveBeenCalledWith('blocked', expect.any(Number));
  });
  it('propagates request normalization failures', async () => {
    await expect(
      new InvoiceCalculationService(intake, calculationEngine()).calculate(
        { ...dto, amount: -1 },
        'ten-1',
        'test',
      ),
    ).rejects.toBeInstanceOf(FiscalValidationError);
    expect(recordCalculate).toHaveBeenCalledWith('error', expect.any(Number));
  });
});
