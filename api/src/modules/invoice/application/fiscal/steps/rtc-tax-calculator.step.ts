import { Injectable } from '@nestjs/common';
import type { Obligation } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { FiscalContext, FiscalWarning } from '@/modules/invoice/domain/fiscal/fiscal-context';
import { fiscalError, type FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { FiscalStep, StepOutcome } from '@/modules/invoice/domain/fiscal/fiscal-step';
import type { Decimal } from '@/modules/invoice/domain/fiscal/money';
import { toDecimal } from '@/modules/invoice/domain/fiscal/money';
import type { TaxTransitionPolicy } from '@/modules/invoice/domain/fiscal/policies/tax-transition.policy';
import {
  RtcCalculatorPort,
  type RtcCalculationInput,
} from '@/modules/invoice/domain/fiscal/rtc/rtc-calculator.port';
import type { RtcTaxResult } from '@/modules/invoice/domain/fiscal/rtc/rtc-tax-result';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import { IBS_CBS_TOLERATED_WARNING_CODE } from '@/modules/invoice/domain/fiscal/validation/fiscal-validator';

/** D1: what to do with a REQUIRED IBS/CBS obligation while the RTC adapter is unavailable. */
export type IbsCbsUnavailableMode = 'block' | 'warn';

const STEP_NAME = 'RtcTaxCalculator';

const isRequired = (obligation: Obligation): boolean => obligation.status === 'REQUIRED';

const notRequiredReason = (obligation: Obligation): string =>
  obligation.status === 'REQUIRED' ? '' : obligation.reason;

const isBlank = (value: string | null): boolean => value === null || value === '';

const tryDecimal = (value: string): Decimal | null => {
  try {
    const parsed = toDecimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
};

const isUnconfiguredAdapterError = (error: FiscalError): boolean =>
  error.code === 'TAX_CALCULATION_UNAVAILABLE' &&
  error.retryable === false &&
  error.details.reason === 'adapter_not_configured';

const inconsistentResult = (detail: string, message: string): FiscalError =>
  fiscalError({
    code: 'FISCAL_VALIDATION_FAILED',
    message,
    category: 'CALCULATION',
    step: STEP_NAME,
    details: { reason: 'rtc_inconsistent_result', detail },
    retryable: false,
  });

/**
 * Rejects engine responses that cannot be trusted before they reach the
 * fiscal context: unparseable decimals, negative amounts, bases above the
 * gross amount and IBS components that do not sum to the declared total.
 * Returns the FiscalError to propagate, or null when the result is sound.
 */
export function assertRtcResultConsistent(
  result: RtcTaxResult,
  gross: Decimal,
): FiscalError | null {
  const components = {
    cbs: result.cbs,
    ibsState: result.ibsState,
    ibsCity: result.ibsCity,
    ibsTotal: result.ibsTotal,
  };
  for (const [name, component] of Object.entries(components)) {
    if (component === null) continue;
    const amount = tryDecimal(component.amount);
    const base = tryDecimal(component.base);
    if (amount === null || base === null) {
      return inconsistentResult(
        'invalid_decimal',
        `RTC engine returned a non-decimal ${name} component`,
      );
    }
    if (amount.isNegative()) {
      return inconsistentResult(
        'negative_amount',
        `RTC engine returned a negative ${name} amount`,
      );
    }
    if (base.greaterThan(gross)) {
      return inconsistentResult(
        'base_exceeds_gross',
        `RTC engine ${name} base is greater than the gross amount`,
      );
    }
  }
  if (result.ibsTotal !== null && result.ibsState !== null && result.ibsCity !== null) {
    const total = tryDecimal(result.ibsTotal.amount);
    const state = tryDecimal(result.ibsState.amount);
    const city = tryDecimal(result.ibsCity.amount);
    if (total === null || state === null || city === null) {
      return inconsistentResult('invalid_decimal', 'RTC engine returned a non-decimal IBS component');
    }
    if (!total.eq(state.plus(city))) {
      return inconsistentResult(
        'ibs_components_mismatch',
        `RTC engine IBS components (${state.toFixed(2)} + ${city.toFixed(2)}) do not sum to the declared total (${total.toFixed(2)})`,
      );
    }
  }
  return null;
}

/**
 * Calls the RTC engine for invoices with a REQUIRED IBS/CBS obligation. The
 * engine produces the rates and amounts; this step never fabricates them.
 * With the adapter unconfigured, D1 decides: `block` propagates
 * TAX_CALCULATION_UNAVAILABLE (non retryable); `warn` continues with the
 * IBS_CBS_NOT_DECLARED_TOLERATED warning while the Sefin tolerance window
 * (until 2026-12-31) holds.
 */
@Injectable()
export class RtcTaxCalculatorStep implements FiscalStep {
  readonly name = STEP_NAME;
  readonly required = false;

  constructor(
    private readonly rtc: RtcCalculatorPort,
    private readonly policy: TaxTransitionPolicy,
    private readonly mode: IbsCbsUnavailableMode,
  ) {}

  async execute(
    context: Readonly<FiscalContext>,
  ): Promise<Result<StepOutcome, FiscalError>> {
    const { applicability, classification, companyProfile } = context;
    if (applicability === undefined) {
      return err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message: 'RtcTaxCalculator requires the tax applicability produced by the previous step',
          category: 'INTERNAL',
          step: this.name,
          details: { reason: 'applicability_missing' },
        }),
      );
    }
    if (classification === undefined) {
      return err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message: 'RtcTaxCalculator requires the service tax classification produced by the previous step',
          category: 'INTERNAL',
          step: this.name,
          details: { reason: 'classification_missing' },
        }),
      );
    }
    if (companyProfile === undefined) {
      return err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message: 'RtcTaxCalculator requires the company fiscal profile produced by the first step',
          category: 'INTERNAL',
          step: this.name,
          details: { reason: 'company_profile_missing' },
        }),
      );
    }

    // NOT_APPLICABLE (regime excluded, e.g. MEI) and UNSUPPORTED (rules not
    // defined yet) never reach the engine; the fiscal validator re-checks
    // that a REQUIRED obligation always carries rtcTaxes.
    if (!isRequired(applicability.cbs) && !isRequired(applicability.ibs)) {
      return ok({
        status: 'skipped',
        context,
        reason: notRequiredReason(applicability.cbs) || notRequiredReason(applicability.ibs),
      });
    }

    // The classification step guarantees the four RTC codes when IBS/CBS is
    // REQUIRED; a blank value here means the pipeline was assembled wrong.
    const missingFields = (
      [
        ['nbsCode', classification.nbsCode],
        ['cst', classification.cst],
        ['classCode', classification.classCode],
        ['operationIndicator', classification.operationIndicator],
      ] as const
    )
      .filter(([, value]) => isBlank(value))
      .map(([field]) => field);
    if (missingFields.length > 0) {
      return err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message: 'RtcTaxCalculator requires a complete classification (nbsCode, cst, classCode and operationIndicator)',
          category: 'INTERNAL',
          step: this.name,
          details: { reason: 'classification_incomplete', missingFields },
        }),
      );
    }

    const input: RtcCalculationInput = {
      competenceDate: context.invoice.competenceDate,
      grossAmount: context.invoice.grossAmount,
      discountAmount: context.invoice.discountAmount,
      serviceCode: classification.serviceCode,
      nbsCode: classification.nbsCode ?? '',
      cst: classification.cst ?? '',
      classCode: classification.classCode ?? '',
      operationIndicator: classification.operationIndicator ?? '',
      providerTaxId: context.invoice.company.taxId,
      providerMunicipalityCode: context.invoice.company.municipalityCode,
      incidenceMunicipalityCode:
        classification.iss.incidenceMunicipalityCode ?? context.invoice.service.municipalityCode,
      customer: context.invoice.customer,
      regime: companyProfile.taxRegime,
    };

    const result = await this.rtc.calculate(input);
    if (!result.ok) {
      const tolerated =
        isUnconfiguredAdapterError(result.error) &&
        this.mode === 'warn' &&
        this.policy
          .ibsCbsInformation(classification.serviceCode, context.invoice.competenceDate)
          .toleratedBySefin;
      if (tolerated) {
        const warning: FiscalWarning = {
          code: IBS_CBS_TOLERATED_WARNING_CODE,
          message:
            'IBS/CBS não informados no RTC: orientação da SEF/CGNFS-e de 07/08/2026 aceita a ausência de rejeição até 31/12/2026',
          step: this.name,
        };
        return ok({
          status: 'applied',
          context: { ...context, warnings: [...context.warnings, warning] },
        });
      }
      return err(result.error);
    }

    const inconsistency = assertRtcResultConsistent(
      result.value,
      toDecimal(context.invoice.grossAmount),
    );
    if (inconsistency !== null) return err(inconsistency);

    return ok({ status: 'applied', context: { ...context, rtcTaxes: result.value } });
  }
}
