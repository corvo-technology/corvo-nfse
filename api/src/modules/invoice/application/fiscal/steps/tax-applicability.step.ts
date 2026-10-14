import { Injectable } from '@nestjs/common';
import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { TaxApplicability } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { FiscalContext } from '@/modules/invoice/domain/fiscal/fiscal-context';
import { fiscalError, type FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { FiscalStep, StepOutcome } from '@/modules/invoice/domain/fiscal/fiscal-step';
import type { TaxTransitionPolicy } from '@/modules/invoice/domain/fiscal/policies/tax-transition.policy';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import type { TaxStrategyResolver } from '../strategies/tax-strategy.resolver';

type TaxApplicabilityPlan = Omit<
  TaxApplicability,
  'strategy' | 'rulesVersion' | 'legalReferences'
>;

/** Obligation keys in the order the UNSUPPORTED/MISSING_CONFIGURATION blocks are scanned. */
const OBLIGATION_TAXES = ['iss', 'issWithheld', 'federalWithholding', 'cbs', 'ibs'] as const;
type ObligationTax = (typeof OBLIGATION_TAXES)[number];

const ISS_RATE_FIELD = 'service.iss.rate';

const coversDate = (
  rule: { readonly validFrom: string; readonly validUntil: string | null },
  date: string,
): boolean => rule.validFrom <= date && (rule.validUntil === null || date <= rule.validUntil);

@Injectable()
export class TaxApplicabilityStep implements FiscalStep {
  readonly name = 'TaxApplicabilityResolver';
  readonly required = true;

  constructor(
    private readonly resolver: TaxStrategyResolver,
    private readonly policy: TaxTransitionPolicy,
  ) {}

  async execute(context: Readonly<FiscalContext>): Promise<Result<StepOutcome, FiscalError>> {
    const { invoice, companyProfile, classification } = context;
    if (companyProfile === undefined) {
      return err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message:
            'TaxApplicability requires the company fiscal profile produced by the previous step',
          category: 'INTERNAL',
          step: this.name,
          details: { reason: 'company_profile_missing' },
        }),
      );
    }
    if (classification === undefined) {
      return err(
        fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message:
            'TaxApplicability requires the service tax classification produced by the previous step',
          category: 'INTERNAL',
          step: this.name,
          details: { reason: 'classification_missing' },
        }),
      );
    }

    const resolved = this.resolver.resolve(companyProfile, invoice.competenceDate);
    if (!resolved.ok) return err(this.withStep(resolved.error));
    const strategy = resolved.value;

    const planned = strategy.plan({
      invoice,
      profile: companyProfile,
      classification,
      policy: this.policy,
    });
    if (!planned.ok) return err(this.withStep(planned.error));

    const blocked = this.evaluateBlocks(planned.value, classification, invoice.customer);
    if (blocked !== null) return err(blocked);

    const applicability: TaxApplicability = {
      ...planned.value,
      strategy: strategy.name,
      rulesVersion: this.policy.rulesVersion,
      legalReferences: this.collectLegalReferences(
        companyProfile,
        invoice.service.code,
        invoice.competenceDate,
      ),
    };
    return ok({ status: 'applied', context: { ...context, applicability } });
  }

  /** Blocking checks in plan order: customer, UNSUPPORTED, MISSING_CONFIGURATION, IBS/CBS classification. */
  private evaluateBlocks(
    plan: TaxApplicabilityPlan,
    classification: ServiceTaxClassification,
    customer: FiscalContext['invoice']['customer'],
  ): FiscalError | null {
    if (plan.customerRequired && customer === null) {
      return fiscalError({
        code: 'FISCAL_VALIDATION_FAILED',
        message: 'This regime requires an identified customer (tomador) on the NFS-e',
        category: 'VALIDATION',
        step: this.name,
        details: { fields: ['customer'] },
      });
    }

    const unsupported = this.firstObligation(plan, (obligation) => obligation.status === 'UNSUPPORTED');
    if (unsupported !== null && unsupported.obligation.status === 'UNSUPPORTED') {
      return fiscalError({
        code: 'TAX_CALCULATION_UNSUPPORTED',
        message: `Tax "${unsupported.tax}" is not supported for this operation: ${unsupported.obligation.reason}`,
        category: 'UNSUPPORTED',
        step: this.name,
        details: { tax: unsupported.tax, reason: unsupported.obligation.reason },
      });
    }
    if (plan.specialTreatment.status === 'UNSUPPORTED') {
      return fiscalError({
        code: 'FISCAL_REVIEW_REQUIRED',
        message: plan.specialTreatment.reason,
        category: 'UNSUPPORTED',
        step: this.name,
        details: { tax: 'specialTreatment', reason: plan.specialTreatment.reason },
      });
    }

    const missingConfiguration = this.firstObligation(
      plan,
      (obligation) => obligation.status === 'MISSING_CONFIGURATION',
    );
    if (
      missingConfiguration !== null &&
      missingConfiguration.obligation.status === 'MISSING_CONFIGURATION'
    ) {
      const { obligation, tax } = missingConfiguration;
      if (obligation.missingFields.includes(ISS_RATE_FIELD)) {
        return fiscalError({
          code: 'TAX_RATE_NOT_FOUND',
          message: `No ISS rate is configured for this service: ${obligation.reason}`,
          category: 'CONFIGURATION',
          step: this.name,
          details: { tax, missingFields: [...obligation.missingFields] },
        });
      }
      return fiscalError({
        code: 'TAX_APPLICABILITY_UNKNOWN',
        message: `Applicability of tax "${tax}" is unknown: ${obligation.reason}`,
        category: 'CONFIGURATION',
        step: this.name,
        details: { tax, missingFields: [...obligation.missingFields] },
      });
    }

    const ibsCbsRequired = plan.cbs.status === 'REQUIRED' || plan.ibs.status === 'REQUIRED';
    if (ibsCbsRequired) {
      const missingFields = this.missingClassificationFields(classification);
      if (missingFields.length > 0) {
        return fiscalError({
          code: 'FISCAL_CLASSIFICATION_REQUIRED',
          message: 'IBS/CBS requires a complete fiscal classification (NBS, CST, class code and operation indicator)',
          category: 'CLASSIFICATION',
          step: this.name,
          details: { missingFields },
        });
      }
      if (!classification.catalogValidated) {
        return fiscalError({
          code: 'FISCAL_CLASSIFICATION_INVALID',
          message: 'IBS/CBS requires a classification validated against the official catalog',
          category: 'CLASSIFICATION',
          step: this.name,
          details: { reason: 'catalog_validation_unavailable' },
        });
      }
    }
    return null;
  }

  private firstObligation(
    plan: TaxApplicabilityPlan,
    matches: (obligation: TaxApplicabilityPlan[ObligationTax]) => boolean,
  ): { tax: ObligationTax; obligation: TaxApplicabilityPlan[ObligationTax] } | null {
    for (const tax of OBLIGATION_TAXES) {
      const obligation = plan[tax];
      if (matches(obligation)) return { tax, obligation };
    }
    return null;
  }

  private missingClassificationFields(classification: ServiceTaxClassification): string[] {
    const missing: string[] = [];
    if (classification.nbsCode === null) missing.push('service.fiscal.nbsCode');
    if (classification.cst === null) missing.push('service.fiscal.cst');
    if (classification.classCode === null) missing.push('service.fiscal.classCode');
    if (classification.operationIndicator === null) {
      missing.push('service.fiscal.operationIndicator');
    }
    return missing;
  }

  /**
   * Legal references of the rules consulted for this applicability: the
   * NFS-e IBS/CBS information milestone (always consulted), the 2026 test
   * phase when the competence date falls inside it and, for Simples
   * Nacional, the rule that makes IBS/CBS effective for the regime.
   */
  private collectLegalReferences(
    profile: CompanyFiscalProfile,
    serviceCode: string,
    date: string,
  ): string[] {
    const references: string[] = [];

    const information = this.policy.ibsCbsInformation(serviceCode, date);
    references.push(information.rule.legalReference);

    const testPhase = this.policy.select('ibscbs.test-phase', date);
    if (testPhase.ok && coversDate(testPhase.value, date)) {
      references.push(testPhase.value.legalReference);
    }

    if (profile.taxRegime === 'SIMPLES_NACIONAL') {
      const effective = this.policy.select('simples.ibscbs-effective', date);
      if (effective.ok) references.push(effective.value.legalReference);
    }

    return [...new Set(references)];
  }

  private withStep(error: FiscalError): FiscalError {
    return fiscalError({
      code: error.code,
      message: error.message,
      category: error.category,
      step: this.name,
      details: { ...error.details },
      retryable: error.retryable,
    });
  }
}
