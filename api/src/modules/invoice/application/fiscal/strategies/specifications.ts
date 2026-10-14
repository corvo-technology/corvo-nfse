import type { CompanyFiscalProfile, TaxRegimeKind } from '@/modules/company/domain/fiscal-profile';
import type { OperationNature } from '@/modules/company/domain/service-tax-profile';
import type { ServiceTaxClassification } from '@/modules/invoice/domain/fiscal/classification/service-tax-classification';
import type { FiscalCustomer } from '@/modules/invoice/domain/fiscal/normalized-invoice';
import type { TaxTransitionPolicy } from '@/modules/invoice/domain/fiscal/policies/tax-transition.policy';

export interface SpecificationResult {
  satisfied: boolean;
  reason: string;
}

/**
 * Whether the regime/operation combination may issue the NFS-e without an
 * identified customer (tomador). Regular regimes always require one; MEI and
 * Simples Nacional allow anonymous SERVICE operations.
 */
export function allowsAnonymousCustomer(input: {
  regime: TaxRegimeKind;
  competenceDate: string;
  operationNature: OperationNature;
}): SpecificationResult {
  const { regime, operationNature } = input;
  if (operationNature !== 'SERVICE') {
    return { satisfied: false, reason: 'only service operations may omit the customer' };
  }
  if (regime === 'MEI' || regime === 'SIMPLES_NACIONAL') {
    return { satisfied: true, reason: `${regime} service operations may omit the customer` };
  }
  return { satisfied: false, reason: 'regular tax regimes require an identified customer' };
}

export function requiresIssWithholding(input: {
  customer: FiscalCustomer | null;
  classification: ServiceTaxClassification;
}): SpecificationResult {
  const { customer, classification } = input;
  const configured = classification.iss.withholdingDefault;
  const cnpjCustomer = customer !== null && customer.kind === 'CNPJ';
  if (configured && cnpjCustomer) {
    return { satisfied: true, reason: 'ISS withholding is configured for CNPJ customers' };
  }
  return { satisfied: false, reason: 'no ISS withholding configured for this customer/service' };
}

export function requiresIbsCbs(input: {
  competenceDate: string;
  serviceCode: string;
  policy: TaxTransitionPolicy;
}): SpecificationResult {
  const { competenceDate, serviceCode, policy } = input;
  const information = policy.ibsCbsInformation(serviceCode, competenceDate);
  if (information.phase === 'REQUIRED') {
    return { satisfied: true, reason: 'IBS/CBS information obligation is in force' };
  }
  return { satisfied: false, reason: 'obrigação de informação ainda não vigente' };
}

export function requiresSpecialTreatment(input: {
  classification: ServiceTaxClassification;
  profile: CompanyFiscalProfile;
}): SpecificationResult {
  const nature = input.classification.operationNature;
  if (nature === 'GOODS' || nature === 'MIXED') {
    return { satisfied: false, reason: 'goods/mixed operations require NF-e/NFC-e' };
  }
  if (nature === 'PARTNER_SALON') {
    return { satisfied: false, reason: 'partner-salon scenario not supported; fiscal review required' };
  }
  return { satisfied: true, reason: 'service operation without special treatment' };
}
