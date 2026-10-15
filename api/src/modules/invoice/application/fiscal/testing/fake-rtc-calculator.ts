import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import {
  moneyString,
  percentOf,
  toDecimal,
} from '@/modules/invoice/domain/fiscal/money';
import { ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import {
  RtcCalculatorPort,
  type RtcCalculationInput,
} from '@/modules/invoice/domain/fiscal/rtc/rtc-calculator.port';
import type { RtcTaxResult } from '@/modules/invoice/domain/fiscal/rtc/rtc-tax-result';

export const FAKE_RTC_VERSION = 'fake-2026.1';

const CBS_TEST_PHASE_PERCENT = '0.9';
const IBS_TEST_PHASE_PERCENT = '0.1';

export interface FakeRtcCalculatorOptions {
  readonly version?: string;
  readonly handler?: (
    input: RtcCalculationInput,
  ) => Result<RtcTaxResult, FiscalError>;
}

/**
 * In-memory RTC calculator for unit and integration tests. The default
 * calculation simulates the 2026 test phase of LC 214/2025 (CBS 0,9%, IBS
 * 0,1%, state component zero, collection waived) over gross minus discount.
 * It is a test double: never wire it in production.
 */
export class FakeRtcCalculator extends RtcCalculatorPort {
  /** Every input received by `calculate`, in order. */
  readonly calls: RtcCalculationInput[] = [];

  private readonly options: FakeRtcCalculatorOptions;

  constructor(options: FakeRtcCalculatorOptions = {}) {
    super();
    this.options = options;
  }

  async health(): Promise<Result<{ available: true }, FiscalError>> {
    return ok({ available: true });
  }

  async version(): Promise<Result<string, FiscalError>> {
    return ok(this.options.version ?? FAKE_RTC_VERSION);
  }

  async calculate(
    input: RtcCalculationInput,
  ): Promise<Result<RtcTaxResult, FiscalError>> {
    this.calls.push(input);
    if (this.options.handler !== undefined) return this.options.handler(input);
    return ok(this.testPhase2026(input));
  }

  private testPhase2026(input: RtcCalculationInput): RtcTaxResult {
    const base = moneyString(
      toDecimal(input.grossAmount).minus(toDecimal(input.discountAmount)),
    );
    const baseDecimal = toDecimal(base);
    const cbsAmount = moneyString(
      percentOf(baseDecimal, toDecimal(CBS_TEST_PHASE_PERCENT)),
    );
    const ibsAmount = moneyString(
      percentOf(baseDecimal, toDecimal(IBS_TEST_PHASE_PERCENT)),
    );
    return {
      calculatorVersion: this.options.version ?? FAKE_RTC_VERSION,
      cbs: { base, rate: CBS_TEST_PHASE_PERCENT, amount: cbsAmount },
      ibsState: { base, rate: '0', amount: '0.00' },
      ibsCity: { base, rate: IBS_TEST_PHASE_PERCENT, amount: ibsAmount },
      ibsTotal: { base, rate: IBS_TEST_PHASE_PERCENT, amount: ibsAmount },
      legalReferences: ['LC 214/2025'],
      calculationMemory: [{ source: 'fake-rtc' }],
      collectionWaived: true,
    };
  }
}
