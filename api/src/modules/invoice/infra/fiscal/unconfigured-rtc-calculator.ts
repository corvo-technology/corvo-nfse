import { Injectable } from '@nestjs/common';
import { fiscalError, type FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import { err, type Result } from '@/modules/invoice/domain/fiscal/result';
import {
  RtcCalculatorPort,
  type RtcCalculationInput,
} from '@/modules/invoice/domain/fiscal/rtc/rtc-calculator.port';
import type { RtcTaxResult } from '@/modules/invoice/domain/fiscal/rtc/rtc-tax-result';

const STEP_NAME = 'RtcTaxCalculator';

const notConfigured = (operation: string): FiscalError =>
  fiscalError({
    code: 'TAX_CALCULATION_UNAVAILABLE',
    message: `The RTC calculator adapter is not configured (${operation})`,
    category: 'CONFIGURATION',
    step: STEP_NAME,
    details: { reason: 'adapter_not_configured', operation },
    retryable: false,
  });

/**
 * Placeholder binding for `RtcCalculatorPort` until the HTTP adapter of Spec 3
 * is wired. It fails with the exact `adapter_not_configured` marker the RTC
 * step recognises, so `warn` mode + Sefin tolerance still degrades gracefully
 * while `block` mode stops the invoice with a non-retryable configuration
 * error instead of calculating IBS/CBS with a made-up engine.
 */
@Injectable()
export class UnconfiguredRtcCalculator extends RtcCalculatorPort {
  health(): Promise<Result<{ available: true }, FiscalError>> {
    return Promise.resolve(err(notConfigured('health')));
  }

  version(): Promise<Result<string, FiscalError>> {
    return Promise.resolve(err(notConfigured('version')));
  }

  calculate(
    _input: RtcCalculationInput,
  ): Promise<Result<RtcTaxResult, FiscalError>> {
    return Promise.resolve(err(notConfigured('calculate')));
  }
}
