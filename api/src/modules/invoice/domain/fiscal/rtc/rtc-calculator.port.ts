import type { TaxRegimeKind } from '@/modules/company/domain/fiscal-profile';
import type { FiscalError } from '../fiscal-error';
import type { DecimalString } from '../money';
import type { FiscalCustomer } from '../normalized-invoice';
import type { Result } from '../result';
import type { RtcTaxResult } from './rtc-tax-result';

/**
 * Everything the RTC engine needs to calculate IBS/CBS for one invoice. The
 * classification codes are guaranteed complete by the classification step
 * before the port is called (a REQUIRED IBS/CBS obligation implies them).
 */
export interface RtcCalculationInput {
  /** Fato gerador, YYYY-MM-DD. */
  readonly competenceDate: string;
  readonly grossAmount: DecimalString;
  readonly discountAmount: DecimalString;
  readonly serviceCode: string;
  readonly nbsCode: string;
  readonly cst: string;
  readonly classCode: string;
  readonly operationIndicator: string;
  readonly providerTaxId: string;
  readonly providerMunicipalityCode: string;
  readonly incidenceMunicipalityCode: string;
  readonly customer: FiscalCustomer | null;
  readonly regime: TaxRegimeKind;
}

/**
 * Domain port for the Calculadora RTC. Implemented in production by the HTTP
 * adapter of Spec 3 and by `FakeRtcCalculator` in tests. Domain-only on
 * purpose: no framework, transport or SDK types may leak into this contract.
 */
export abstract class RtcCalculatorPort {
  abstract health(): Promise<Result<{ available: true }, FiscalError>>;

  abstract version(): Promise<Result<string, FiscalError>>;

  abstract calculate(
    input: RtcCalculationInput,
  ): Promise<Result<RtcTaxResult, FiscalError>>;
}
