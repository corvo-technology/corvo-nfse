import type { TaxRegimeKind } from '@/modules/company/domain/fiscal-profile';
import type { TaxApplicability } from '../../domain/fiscal/applicability/tax-applicability';
import type { ServiceTaxClassification } from '../../domain/fiscal/classification/service-tax-classification';
import type {
  FiscalContext,
  FiscalWarning,
  StepTrace,
} from '../../domain/fiscal/fiscal-context';
import type { FiscalError } from '../../domain/fiscal/fiscal-error';
import type {
  CalculatedTaxes,
  CalculationSource,
  FiscalCalculationResult,
} from '../../domain/fiscal/fiscal-calculation-result';
import type { WithholdingAmount } from '../../domain/fiscal/legacy/legacy-tax-result';
import { calculationSourceOf } from '../../domain/fiscal/result-builder';

export const CALCULATION_DISCLAIMER =
  'Cálculo pré-emissão. Os valores não constituem documento fiscal e podem divergir da validação final da Sefin.';
export interface InvoiceCalculationResponse {
  preEmission: true;
  status: 'ready' | 'blocked';
  disclaimer: string;
  competenceDate: string;
  taxRegime: TaxRegimeKind | null;
  classification: ServiceTaxClassification | null;
  applicability: TaxApplicability | null;
  taxes: CalculatedTaxes;
  withholdings: readonly WithholdingAmount[];
  netReceivableAmount: string | null;
  collectionWaived: boolean | null;
  calculation: {
    source: CalculationSource;
    calculatorVersion: string | null;
    rulesVersion: string | null;
    legalReferences: readonly string[];
  } | null;
  warnings: readonly FiscalWarning[];
  pendingFields: Array<{ field: string; reason: string }>;
  blocking: FiscalError | null;
  trace: readonly StepTrace[];
}
export interface PartialFiscalCalculation {
  context: FiscalContext;
  error: FiscalError | null;
  result: FiscalCalculationResult | null;
}
const stringFields = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

/** Only public diagnostic fields cross the HTTP boundary; never arbitrary provider payloads. */
function publicBlocking(
  error: FiscalError | null,
  context: FiscalContext,
): FiscalError | null {
  if (error === null) return null;
  const taxId = context.invoice.customer?.taxId;
  const redact = (value: string): string =>
    taxId ? value.split(taxId).join('[redacted]') : value;
  const details: Record<string, unknown> = {};
  for (const key of [
    'missingFields',
    'fields',
    'reason',
    'tax',
    'serviceCode',
    'reviewStatus',
    'profileId',
    'serviceProfileId',
  ]) {
    const value = error.details[key];
    if (typeof value === 'string') details[key] = redact(value);
    else if (Array.isArray(value))
      details[key] = stringFields(value).map(redact);
    else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    )
      details[key] = value;
  }
  return {
    code: error.code,
    message: redact(error.message),
    step: error.step,
    category: error.category,
    retryable: error.retryable,
    details,
  };
}

export function toCalculationResponse({
  context,
  error,
  result,
}: PartialFiscalCalculation): InvoiceCalculationResponse {
  const pending = new Map<string, string>();
  for (const field of [
    ...stringFields(error?.details.missingFields),
    ...stringFields(error?.details.fields),
  ])
    pending.set(field, error?.message ?? 'Required configuration');
  const applicability = context.applicability;
  if (applicability) {
    for (const tax of [
      'iss',
      'issWithheld',
      'federalWithholding',
      'cbs',
      'ibs',
      'specialTreatment',
    ] as const) {
      const obligation = applicability[tax];
      if (obligation.status === 'MISSING_CONFIGURATION') {
        for (const field of obligation.missingFields)
          if (!pending.has(field)) pending.set(field, obligation.reason);
      }
    }
  }
  const legacy = context.legacyTaxes;
  const rtc = context.rtcTaxes;
  const taxes: CalculatedTaxes = result?.taxes ?? {
    ...(legacy?.iss ? { iss: legacy.iss } : {}),
    ...(rtc?.cbs ? { cbs: rtc.cbs } : {}),
    ...(rtc?.ibsState ? { ibsState: rtc.ibsState } : {}),
    ...(rtc?.ibsCity ? { ibsCity: rtc.ibsCity } : {}),
    ...(rtc?.ibsTotal ? { ibsTotal: rtc.ibsTotal } : {}),
  };
  const references = [
    ...new Set([
      ...(applicability?.legalReferences ?? []),
      ...(rtc?.legalReferences ?? []),
    ]),
  ];
  return {
    preEmission: true,
    status: error === null ? 'ready' : 'blocked',
    disclaimer: CALCULATION_DISCLAIMER,
    competenceDate: context.invoice.competenceDate,
    taxRegime: context.companyProfile?.taxRegime ?? null,
    classification: context.classification ?? null,
    applicability: applicability ?? null,
    taxes,
    withholdings: result?.withholdings ?? legacy?.withholdings ?? [],
    netReceivableAmount:
      result?.netReceivableAmount ?? legacy?.netReceivableAmount ?? null,
    collectionWaived:
      result?.collectionWaived ?? applicability?.collectionWaived ?? null,
    calculation:
      applicability || legacy || rtc
        ? {
            source: result?.calculationSource ?? calculationSourceOf(context),
            calculatorVersion: rtc?.calculatorVersion ?? null,
            rulesVersion: applicability?.rulesVersion ?? null,
            legalReferences: references,
          }
        : null,
    warnings: result?.warnings ?? context.warnings,
    pendingFields: [...pending].map(([field, reason]) => ({ field, reason })),
    blocking: publicBlocking(error, context),
    trace: context.trace.map(({ step, status, durationMs, reason }) => ({
      step,
      status,
      durationMs,
      ...(reason === undefined ? {} : { reason }),
    })),
  };
}
