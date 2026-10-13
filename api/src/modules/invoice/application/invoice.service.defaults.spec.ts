import { Company } from '@/modules/company/domain/company';
import { CompanyNotFoundError } from '@/modules/company/domain/errors';
import type { AuthContext } from '@/modules/auth/auth-context';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { InvoiceDomainService } from '../domain/invoice-domain.service';
import { InvoiceService } from './invoice.service';

describe('Invoice fiscal defaults and idempotency', () => {
  const auth = { executionEnvironment: 'test' } as AuthContext;
  const dto = {
    companyTaxId: '11222333000181',
    customer: { name: 'Cliente', taxId: '52998224725' },
    service: { description: 'Desenvolvimento' },
    amount: 150.5,
    competenceDate: '2026-01-01',
  };
  let company: Company;
  let companies: { findByTaxId: jest.Mock; findById: jest.Mock };
  let repository: { findByIdempotencyKey: jest.Mock };
  let lifecycle: { submit: jest.Mock };
  let queues: { add: jest.Mock };
  let service: InvoiceService;

  beforeEach(() => {
    company = Company.create(
      {
        legalName: 'Empresa',
        taxId: dto.companyTaxId,
        taxRegime: 'MEI',
        municipalityCode: '3550308',
        defaultServiceCode: '010101',
      },
      'tenant-1',
    );
    companies = {
      findByTaxId: jest.fn().mockResolvedValue(company),
      findById: jest.fn().mockResolvedValue(company),
    };
    repository = { findByIdempotencyKey: jest.fn().mockResolvedValue(null) };
    lifecycle = { submit: jest.fn() };
    queues = { add: jest.fn() };
    service = new InvoiceService(
      repository as any,
      {} as any,
      {} as any,
      companies as any,
      {} as any,
      queues as any,
      lifecycle as any,
      {} as any,
      new InvoiceDomainService(),
    );
  });

  it('persists resolved values and preserves them when company defaults change', async () => {
    const first = await service.emit(dto, 'tenant-1', auth, 'request-1');
    expect(first.toSnapshot().serviceSnapshot).toEqual({
      code: '010101',
      municipalityCode: '3550308',
      description: 'Desenvolvimento',
    });
    expect(companies.findByTaxId).toHaveBeenCalledWith(
      dto.companyTaxId,
      'tenant-1',
      'test',
    );
    expect(repository.findByIdempotencyKey).toHaveBeenCalledWith(
      'request-1',
      'tenant-1',
      'test',
    );
    company.update({
      defaultServiceCode: '010201',
      municipalityCode: '3170206',
    });
    repository.findByIdempotencyKey.mockResolvedValue(first);
    companies.findByTaxId.mockClear();
    const repeated = await service.emit(dto, 'tenant-1', auth, 'request-1');
    expect(repeated.id).toBe(first.id);
    expect(repeated.toSnapshot().serviceSnapshot).toEqual(
      first.toSnapshot().serviceSnapshot,
    );
    expect(companies.findByTaxId).not.toHaveBeenCalled();
    expect(lifecycle.submit).toHaveBeenCalledTimes(1);
  });

  it('uses updated defaults only for new invoices', async () => {
    company.update({
      defaultServiceCode: '010201',
      municipalityCode: '3170206',
    });
    const invoice = await service.emit(dto, 'tenant-1', auth);
    expect(invoice.toSnapshot().serviceSnapshot).toMatchObject({
      code: '010201',
      municipalityCode: '3170206',
    });
  });

  it('rejects legacy companies without municipality even with an explicit service location', async () => {
    companies.findByTaxId.mockResolvedValue(
      Company.reconstitute({
        ...company.toSnapshot(),
        municipalityCode: undefined,
      }),
    );
    await expect(
      service.emit(
        { ...dto, service: { code: '010101', municipalityCode: '3170206' } },
        'tenant-1',
        auth,
      ),
    ).rejects.toBeInstanceOf(FiscalValidationError);
    expect(lifecycle.submit).not.toHaveBeenCalled();
  });

  it('does not issue using a company outside the scoped lookup', async () => {
    companies.findByTaxId.mockRejectedValue(
      new CompanyNotFoundError(dto.companyTaxId),
    );
    await expect(
      service.emit(dto, 'other-tenant', {
        executionEnvironment: 'live',
      } as AuthContext),
    ).rejects.toBeInstanceOf(CompanyNotFoundError);
    expect(companies.findByTaxId).toHaveBeenCalledWith(
      dto.companyTaxId,
      'other-tenant',
      'live',
    );
    expect(lifecycle.submit).not.toHaveBeenCalled();
  });
});
