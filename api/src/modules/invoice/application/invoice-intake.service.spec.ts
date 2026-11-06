import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Company } from '@/modules/company/domain/company';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { InvoiceDomainService } from '../domain/invoice-domain.service';
import { InvoiceIntakeService } from './invoice-intake.service';
import { TaxRegimeNotSupportedError } from '@/modules/company/domain/errors';

describe('InvoiceIntakeService', () => {
  const company = Company.create(
    {
      legalName: 'Empresa',
      taxId: '11222333000181',
      taxRegime: 'MEI',
      municipalityCode: '3550308',
      defaultServiceCode: '060101',
    },
    'tenant',
  );
  const dto = {
    companyId: company.id,
    companyTaxId: company.taxId,
    amount: 50,
    competenceDate: '2026-01-01',
    service: { description: 'Corte' },
  };
  const companies = {
    findById: jest.fn(),
    findByTaxId: jest.fn(),
    ensureReady: jest.fn(),
  };
  const domain = new InvoiceDomainService();
  const normalize = jest.spyOn(domain, 'normalizeAndValidate');
  const intake = new InvoiceIntakeService(companies as never, domain);
  beforeEach(() => {
    jest.clearAllMocks();
    companies.findById.mockResolvedValue(company);
    companies.findByTaxId.mockResolvedValue(company);
  });

  it('prefers companyId and passes tenant, environment and company defaults', async () => {
    const result = await intake.prepare(dto, 'tenant', 'test');
    expect(companies.findById).toHaveBeenCalledWith(
      company.id,
      'tenant',
      'test',
    );
    expect(companies.findByTaxId).not.toHaveBeenCalled();
    expect(result.normalized.service).toMatchObject({
      code: '060101',
      municipalityCode: '3550308',
    });
    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: company.id }),
      'test',
      { code: '060101', municipalityCode: '3550308' },
    );
    expect(companies.ensureReady).not.toHaveBeenCalled();
  });
  describe('service defaults', () => {
    const withoutDefault = Company.create(
      {
        legalName: 'Empresa',
        taxId: '11222333000181',
        taxRegime: 'MEI',
        municipalityCode: '3550308',
      },
      'tenant',
    );

    it('uses LC 116 item 10.09 (100901) when neither the request nor the company has a service code', async () => {
      companies.findById.mockResolvedValue(withoutDefault);
      const result = await intake.prepare(
        { ...dto, service: { description: 'Corte' } },
        'tenant',
        'test',
      );
      expect(result.normalized.service.code).toBe('100901');
    });

    it('prefers the code of the request, then the one of the company', async () => {
      const explicit = await intake.prepare(
        { ...dto, service: { code: '010101', description: 'x' } },
        'tenant',
        'test',
      );
      expect(explicit.normalized.service.code).toBe('010101');
      const fromCompany = await intake.prepare(dto, 'tenant', 'test');
      expect(fromCompany.normalized.service.code).toBe('060101');
    });

    it('names the service after its catalog entry when the description is omitted', async () => {
      companies.findById.mockResolvedValue(withoutDefault);
      const result = await intake.prepare(
        { ...dto, service: {} },
        'tenant',
        'test',
      );
      expect(result.normalized.service.description).toBe(
        'Representação de qualquer natureza, inclusive comercial',
      );
    });

    it('keeps the description of the request, and treats a blank one as omitted', async () => {
      const kept = await intake.prepare(dto, 'tenant', 'test');
      expect(kept.normalized.service.description).toBe('Corte');
      const blank = await intake.prepare(
        { ...dto, service: { description: '   ' } },
        'tenant',
        'test',
      );
      expect(blank.normalized.service.description).toBeTruthy();
      expect(blank.normalized.service.description).not.toBe('   ');
    });

    it('falls back to a generic phrase for a code that is not in the catalog', async () => {
      const result = await intake.prepare(
        { ...dto, service: { code: '999999' } },
        'tenant',
        'test',
      );
      expect(result.normalized.service.description).toBe(
        'Prestação de serviços',
      );
    });
  });

  it('resolves tax id when companyId is absent', async () => {
    await intake.prepare({ ...dto, companyId: undefined }, 'tenant', 'live');
    expect(companies.findByTaxId).toHaveBeenCalledWith(
      company.taxId,
      'tenant',
      'live',
    );
    expect(companies.ensureReady).not.toHaveBeenCalled();
  });
  it('rejects missing company identifiers', async () => {
    await expect(
      intake.prepare(
        { ...dto, companyId: undefined, companyTaxId: undefined },
        'tenant',
        'test',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([undefined, '123', 'ABCDEFG'])(
    'rejects invalid company municipality %s before normalization',
    async (municipalityCode) => {
      companies.findById.mockResolvedValue(
        Company.reconstitute({ ...company.toSnapshot(), municipalityCode }),
      );
      await expect(intake.prepare(dto, 'tenant', 'test')).rejects.toMatchObject(
        {
          issues: [
            expect.objectContaining({ field: 'company.municipalityCode' }),
          ],
        },
      );
      expect(normalize).not.toHaveBeenCalled();
    },
  );
  it('allows future competence without mutating options and discards scheduling metadata', async () => {
    const future = DateTime.now()
      .setZone('America/Sao_Paulo')
      .plus({ days: 2 })
      .toISODate();
    if (!future) throw new Error('Invalid test date');
    const input = { ...dto, competenceDate: future };
    const result = await intake.prepare(input, 'tenant', 'test', {
      allowFutureCompetence: true,
    });
    expect(result.normalized.competenceDate.toISOString().slice(0, 10)).toBe(
      future,
    );
    expect(result.normalized.scheduledFor).toBeUndefined();
    expect(input).not.toHaveProperty('options');
    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({ options: { type: 'SCHEDULE' } }),
      'test',
      expect.any(Object),
    );
  });
  it('keeps the future horizon and ordinary emission validation', async () => {
    const future = DateTime.now()
      .setZone('America/Sao_Paulo')
      .plus({ days: 16 })
      .toISODate();
    if (!future) throw new Error('Invalid test date');
    await expect(
      intake.prepare({ ...dto, competenceDate: future }, 'tenant', 'test', {
        allowFutureCompetence: true,
      }),
    ).rejects.toBeInstanceOf(FiscalValidationError);
    await expect(
      intake.prepare({ ...dto, competenceDate: future }, 'tenant', 'test'),
    ).rejects.toBeInstanceOf(FiscalValidationError);
  });
});

describe('InvoiceIntakeService deduction by regime (Anexo I)', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111';
  const company = Company.create(
    {
      legalName: 'Empresa',
      taxId: '11222333000181',
      taxRegime: 'MEI',
      simplesRate: '6.54',
      municipalityCode: '3550308',
      defaultServiceCode: '060101',
    },
    TENANT,
  );
  const profile = (
    taxRegime: string,
    validFrom: string,
    validUntil: string | null,
  ) => ({ taxRegime, validFrom, validUntil });
  const build = (profiles: unknown[]) => {
    const companies = {
      findById: jest.fn().mockResolvedValue(company),
      findByTaxId: jest.fn().mockResolvedValue(company),
    };
    return new InvoiceIntakeService(
      companies as never,
      new InvoiceDomainService(),
      { list: jest.fn().mockResolvedValue(profiles) } as never,
    );
  };
  const dto = (extra: Record<string, unknown> = {}) => ({
    companyId: company.id,
    amount: 100,
    deduction: 10,
    competenceDate: '2026-01-15',
    service: { description: 'Corte', code: '060101' },
    ...extra,
  });

  it('refuses a deduction for a MEI before anything is reserved', async () => {
    const intake = build([profile('MEI', '2025-01-01', null)]);
    const error = await intake
      .prepare(dto(), TENANT, 'test')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FiscalValidationError);
    expect((error as FiscalValidationError).issues[0]).toMatchObject({
      field: 'deduction',
      code: 'deduction_not_allowed_for_regime',
    });
  });

  it('refuses a deduction for a Simples company outside the Anexo I list', async () => {
    const intake = build([profile('SIMPLES_NACIONAL', '2025-01-01', null)]);
    await expect(
      intake.prepare(
        dto({ service: { description: 'x', code: '010101' } }),
        TENANT,
        'test',
      ),
    ).rejects.toBeInstanceOf(FiscalValidationError);
  });

  it('accepts a deduction for a Simples company on a listed cTribNac', async () => {
    const intake = build([profile('SIMPLES_NACIONAL', '2025-01-01', null)]);
    await expect(intake.prepare(dto(), TENANT, 'test')).resolves.toBeDefined();
  });

  it('never checks a zero or absent deduction', async () => {
    const intake = build([profile('MEI', '2025-01-01', null)]);
    await expect(
      intake.prepare(dto({ deduction: undefined }), TENANT, 'test'),
    ).resolves.toBeDefined();
  });

  it('uses the profile effective on the competence date, not the current regime', async () => {
    const intake = build([
      profile('MEI', '2025-01-01', '2026-06-01'),
      profile('SIMPLES_NACIONAL', '2026-06-01', null),
    ]);
    await expect(
      intake.prepare(dto({ competenceDate: '2026-01-15' }), TENANT, 'test'),
    ).rejects.toBeInstanceOf(FiscalValidationError);
    await expect(
      intake.prepare(dto({ competenceDate: '2026-07-15' }), TENANT, 'test'),
    ).resolves.toBeDefined();
  });

  it('leaves the decision to the engine when no single profile is effective', async () => {
    await expect(
      build([]).prepare(dto(), TENANT, 'test'),
    ).resolves.toBeDefined();
  });
});

describe('InvoiceIntakeService Simples rate requirement', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111';
  const company = (simplesRate?: string) =>
    Company.create(
      {
        legalName: 'Empresa',
        taxId: '11222333000181',
        taxRegime: 'Simples Nacional',
        simplesRate,
        municipalityCode: '3550308',
        defaultServiceCode: '060101',
      },
      TENANT,
    );
  const build = (regime: 'SIMPLES_NACIONAL' | 'MEI', simplesRate?: string) => {
    const c = company(simplesRate);
    const intake = new InvoiceIntakeService(
      {
        findById: jest.fn().mockResolvedValue(c),
        findByTaxId: jest.fn().mockResolvedValue(c),
      } as never,
      new InvoiceDomainService(),
      {
        list: jest
          .fn()
          .mockResolvedValue([
            { taxRegime: regime, validFrom: '2025-01-01', validUntil: null },
          ]),
      } as never,
    );
    return { intake, companyId: c.id };
  };
  const dto = (companyId: string) => ({
    companyId,
    amount: 100,
    competenceDate: '2026-10-15',
    service: { description: 'Corte', code: '060101' },
  });

  it('refuses an ME/EPP without a rate, before anything is reserved', async () => {
    const { intake, companyId } = build('SIMPLES_NACIONAL');
    const error = await intake
      .prepare(dto(companyId), TENANT, 'test')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FiscalValidationError);
    expect((error as FiscalValidationError).issues[0]).toMatchObject({
      field: 'simplesRate',
      code: 'simples_rate_required',
    });
  });

  it('accepts an ME/EPP that has its rate', async () => {
    const { intake, companyId } = build('SIMPLES_NACIONAL', '6.54');
    await expect(
      intake.prepare(dto(companyId), TENANT, 'test'),
    ).resolves.toBeDefined();
  });

  it('a MEI never needs a rate', async () => {
    const { intake, companyId } = build('MEI');
    await expect(
      intake.prepare(dto(companyId), TENANT, 'test'),
    ).resolves.toBeDefined();
  });
});

describe('InvoiceIntakeService regime restriction', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111';
  const company = Company.create(
    {
      legalName: 'Empresa',
      taxId: '11222333000181',
      taxRegime: 'Lucro Real',
      simplesRate: '6.54',
      municipalityCode: '3550308',
      defaultServiceCode: '060101',
    },
    TENANT,
  );
  const build = (regime: string) =>
    new InvoiceIntakeService(
      { findById: jest.fn().mockResolvedValue(company) } as never,
      new InvoiceDomainService(),
      {
        list: jest
          .fn()
          .mockResolvedValue([
            { taxRegime: regime, validFrom: '2025-01-01', validUntil: null },
          ]),
      } as never,
    );
  const dto = {
    companyId: company.id,
    amount: 100,
    competenceDate: '2026-10-15',
    service: { description: 'Corte', code: '060101' },
  };

  it.each(['LUCRO_PRESUMIDO', 'LUCRO_REAL', 'OUTRO_REGIME', 'UNKNOWN'])(
    'refuses an invoice of a %s company before any credit is reserved',
    async (regime) => {
      await expect(
        build(regime).prepare(dto, TENANT, 'test'),
      ).rejects.toBeInstanceOf(TaxRegimeNotSupportedError);
    },
  );

  it.each(['MEI', 'SIMPLES_NACIONAL'])(
    'accepts a %s company',
    async (regime) => {
      await expect(
        build(regime).prepare(dto, TENANT, 'test'),
      ).resolves.toBeDefined();
    },
  );

  it('leaves a company without a single effective profile to the engine', async () => {
    const intake = new InvoiceIntakeService(
      { findById: jest.fn().mockResolvedValue(company) } as never,
      new InvoiceDomainService(),
      { list: jest.fn().mockResolvedValue([]) } as never,
    );
    await expect(intake.prepare(dto, TENANT, 'test')).resolves.toBeDefined();
  });
});
