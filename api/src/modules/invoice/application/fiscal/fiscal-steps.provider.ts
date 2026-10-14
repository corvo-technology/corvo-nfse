import type { FiscalStep } from '@/modules/invoice/domain/fiscal/fiscal-step';
import { CompanyFiscalProfileStep } from './steps/company-fiscal-profile.step';
import { FiscalValidatorStep } from './steps/fiscal-validator.step';
import { LegacyTaxCalculatorStep } from './steps/legacy-tax-calculator.step';
import { RtcTaxCalculatorStep } from './steps/rtc-tax-calculator.step';
import { ServiceTaxClassifierStep } from './steps/service-tax-classifier.step';
import { TaxApplicabilityStep } from './steps/tax-applicability.step';

export const FISCAL_STEPS = 'FISCAL_STEPS';

/** Fixed fail-fast order: every step consumes the output of the previous ones. */
export const fiscalStepsProvider = {
  provide: FISCAL_STEPS,
  useFactory: (...steps: FiscalStep[]): readonly FiscalStep[] => steps,
  inject: [
    CompanyFiscalProfileStep,
    ServiceTaxClassifierStep,
    TaxApplicabilityStep,
    LegacyTaxCalculatorStep,
    RtcTaxCalculatorStep,
    FiscalValidatorStep,
  ],
};
