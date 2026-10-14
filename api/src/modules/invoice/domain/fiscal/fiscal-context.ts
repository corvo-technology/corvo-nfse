import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { NormalizedInvoice } from './normalized-invoice';
import type { ServiceTaxClassification } from './classification/service-tax-classification';
import type { TaxApplicability } from './applicability/tax-applicability';
import type { LegacyTaxResult } from './legacy/legacy-tax-result';
import type { RtcTaxResult } from './rtc/rtc-tax-result';

export interface FiscalWarning {
  readonly code: string;
  readonly message: string;
  readonly step: string;
}

export interface StepTrace {
  readonly step: string;
  readonly status: 'applied' | 'skipped' | 'failed';
  readonly durationMs: number;
  readonly reason?: string;
  readonly errorCode?: string;
}

export interface FiscalContext {
  readonly invoice: NormalizedInvoice;
  readonly companyProfile?: CompanyFiscalProfile;
  readonly classification?: ServiceTaxClassification;
  readonly applicability?: TaxApplicability;
  readonly legacyTaxes?: LegacyTaxResult;
  readonly rtcTaxes?: RtcTaxResult;
  readonly warnings: readonly FiscalWarning[];
  readonly trace: readonly StepTrace[];
}

export const initialFiscalContext = (
  invoice: NormalizedInvoice,
): FiscalContext => ({
  invoice,
  warnings: [],
  trace: [],
});
