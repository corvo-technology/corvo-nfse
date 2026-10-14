import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { TaxApplicability } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { FiscalContext, FiscalWarning, StepTrace } from '@/modules/invoice/domain/fiscal/fiscal-context';
import { initialFiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import type { LegacyTaxResult } from '@/modules/invoice/domain/fiscal/legacy/legacy-tax-result';
import type { NormalizedInvoice } from '@/modules/invoice/domain/fiscal/normalized-invoice';
import type { RtcTaxResult } from '@/modules/invoice/domain/fiscal/rtc/rtc-tax-result';

export interface ContextForOptions {
  /** Partial overrides of the normalized invoice (top-level, company and service are deep-merged). */
  readonly invoice?: Partial<NormalizedInvoice>;
  readonly companyProfile?: CompanyFiscalProfile;
  readonly classification?: ServiceTaxClassification;
  readonly applicability?: TaxApplicability;
  readonly legacyTaxes?: LegacyTaxResult;
  readonly rtcTaxes?: RtcTaxResult;
  readonly warnings?: readonly FiscalWarning[];
  readonly trace?: readonly StepTrace[];
}

export const defaultInvoice = (
  overrides: Partial<NormalizedInvoice> = {},
): NormalizedInvoice => {
  const base: NormalizedInvoice = {
    invoiceId: 'inv-1',
    tenantId: 'ten-1',
    environment: 'test',
    company: {
      id: 'comp-1',
      taxId: '11222330000181',
      municipalityCode: '3550308',
      municipalRegistration: null,
    },
    competenceDate: '2026-10-13',
    grossAmount: '1000.00',
    discountAmount: '0.00',
    service: {
      code: '010101',
      municipalityCode: '3550308',
      description: null,
      fiscal: null,
      serviceProfileId: null,
    },
    customer: { kind: 'CNPJ', taxId: '12345678000199', municipalityCode: '3550308' },
  };
  return {
    ...base,
    ...overrides,
    company: { ...base.company, ...overrides.company },
    service: { ...base.service, ...overrides.service },
  };
};

/** Builds a complete FiscalContext with sensible defaults for unit tests. */
export const contextFor = (overrides: ContextForOptions = {}): FiscalContext => ({
  ...initialFiscalContext(defaultInvoice(overrides.invoice)),
  ...(overrides.companyProfile !== undefined ? { companyProfile: overrides.companyProfile } : {}),
  ...(overrides.classification !== undefined ? { classification: overrides.classification } : {}),
  ...(overrides.applicability !== undefined ? { applicability: overrides.applicability } : {}),
  ...(overrides.legacyTaxes !== undefined ? { legacyTaxes: overrides.legacyTaxes } : {}),
  ...(overrides.rtcTaxes !== undefined ? { rtcTaxes: overrides.rtcTaxes } : {}),
  ...(overrides.warnings !== undefined ? { warnings: overrides.warnings } : {}),
  ...(overrides.trace !== undefined ? { trace: overrides.trace } : {}),
});


