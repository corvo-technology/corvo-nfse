import type { FiscalContext } from './fiscal-context';
import { fiscalError, type FiscalError } from './fiscal-error';
import type {
  CalculationSource,
  FiscalCalculationResult,
} from './fiscal-calculation-result';
import { moneyString, toDecimal } from './money';
import { err, ok, type Result } from './result';
import {
  IBS_CBS_TOLERATED_WARNING_CODE,
  validateFiscalContext,
} from './validation/fiscal-validator';

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
};

const uniqueReferences = (
  primary: readonly string[],
  extra: readonly string[],
): readonly string[] => {
  const seen = new Set(primary);
  return [...primary, ...extra.filter((reference) => !seen.has(reference))];
};

export const calculationSourceOf = (
  context: FiscalContext,
): CalculationSource => {
  const hasLegacy = context.legacyTaxes !== undefined;
  const hasRtc = context.rtcTaxes !== undefined;
  if (hasLegacy && hasRtc) return 'legacy+rtc';
  if (hasLegacy) return 'legacy';
  if (hasRtc) return 'rtc';
  return 'none';
};

/**
 * A result is marked for review when a REVIEW_* warning was raised, when IBS/CBS was
 * tolerated by Sefin, when the fiscal profile is not approved (or the regime is not
 * supported by the fiscal rules), when the applicability demands a special treatment
 * and during the 2027 IBS/CBS transition year.
 */
export const requiresReviewOf = (context: FiscalContext): boolean => {
  const { warnings, companyProfile, applicability } = context;
  if (warnings.some((warning) => warning.code.startsWith('REVIEW')))
    return true;
  if (
    warnings.some((warning) => warning.code === IBS_CBS_TOLERATED_WARNING_CODE)
  )
    return true;
  if (companyProfile !== undefined) {
    if (companyProfile.reviewStatus !== 'approved') return true;
    if (
      companyProfile.taxRegime === 'OUTRO_REGIME' ||
      companyProfile.taxRegime === 'UNKNOWN'
    ) {
      return true;
    }
  }
  if (
    applicability !== undefined &&
    applicability.specialTreatment.status !== 'NOT_APPLICABLE'
  ) {
    return true;
  }
  const date = context.invoice.competenceDate;
  return date >= '2027-01-01' && date < '2028-01-01';
};

export function buildFiscalCalculationResult(
  context: FiscalContext,
): Result<FiscalCalculationResult, FiscalError> {
  const { errors, warnings } = validateFiscalContext(context);
  if (errors.length > 0) {
    return err(
      fiscalError({
        code: 'FISCAL_VALIDATION_FAILED',
        message: `The fiscal context failed validation with ${errors.length} issue(s)`,
        category: 'VALIDATION',
        step: 'FiscalValidator',
        details: { issues: errors },
      }),
    );
  }

  const {
    companyProfile,
    classification,
    applicability,
    legacyTaxes,
    rtcTaxes,
  } = context;
  if (
    companyProfile === undefined ||
    classification === undefined ||
    applicability === undefined
  ) {
    return err(
      fiscalError({
        code: 'FISCAL_INTERNAL_ERROR',
        message:
          'A validated fiscal context must carry the company profile, the classification and the applicability',
        category: 'INTERNAL',
        step: 'FiscalValidator',
        details: { reason: 'validated_context_incomplete' },
      }),
    );
  }

  const gross = toDecimal(context.invoice.grossAmount);
  const discount = toDecimal(context.invoice.discountAmount);

  const result: FiscalCalculationResult = {
    operationId: context.invoice.invoiceId,
    companyId: context.invoice.company.id,
    competenceDate: context.invoice.competenceDate,
    taxRegime: companyProfile.taxRegime,
    profileId: companyProfile.id,
    classification,
    taxableAmounts: {
      gross: context.invoice.grossAmount,
      discount: context.invoice.discountAmount,
      ...(legacyTaxes !== undefined && legacyTaxes.iss !== null
        ? { iss: legacyTaxes.iss.base }
        : {}),
      ...(rtcTaxes !== undefined && rtcTaxes.cbs !== null
        ? { ibsCbs: rtcTaxes.cbs.base }
        : {}),
    },
    taxes: {
      ...(legacyTaxes !== undefined && legacyTaxes.iss !== null
        ? { iss: legacyTaxes.iss }
        : {}),
      ...(rtcTaxes !== undefined && rtcTaxes.cbs !== null
        ? { cbs: rtcTaxes.cbs }
        : {}),
      ...(rtcTaxes !== undefined && rtcTaxes.ibsState !== null
        ? { ibsState: rtcTaxes.ibsState }
        : {}),
      ...(rtcTaxes !== undefined && rtcTaxes.ibsCity !== null
        ? { ibsCity: rtcTaxes.ibsCity }
        : {}),
      ...(rtcTaxes !== undefined && rtcTaxes.ibsTotal !== null
        ? { ibsTotal: rtcTaxes.ibsTotal }
        : {}),
    },
    withholdings: legacyTaxes !== undefined ? legacyTaxes.withholdings : [],
    netReceivableAmount:
      legacyTaxes !== undefined
        ? legacyTaxes.netReceivableAmount
        : moneyString(gross.minus(discount)),
    applicability,
    collectionWaived: applicability.collectionWaived,
    calculationSource: calculationSourceOf(context),
    calculatorVersion:
      rtcTaxes !== undefined ? rtcTaxes.calculatorVersion : null,
    catalogVersions: classification.catalogVersions,
    rulesVersion: applicability.rulesVersion,
    legalReferences: uniqueReferences(
      applicability.legalReferences,
      rtcTaxes !== undefined ? rtcTaxes.legalReferences : [],
    ),
    warnings,
    requiresReview: requiresReviewOf(context),
    trace: context.trace,
    calculationMemory: rtcTaxes !== undefined ? rtcTaxes.calculationMemory : [],
  };

  return ok(deepFreeze(result));
}
