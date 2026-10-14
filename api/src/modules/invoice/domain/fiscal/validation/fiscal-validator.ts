import { Decimal } from '@/shared/types/money';
import type { FiscalContext, FiscalWarning } from '../fiscal-context';
import { moneyString } from '../money';

export interface FiscalIssueLike {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface FiscalContextValidation {
  readonly errors: FiscalIssueLike[];
  readonly warnings: FiscalWarning[];
}

/** Warning emitted by the RTC step when IBS/CBS was not declared inside the Sefin tolerance window. */
export const IBS_CBS_TOLERATED_WARNING_CODE = 'IBS_CBS_NOT_DECLARED_TOLERATED';

const COMPETENCE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const tryDecimal = (value: string): Decimal | null => {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
};

const isValidCompetenceDate = (date: string): boolean => {
  if (!COMPETENCE_DATE_PATTERN.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

const moneyIssue = (field: string, value: string): FiscalIssueLike | null => {
  const parsed = tryDecimal(value);
  if (parsed === null) {
    return {
      field,
      code: 'INVALID_DECIMAL_AMOUNT',
      message: `${field} must be a valid decimal string, received "${value}"`,
    };
  }
  if (parsed.decimalPlaces() > 2) {
    return {
      field,
      code: 'INVALID_DECIMAL_AMOUNT',
      message: `${field} must have at most 2 decimal places, received "${value}"`,
    };
  }
  return null;
};

const pushMoneyIssue = (errors: FiscalIssueLike[], field: string, value: string): void => {
  const issue = moneyIssue(field, value);
  if (issue !== null) errors.push(issue);
};

const hasSefinToleranceWarning = (warnings: readonly FiscalWarning[]): boolean =>
  warnings.some((warning) => warning.code === IBS_CBS_TOLERATED_WARNING_CODE);

const isBlank = (value: string | null): boolean => value === null || value === '';

export function validateFiscalContext(context: FiscalContext): FiscalContextValidation {
  const errors: FiscalIssueLike[] = [];
  const { invoice, companyProfile, classification, applicability, legacyTaxes, rtcTaxes } = context;

  if (!isValidCompetenceDate(invoice.competenceDate)) {
    errors.push({
      field: 'competenceDate',
      code: 'INVALID_COMPETENCE_DATE',
      message: `competenceDate must be a valid YYYY-MM-DD date, received "${invoice.competenceDate}"`,
    });
  }
  pushMoneyIssue(errors, 'invoice.grossAmount', invoice.grossAmount);
  pushMoneyIssue(errors, 'invoice.discountAmount', invoice.discountAmount);

  if (companyProfile === undefined) {
    errors.push({
      field: 'companyProfile',
      code: 'FISCAL_PROFILE_MISSING',
      message: 'The fiscal context carries no effective company fiscal profile',
    });
  }
  if (classification === undefined) {
    errors.push({
      field: 'classification',
      code: 'FISCAL_CLASSIFICATION_REQUIRED',
      message: 'The fiscal context carries no service tax classification',
    });
  }
  if (applicability === undefined) {
    errors.push({
      field: 'applicability',
      code: 'TAX_APPLICABILITY_UNKNOWN',
      message: 'The fiscal context carries no tax applicability',
    });
  }

  if (classification !== undefined) {
    if (classification.serviceCode !== invoice.service.code) {
      errors.push({
        field: 'service.code',
        code: 'FISCAL_CLASSIFICATION_INVALID',
        message: `The classified service code ${classification.serviceCode} does not match the invoiced service code ${invoice.service.code}`,
      });
    }
    const hasAnyCode = !isBlank(classification.classCode) || !isBlank(classification.cst);
    if (hasAnyCode || classification.catalogValidated) {
      if (isBlank(classification.classCode)) {
        errors.push({
          field: 'classification.classCode',
          code: 'FISCAL_CLASSIFICATION_INVALID',
          message: 'classCode must be present and non-empty for the classification to be consistent',
        });
      }
      if (isBlank(classification.cst)) {
        errors.push({
          field: 'classification.cst',
          code: 'FISCAL_CLASSIFICATION_INVALID',
          message: 'cst must be present and non-empty for the classification to be consistent',
        });
      }
      if (isBlank(classification.operationIndicator)) {
        errors.push({
          field: 'classification.operationIndicator',
          code: 'FISCAL_CLASSIFICATION_INVALID',
          message: 'operationIndicator must be present and non-empty for the classification to be consistent',
        });
      }
    }
  }

  if (legacyTaxes !== undefined) {
    if (legacyTaxes.iss !== null) {
      pushMoneyIssue(errors, 'legacyTaxes.iss.base', legacyTaxes.iss.base);
      pushMoneyIssue(errors, 'legacyTaxes.iss.amount', legacyTaxes.iss.amount);
    }
    legacyTaxes.withholdings.forEach((withholding, index) => {
      pushMoneyIssue(errors, `legacyTaxes.withholdings[${index}].base`, withholding.base);
      pushMoneyIssue(errors, `legacyTaxes.withholdings[${index}].amount`, withholding.amount);
    });
    pushMoneyIssue(errors, 'legacyTaxes.netReceivableAmount', legacyTaxes.netReceivableAmount);
  }

  if (rtcTaxes !== undefined) {
    const rts = {
      cbs: rtcTaxes.cbs,
      ibsState: rtcTaxes.ibsState,
      ibsCity: rtcTaxes.ibsCity,
      ibsTotal: rtcTaxes.ibsTotal,
    } as const;
    for (const [tax, amount] of Object.entries(rts)) {
      if (amount !== null) {
        pushMoneyIssue(errors, `rtcTaxes.${tax}.base`, amount.base);
        pushMoneyIssue(errors, `rtcTaxes.${tax}.amount`, amount.amount);
      }
    }
  }

  if (applicability !== undefined) {
    const ibscbsRequired =
      applicability.cbs.status === 'REQUIRED' || applicability.ibs.status === 'REQUIRED';
    if (ibscbsRequired && rtcTaxes === undefined && !hasSefinToleranceWarning(context.warnings)) {
      errors.push({
        field: 'rtcTaxes',
        code: 'TAX_CALCULATION_UNAVAILABLE',
        message: 'IBS/CBS is required but the context carries no RTC calculation nor the Sefin tolerance warning',
      });
    }
    if (applicability.iss.status === 'REQUIRED') {
      if (legacyTaxes === undefined || legacyTaxes.iss === null) {
        errors.push({
          field: 'legacyTaxes.iss',
          code: 'TAX_CALCULATION_UNAVAILABLE',
          message: 'ISS is required but the context carries no calculated ISS amount',
        });
      } else {
        const gross = tryDecimal(invoice.grossAmount);
        const discount = tryDecimal(invoice.discountAmount);
        const issBase = tryDecimal(legacyTaxes.iss.base);
        if (gross !== null && discount !== null && issBase !== null && !issBase.eq(gross.minus(discount))) {
          errors.push({
            field: 'legacyTaxes.iss.base',
            code: 'ISS_BASE_MISMATCH',
            message: `The ISS base must equal gross minus discount (${moneyString(gross.minus(discount))}), received "${legacyTaxes.iss.base}"`,
          });
        }
      }
    }
  }

  if (companyProfile !== undefined) {
    const isMei = companyProfile.taxRegime === 'MEI';
    const isSimples = companyProfile.taxRegime === 'SIMPLES_NACIONAL';
    if (isMei || isSimples) {
      if (legacyTaxes !== undefined && legacyTaxes.iss !== null) {
        errors.push({
          field: 'legacyTaxes.iss',
          code: 'TAX_CALCULATION_UNSUPPORTED',
          message: `${companyProfile.taxRegime} must not carry a calculated ISS amount`,
        });
      }
      const ibscbsAllowedBySimplesOption = isSimples && companyProfile.ibsCbsRegularOption === true;
      if (rtcTaxes !== undefined && !ibscbsAllowedBySimplesOption) {
        errors.push({
          field: 'rtcTaxes',
          code: 'TAX_CALCULATION_UNSUPPORTED',
          message: `${companyProfile.taxRegime} must not carry RTC IBS/CBS taxes in the current fiscal phase`,
        });
      }
    }
  }

  if (legacyTaxes !== undefined && legacyTaxes.withholdings.length > 0) {
    const gross = tryDecimal(invoice.grossAmount);
    const discount = tryDecimal(invoice.discountAmount);
    if (gross !== null && discount !== null) {
      const total = legacyTaxes.withholdings.reduce<Decimal>((acc, withholding) => {
        const amount = tryDecimal(withholding.amount);
        return amount === null ? acc : acc.plus(amount);
      }, new Decimal(0));
      if (total.gt(gross.minus(discount))) {
        errors.push({
          field: 'withholdings',
          code: 'WITHHOLDINGS_EXCEED_NET',
          message: `The withheld total ${total.toFixed(2)} exceeds the discounted base ${gross.minus(discount).toFixed(2)}`,
        });
      }
    }
  }

  return { errors, warnings: [...context.warnings] };
}
