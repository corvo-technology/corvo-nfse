import { fiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { toCalculationResponse } from './calculation-response';
import {
  calculationEngine,
  calculationProfile,
  calculationServiceProfile,
} from './testing/calculation-fixtures';
import { defaultInvoice, contextFor } from './testing/context';

describe('toCalculationResponse', () => {
  it('returns ready for MEI 2026 without a customer and without taxes', async () => {
    const response = toCalculationResponse(
      await calculationEngine().calculatePartial(
        defaultInvoice({ customer: null }),
      ),
    );
    expect(response).toMatchObject({
      status: 'ready',
      preEmission: true,
      taxes: {},
      withholdings: [],
      netReceivableAmount: '1000.00',
      applicability: {
        iss: { status: 'NOT_APPLICABLE', reason: expect.any(String) },
      },
    });
    expect(response.disclaimer).toBeTruthy();
  });
  it('returns partial classification and missing fields for regular IBS/CBS without classification', async () => {
    const engine = calculationEngine(
      calculationProfile({
        taxRegime: 'LUCRO_PRESUMIDO',
        simpleNational: false,
      }),
      [calculationServiceProfile()],
    );
    const response = toCalculationResponse(
      await engine.calculatePartial(defaultInvoice()),
    );
    expect(response.status).toBe('blocked');
    expect(response.blocking?.code).toBe('FISCAL_CLASSIFICATION_REQUIRED');
    expect(response.pendingFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'service.fiscal.nbsCode' }),
      ]),
    );
    expect(response.classification?.serviceCode).toBe('010101');
    expect(response.taxes).toEqual({});
    expect(response.netReceivableAmount).toBeNull();
  });
  it('returns customer as pending for a regular regime without a customer', async () => {
    const response = toCalculationResponse(
      await calculationEngine(calculationProfile({ taxRegime: 'LUCRO_REAL' }), [
        calculationServiceProfile(),
      ]).calculatePartial(defaultInvoice({ customer: null })),
    );
    expect(response.status).toBe('blocked');
    expect(response.pendingFields).toEqual([
      expect.objectContaining({ field: 'customer' }),
    ]);
  });
  it('never returns customer documents or names, including through error details', () => {
    const context = contextFor();
    const response = toCalculationResponse({
      context,
      result: null,
      error: fiscalError({
        code: 'FISCAL_VALIDATION_FAILED',
        category: 'VALIDATION',
        message: 'Customer validation',
        details: {
          fields: ['customer'],
          customer: {
            taxId: context.invoice.customer?.taxId,
            name: 'Secret Client',
          },
        },
      }),
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('12345678000199');
    expect(serialized).not.toContain('Secret Client');
    expect(serialized).not.toContain('taxId');
  });
  it('merges missing configuration with error fields and keeps only calculated amounts', () => {
    const notApplicable = { status: 'NOT_APPLICABLE' as const, reason: 'none' };
    const context = contextFor({
      applicability: {
        strategy: 'regular',
        customerRequired: false,
        iss: {
          status: 'MISSING_CONFIGURATION',
          reason: 'rate',
          missingFields: ['service.iss.rate'],
        },
        issWithheld: notApplicable,
        federalWithholding: notApplicable,
        cbs: notApplicable,
        ibs: notApplicable,
        specialTreatment: notApplicable,
        collectionWaived: false,
        rulesVersion: 'test',
        legalReferences: [],
      },
      legacyTaxes: {
        iss: { base: '1000.00', amount: '30.00', rate: '3.00' },
        issWithheld: false,
        issResponsible: 'PROVIDER',
        withholdings: [],
        netReceivableAmount: '1000.00',
      },
    });
    const response = toCalculationResponse({
      context,
      result: null,
      error: fiscalError({
        code: 'TAX_RATE_NOT_FOUND',
        message: 'rate',
        category: 'CONFIGURATION',
        details: { fields: ['customer'], missingFields: ['service.iss.rate'] },
      }),
    });
    expect(response.pendingFields.map((f) => f.field)).toEqual([
      'service.iss.rate',
      'customer',
    ]);
    expect(response.taxes.iss?.amount).toBe('30.00');
    expect(response.netReceivableAmount).toBe('1000.00');
  });
});
