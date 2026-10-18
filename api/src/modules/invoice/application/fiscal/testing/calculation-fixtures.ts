import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { CompanyServiceTaxProfile } from '@/modules/company/domain/service-tax-profile';
import type { FiscalStep } from '@/modules/invoice/domain/fiscal/fiscal-step';
import { TaxTransitionPolicy } from '@/modules/invoice/domain/fiscal/policies/tax-transition.policy';
import { UnconfiguredRtcCalculator } from '@/modules/invoice/infra/fiscal/unconfigured-rtc-calculator';
import { FiscalEngineService } from '../fiscal-engine.service';
import { CompanyFiscalProfileStep } from '../steps/company-fiscal-profile.step';
import { ServiceTaxClassifierStep } from '../steps/service-tax-classifier.step';
import { TaxApplicabilityStep } from '../steps/tax-applicability.step';
import { LegacyTaxCalculatorStep } from '../steps/legacy-tax-calculator.step';
import { RtcTaxCalculatorStep } from '../steps/rtc-tax-calculator.step';
import { FiscalValidatorStep } from '../steps/fiscal-validator.step';
import { TaxStrategyResolver } from '../strategies/tax-strategy.resolver';
import { MeiTaxStrategy } from '../strategies/mei-tax.strategy';
import { SimplesNacionalTaxStrategy } from '../strategies/simples-nacional-tax.strategy';
import { RegularTaxStrategy } from '../strategies/regular-tax.strategy';

export const calculationProfile = (
  extra: Partial<CompanyFiscalProfile> = {},
): CompanyFiscalProfile => ({
  id: 'profile',
  tenantId: 'ten-1',
  companyId: 'comp-1',
  taxRegime: 'MEI',
  simpleNational: true,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  simplesIssRate: null,
  validFrom: '2026-01-01',
  validUntil: null,
  source: 'onboarding',
  reviewStatus: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date('2026-01-01'),
  ...extra,
});
export const calculationServiceProfile = (
  extra: Partial<CompanyServiceTaxProfile> = {},
): CompanyServiceTaxProfile => ({
  id: 'service-profile',
  tenantId: 'ten-1',
  companyId: 'comp-1',
  name: 'Serviço',
  serviceCode: '010101',
  municipalServiceCode: null,
  nbsCode: null,
  cst: null,
  classCode: null,
  operationIndicator: null,
  operationNature: 'SERVICE',
  regimeApplicability: [],
  incidenceMunicipalityCode: '3550308',
  issTaxation: 'NORMAL',
  issRate: '3.00',
  issWithholdingDefault: false,
  withholdingPolicy: 'NONE_CONFIRMED',
  withholdingRates: {},
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  classificationSource: 'manual',
  reviewStatus: 'approved',
  catalogVersion: null,
  createdAt: new Date('2026-01-01'),
  ...extra,
});

export function calculationEngine(
  profile = calculationProfile(),
  serviceProfiles: CompanyServiceTaxProfile[] = [],
  extraSteps: FiscalStep[] = [],
): FiscalEngineService {
  const policy = new TaxTransitionPolicy();
  return new FiscalEngineService([
    new CompanyFiscalProfileStep({
      findEffectiveByDate: () => Promise.resolve([profile]),
    }),
    new ServiceTaxClassifierStep(
      {
        findById: (id) =>
          Promise.resolve(serviceProfiles.find((p) => p.id === id) ?? null),
        findEffectiveByCode: () => Promise.resolve(serviceProfiles),
      },
      {
        lookupServiceCode: () => ({ found: true, version: 'test' }),
        validateClassification: () =>
          Promise.resolve({
            status: 'validated',
            versions: { test: 'test' },
          }),
      },
    ),
    new TaxApplicabilityStep(
      new TaxStrategyResolver([
        new MeiTaxStrategy(),
        new SimplesNacionalTaxStrategy(),
        new RegularTaxStrategy(),
      ]),
      policy,
    ),
    new LegacyTaxCalculatorStep(),
    new RtcTaxCalculatorStep(new UnconfiguredRtcCalculator(), policy, 'block'),
    new FiscalValidatorStep(),
    ...extraSteps,
  ]);
}
