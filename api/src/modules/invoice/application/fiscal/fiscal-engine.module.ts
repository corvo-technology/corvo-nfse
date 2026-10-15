import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RtcConfig } from '@/infra/config/configuration';
import { CompanyModule } from '@/modules/company/company.module';
import { IFiscalCatalog } from '@/modules/invoice/domain/fiscal/classification/fiscal-catalog.port';
import { TAX_RULES } from '@/modules/invoice/domain/fiscal/policies/rules';
import { TaxTransitionPolicy } from '@/modules/invoice/domain/fiscal/policies/tax-transition.policy';
import { IFiscalProfileReader } from '@/modules/invoice/domain/fiscal/ports/fiscal-profile.reader';
import { IServiceProfileReader } from '@/modules/invoice/domain/fiscal/ports/service-profile.reader';
import { RtcCalculatorPort } from '@/modules/invoice/domain/fiscal/rtc/rtc-calculator.port';
import { ctribnacCatalogProvider } from '@/modules/invoice/infra/fiscal/ctribnac-catalog.provider';
import { DefaultRtcMapper } from '@/modules/invoice/infra/fiscal/rtc/default-rtc-mapper';
import { HttpRtcCalculatorAdapter } from '@/modules/invoice/infra/fiscal/rtc/http-rtc-calculator.adapter';
import type { RtcMapper } from '@/modules/invoice/infra/fiscal/rtc/rtc-mapper';
import { UnconfiguredRtcCalculator } from '@/modules/invoice/infra/fiscal/unconfigured-rtc-calculator';
import { FiscalEngineService } from './fiscal-engine.service';
import { fiscalStepsProvider } from './fiscal-steps.provider';
import { CompanyFiscalProfileStep } from './steps/company-fiscal-profile.step';
import { FiscalValidatorStep } from './steps/fiscal-validator.step';
import { LegacyTaxCalculatorStep } from './steps/legacy-tax-calculator.step';
import { RtcTaxCalculatorStep } from './steps/rtc-tax-calculator.step';
import { ServiceTaxClassifierStep } from './steps/service-tax-classifier.step';
import { TaxApplicabilityStep } from './steps/tax-applicability.step';
import { MeiTaxStrategy } from './strategies/mei-tax.strategy';
import { RegularTaxStrategy } from './strategies/regular-tax.strategy';
import { SimplesNacionalTaxStrategy } from './strategies/simples-nacional-tax.strategy';
import { TaxStrategyResolver } from './strategies/tax-strategy.resolver';
import { TypeOrmCompanyFiscalProfileReader } from './typeorm-company-fiscal-profile.reader';
import { TypeOrmServiceProfileReader } from './typeorm-service-profile.reader';

/** Injects the D1 mode string from the `fiscal` config section into the RTC step. */
export const FISCAL_IBSCBS_UNAVAILABLE_MODE = 'FISCAL_IBSCBS_UNAVAILABLE_MODE';

/** Injection token for the RTC contract mapper (`DefaultRtcMapper` in production). */
export const RTC_MAPPER = 'RTC_MAPPER';

/**
 * Providers that make up the engine itself and depend only on ports (no
 * TypeORM/`CompanyModule`). Exported so the wiring test can compose the engine
 * in isolation without dragging the whole database graph into a unit test; the
 * `CompanyModule`-backed reader adapters are added on top in the module below.
 */
export const FISCAL_ENGINE_INTERNAL_PROVIDERS: Provider[] = [
  ctribnacCatalogProvider,
  {
    provide: TaxTransitionPolicy,
    useFactory: () => new TaxTransitionPolicy(TAX_RULES),
  },
  MeiTaxStrategy,
  SimplesNacionalTaxStrategy,
  RegularTaxStrategy,
  {
    provide: TaxStrategyResolver,
    useFactory: (
      mei: MeiTaxStrategy,
      simples: SimplesNacionalTaxStrategy,
      regular: RegularTaxStrategy,
    ) => new TaxStrategyResolver([mei, simples, regular]),
    inject: [MeiTaxStrategy, SimplesNacionalTaxStrategy, RegularTaxStrategy],
  },
  CompanyFiscalProfileStep,
  ServiceTaxClassifierStep,
  TaxApplicabilityStep,
  LegacyTaxCalculatorStep,
  FiscalValidatorStep,
  {
    provide: RtcCalculatorPort,
    useFactory: (config: ConfigService, mapper: RtcMapper) => {
      const rtc = config.get<RtcConfig>('rtc');
      return rtc?.url
        ? new HttpRtcCalculatorAdapter(rtc, mapper)
        : new UnconfiguredRtcCalculator();
    },
    inject: [ConfigService, RTC_MAPPER],
  },
  {
    provide: FISCAL_IBSCBS_UNAVAILABLE_MODE,
    useFactory: (config: ConfigService) => {
      const fiscal = config.get<{ ibsCbsUnavailableMode: 'block' | 'warn' }>(
        'fiscal',
      );
      if (fiscal === undefined) throw new Error('Missing fiscal configuration');
      return fiscal.ibsCbsUnavailableMode;
    },
    inject: [ConfigService],
  },
  {
    provide: RtcTaxCalculatorStep,
    useFactory: (
      rtc: RtcCalculatorPort,
      policy: TaxTransitionPolicy,
      mode: 'block' | 'warn',
    ) => new RtcTaxCalculatorStep(rtc, policy, mode),
    inject: [
      RtcCalculatorPort,
      TaxTransitionPolicy,
      FISCAL_IBSCBS_UNAVAILABLE_MODE,
    ],
  },
  fiscalStepsProvider,
  FiscalEngineService,
];

@Module({
  imports: [CompanyModule],
  providers: [
    { provide: RTC_MAPPER, useClass: DefaultRtcMapper },
    ...FISCAL_ENGINE_INTERNAL_PROVIDERS,
    TypeOrmCompanyFiscalProfileReader,
    {
      provide: IFiscalProfileReader,
      useExisting: TypeOrmCompanyFiscalProfileReader,
    },
    TypeOrmServiceProfileReader,
    {
      provide: IServiceProfileReader,
      useExisting: TypeOrmServiceProfileReader,
    },
  ],
  exports: [FiscalEngineService],
})
export class FiscalEngineModule {}
