import { Test } from '@nestjs/testing';
import { AppConfigModule } from '@/infra/config/config.module';
import { Company } from '@/modules/company/domain/company';
import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';
import type { CompanyServiceTaxProfile } from '@/modules/company/domain/service-tax-profile';
import { IFiscalCatalog } from '@/modules/invoice/domain/fiscal/classification/fiscal-catalog.port';
import type { FiscalStep } from '@/modules/invoice/domain/fiscal/fiscal-step';
import { IFiscalProfileReader } from '@/modules/invoice/domain/fiscal/ports/fiscal-profile.reader';
import { IServiceProfileReader } from '@/modules/invoice/domain/fiscal/ports/service-profile.reader';
import { RtcCalculatorPort } from '@/modules/invoice/domain/fiscal/rtc/rtc-calculator.port';
import { Invoice } from '@/modules/invoice/domain/invoice';
import { UnconfiguredRtcCalculator } from '@/modules/invoice/infra/fiscal/unconfigured-rtc-calculator';
import { FiscalEngineService } from './fiscal-engine.service';
import {
  FISCAL_ENGINE_INTERNAL_PROVIDERS,
  FISCAL_IBSCBS_UNAVAILABLE_MODE,
} from './fiscal-engine.module';
import { FISCAL_STEPS } from './fiscal-steps.provider';

const STEP_ORDER = [
  'CompanyFiscalProfile',
  'ServiceTaxClassifier',
  'TaxApplicabilityResolver',
  'LegacyTaxCalculator',
  'RtcTaxCalculator',
  'FiscalValidator',
];

const fiscalProfile = (
  overrides: Partial<CompanyFiscalProfile> = {},
): CompanyFiscalProfile => ({
  id: 'pf-1',
  tenantId: 'ten-1',
  companyId: 'comp-1',
  taxRegime: 'MEI',
  simpleNational: true,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  validFrom: '2026-01-01',
  validUntil: null,
  source: 'onboarding',
  reviewStatus: 'approved',
  reviewedBy: 'usr-1',
  reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const serviceProfile = (
  overrides: Partial<CompanyServiceTaxProfile> = {},
): CompanyServiceTaxProfile => ({
  id: 'sp-1',
  tenantId: 'ten-1',
  companyId: 'comp-1',
  name: 'Desenvolvimento de sistemas',
  serviceCode: '010101',
  municipalServiceCode: null,
  nbsCode: '010101',
  cst: '001',
  classCode: '001',
  operationIndicator: '03',
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
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

class InMemoryFiscalProfileReader extends IFiscalProfileReader {
  constructor(private readonly profiles: CompanyFiscalProfile[]) {
    super();
  }

  findEffectiveByDate(
    companyId: string,
    tenantId: string,
    date: string,
  ): Promise<CompanyFiscalProfile[]> {
    return Promise.resolve(
      this.profiles.filter(
        (profile) =>
          profile.companyId === companyId &&
          profile.tenantId === tenantId &&
          profile.validFrom <= date &&
          (profile.validUntil === null || date < profile.validUntil),
      ),
    );
  }
}

class InMemoryServiceProfileReader extends IServiceProfileReader {
  constructor(private readonly profiles: CompanyServiceTaxProfile[] = []) {
    super();
  }

  findById(
    id: string,
    companyId: string,
  ): Promise<CompanyServiceTaxProfile | null> {
    return Promise.resolve(
      this.profiles.find(
        (profile) => profile.id === id && profile.companyId === companyId,
      ) ?? null,
    );
  }

  findEffectiveByCode(
    companyId: string,
    tenantId: string,
    serviceCode: string,
    date: string,
  ): Promise<CompanyServiceTaxProfile[]> {
    return Promise.resolve(
      this.profiles.filter(
        (profile) =>
          profile.companyId === companyId &&
          profile.tenantId === tenantId &&
          profile.serviceCode === serviceCode &&
          profile.effectiveFrom <= date &&
          (profile.effectiveUntil === null || date < profile.effectiveUntil),
      ),
    );
  }
}

/** Catalog double that validates every six-digit code (the real catalog validates none). */
class ValidatingCatalog extends IFiscalCatalog {
  lookupServiceCode(code: string): { version: string; found: boolean } {
    return { version: 'test-catalog-1', found: /^\d{6}$/.test(code) };
  }

  validateClassification(): {
    status: 'validated';
    versions: Record<string, string>;
  } {
    return { status: 'validated', versions: { ctribnac: 'test-catalog-1' } };
  }
}

const company = (): Company =>
  Company.create(
    {
      legalName: 'Empresa Teste Ltda',
      taxId: '11222330000181',
      taxRegime: 'MEI',
      municipalReg: '12345',
      municipalityCode: '3550308',
    },
    'ten-1',
  );

const invoiceOf = (overrides: { amount?: number } = {}): Invoice =>
  Invoice.create(
    {
      companyId: 'comp-1',
      customer: null,
      service: {
        description: 'Servico de desenvolvimento',
        code: '060101',
        municipalityCode: '3550308',
      },
      amount: overrides.amount ?? 50,
      competenceDate: new Date('2026-10-13T12:00:00.000Z'),
      environment: 'test',
    },
    'ten-1',
  );

const regularInvoice = (): Invoice =>
  Invoice.create(
    {
      companyId: 'comp-1',
      customer: {
        name: 'Cliente Ltda',
        taxId: '12345678000199',
        address: { city: 'Sao Paulo', state: 'SP' },
      },
      service: {
        description: 'Servico de desenvolvimento',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 1000,
      competenceDate: new Date('2026-12-10T12:00:00.000Z'),
      environment: 'test',
    },
    'ten-1',
  );

/** Composes the engine in isolation (ports + fakes) so no database graph is loaded. */
const buildEngine = (
  opts: {
    profiles?: CompanyFiscalProfile[];
    serviceProfiles?: CompanyServiceTaxProfile[];
    catalog?: IFiscalCatalog;
    mode?: 'block' | 'warn';
  } = {},
) =>
  Test.createTestingModule({
    imports: [AppConfigModule],
    providers: [
      ...FISCAL_ENGINE_INTERNAL_PROVIDERS,
      {
        provide: IFiscalProfileReader,
        useValue: new InMemoryFiscalProfileReader(opts.profiles ?? []),
      },
      {
        provide: IServiceProfileReader,
        useValue: new InMemoryServiceProfileReader(opts.serviceProfiles ?? []),
      },
      ...(opts.catalog
        ? [{ provide: IFiscalCatalog, useValue: opts.catalog }]
        : []),
      {
        provide: FISCAL_IBSCBS_UNAVAILABLE_MODE,
        useValue: opts.mode ?? 'block',
      },
    ],
  }).compile();

describe('FiscalEngineModule wiring', () => {
  it('resolves FiscalEngineService and wires the six steps in fail-fast order', async () => {
    const moduleRef = await buildEngine();

    expect(moduleRef.get(FiscalEngineService)).toBeInstanceOf(
      FiscalEngineService,
    );
    const steps = moduleRef.get<readonly FiscalStep[]>(FISCAL_STEPS);
    expect(steps.map((step) => step.name)).toEqual(STEP_ORDER);

    await moduleRef.close();
  });

  it('runs every step in order and returns the result with the execution trace', async () => {
    const moduleRef = await buildEngine({ profiles: [fiscalProfile()] });

    const engine = moduleRef.get(FiscalEngineService);
    const result = await engine.calculate(invoiceOf(), company());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
    expect(result.value.taxRegime).toBe('MEI');
    expect(result.value.calculationSource).toBe('none');
    expect(result.value.trace.map((entry) => entry.step)).toEqual(STEP_ORDER);
    expect(
      result.value.trace.find((entry) => entry.step === 'LegacyTaxCalculator')
        ?.status,
    ).toBe('skipped');
    expect(
      result.value.trace.find((entry) => entry.step === 'RtcTaxCalculator')
        ?.status,
    ).toBe('skipped');

    await moduleRef.close();
  });

  it('fails fast at CompanyFiscalProfile when no fiscal profile is effective', async () => {
    const moduleRef = await buildEngine({ profiles: [] });

    const engine = moduleRef.get(FiscalEngineService);
    const result = await engine.calculate(invoiceOf(), company());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a fiscal error');
    expect(result.error).toMatchObject({
      code: 'FISCAL_PROFILE_NOT_EFFECTIVE',
      category: 'CONFIGURATION',
      step: 'CompanyFiscalProfile',
    });

    await moduleRef.close();
  });

  it('blocks with TAX_CALCULATION_UNAVAILABLE when the RTC adapter is unconfigured (default mode)', async () => {
    const moduleRef = await buildEngine({
      profiles: [
        fiscalProfile({ taxRegime: 'LUCRO_PRESUMIDO', simpleNational: false }),
      ],
      serviceProfiles: [serviceProfile()],
      catalog: new ValidatingCatalog(),
      mode: 'block',
    });

    const engine = moduleRef.get(FiscalEngineService);
    const result = await engine.calculate(regularInvoice(), company());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a fiscal error');
    expect(result.error).toMatchObject({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      step: 'RtcTaxCalculator',
      retryable: false,
      details: { reason: 'adapter_not_configured' },
    });

    await moduleRef.close();
  });

  it('tolerates the missing RTC calculation with a warning in warn mode', async () => {
    const moduleRef = await buildEngine({
      profiles: [
        fiscalProfile({ taxRegime: 'LUCRO_PRESUMIDO', simpleNational: false }),
      ],
      serviceProfiles: [serviceProfile()],
      catalog: new ValidatingCatalog(),
      mode: 'warn',
    });

    const engine = moduleRef.get(FiscalEngineService);
    const result = await engine.calculate(regularInvoice(), company());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
    expect(result.value.calculationSource).toBe('legacy');
    expect(result.value.taxes.iss?.amount).toBe('30.00');
    expect(result.value.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IBS_CBS_NOT_DECLARED_TOLERATED' }),
      ]),
    );
    expect(result.value.requiresReview).toBe(true);

    await moduleRef.close();
  });

  it('maps an Invoice and Company pair onto a NormalizedInvoice', async () => {
    const moduleRef = await buildEngine();

    const engine = moduleRef.get(FiscalEngineService);
    const invoice = Invoice.create(
      {
        companyId: 'comp-1',
        customer: {
          name: 'Consumidor',
          taxId: '12345678901',
          address: {
            city: 'Sao Paulo',
            state: 'SP',
            municipalityCode: '3550308',
          },
        },
        service: {
          description: 'Servico',
          code: '060101',
          municipalityCode: '3550308',
        },
        amount: 33.335,
        discount: 3.335,
        competenceDate: new Date('2026-10-13T12:00:00.000Z'),
        environment: 'test',
      },
      'ten-1',
    );

    const normalized = engine.toNormalizedInvoice(invoice, company());

    expect(normalized).toMatchObject({
      tenantId: 'ten-1',
      environment: 'test',
      competenceDate: '2026-10-13',
      grossAmount: '33.34',
      discountAmount: '3.34',
      company: {
        taxId: '11222330000181',
        municipalityCode: '3550308',
        municipalRegistration: '12345',
      },
      service: { code: '060101', municipalityCode: '3550308' },
      customer: {
        kind: 'CPF',
        taxId: '12345678901',
        municipalityCode: '3550308',
      },
    });
    expect(normalized.invoiceId).toBe(invoice.id);

    await moduleRef.close();
  });
});

describe('UnconfiguredRtcCalculator', () => {
  const adapter = new UnconfiguredRtcCalculator();

  it('reports adapter_not_configured on calculate', async () => {
    const result = await adapter.calculate({
      competenceDate: '2026-10-13',
      grossAmount: '100.00',
      discountAmount: '0.00',
      serviceCode: '010101',
      nbsCode: '010101',
      cst: '001',
      classCode: '001',
      operationIndicator: '03',
      providerTaxId: '11222330000181',
      providerMunicipalityCode: '3550308',
      incidenceMunicipalityCode: '3550308',
      customer: null,
      regime: 'LUCRO_PRESUMIDO',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected an error');
    expect(result.error).toMatchObject({
      code: 'TAX_CALCULATION_UNAVAILABLE',
      category: 'CONFIGURATION',
      retryable: false,
      details: { reason: 'adapter_not_configured' },
    });
  });

  it('reports adapter_not_configured on health and version', async () => {
    const health = await adapter.health();
    const version = await adapter.version();

    expect(health.ok).toBe(false);
    expect(version.ok).toBe(false);
    if (health.ok || version.ok) throw new Error('expected errors');
    expect(health.error.details).toMatchObject({
      reason: 'adapter_not_configured',
    });
    expect(version.error.details).toMatchObject({
      reason: 'adapter_not_configured',
    });
  });
});
