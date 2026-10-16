import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { Obligation } from '@/modules/invoice/domain/fiscal/applicability/tax-applicability';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import {
  fiscalError,
  type FiscalError,
} from '@/modules/invoice/domain/fiscal/fiscal-error';
import type {
  FiscalCustomer,
  NormalizedInvoice,
} from '@/modules/invoice/domain/fiscal/normalized-invoice';
import { err, ok, type Result } from '@/modules/invoice/domain/fiscal/result';
import {
  allowsAnonymousCustomer,
  requiresIssWithholding,
  requiresSpecialTreatment,
} from './specifications';

export interface CommonObligationsInput {
  readonly invoice: NormalizedInvoice;
  readonly profile: CompanyFiscalProfile;
  readonly classification: ServiceTaxClassification;
}

export interface CommonObligations {
  readonly issWithheld: Obligation;
  readonly federalWithholding: Obligation;
  readonly customerRequired: boolean;
  readonly specialTreatment: Obligation;
}

function federalWithholdingObligation(
  customer: FiscalCustomer | null,
  classification: ServiceTaxClassification,
  regime: CompanyFiscalProfile['taxRegime'],
): Obligation {
  // Payments to Simples Nacional/MEI optants are not subject to IRRF or
  // PIS/COFINS/CSLL withholding by the customer (IN RFB 1.234/2012, art. 4, XI).
  if (regime === 'MEI' || regime === 'SIMPLES_NACIONAL') {
    return {
      status: 'NOT_APPLICABLE',
      reason:
        'no federal withholding on payments to Simples Nacional/MEI optants (IN RFB 1.234/2012, art. 4, XI)',
    };
  }
  if (customer === null || customer.kind === 'CPF') {
    return {
      status: 'NOT_APPLICABLE',
      reason: 'federal withholding does not apply without a CNPJ customer',
    };
  }
  const policy = classification.withholding.policy;
  if (policy === 'NONE_CONFIRMED') {
    return {
      status: 'NOT_APPLICABLE',
      reason: 'no federal withholding configured',
    };
  }
  if (policy === 'CONFIGURED') {
    return { status: 'REQUIRED' };
  }
  return {
    status: 'MISSING_CONFIGURATION',
    reason: 'federal withholding policy is not configured for this service',
    missingFields: ['service.withholdingPolicy'],
  };
}

/** Obligations shared by every strategy: special treatment, withholdings and customer requirement. */
export function commonObligations(
  input: CommonObligationsInput,
): Result<CommonObligations, FiscalError> {
  const { invoice, profile, classification } = input;
  const nature = classification.operationNature;

  const special = requiresSpecialTreatment({ classification, profile });
  if (!special.satisfied && (nature === 'GOODS' || nature === 'MIXED')) {
    return err(
      fiscalError({
        code: 'OPERATION_DOCUMENT_UNSUPPORTED',
        category: 'UNSUPPORTED',
        step: 'TaxStrategy.plan',
        message: special.reason,
        details: { operationNature: nature },
      }),
    );
  }
  const specialTreatment: Obligation =
    nature === 'PARTNER_SALON'
      ? { status: 'UNSUPPORTED', reason: special.reason }
      : {
          status: 'NOT_APPLICABLE',
          reason: 'no special treatment required for this operation',
        };

  const issWithheld: Obligation = requiresIssWithholding({
    customer: invoice.customer,
    classification,
  }).satisfied
    ? { status: 'REQUIRED' }
    : {
        status: 'NOT_APPLICABLE',
        reason: 'no ISS withholding configured for this customer/service',
      };

  const federalWithholding = federalWithholdingObligation(
    invoice.customer,
    classification,
    profile.taxRegime,
  );

  const customerRequired = !allowsAnonymousCustomer({
    regime: profile.taxRegime,
    competenceDate: invoice.competenceDate,
    operationNature: nature,
  }).satisfied;

  return ok({
    issWithheld,
    federalWithholding,
    customerRequired,
    specialTreatment,
  });
}
