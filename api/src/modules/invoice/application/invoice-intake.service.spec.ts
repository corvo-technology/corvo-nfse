import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Company } from '@/modules/company/domain/company';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { InvoiceDomainService } from '../domain/invoice-domain.service';
import { InvoiceIntakeService } from './invoice-intake.service';

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
