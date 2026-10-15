import { IdempotencyConflictError } from '../domain/errors';
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
      repository as never,
      {} as never,
      {} as never,
      companies as never,
      {} as never,
      queues as never,
      lifecycle as never,
      {} as never,
      new InvoiceDomainService(),
      {} as never,
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
  it('does not enqueue nfse-emission directly on emit (the outbox owns the entry)', async () => {
    await service.emit(dto, 'tenant-1', auth);
    expect(lifecycle.submit).toHaveBeenCalledTimes(1);
    expect(queues.add).not.toHaveBeenCalled();
  });

  it('an idempotent replay returns the stored invoice without submitting or enqueueing', async () => {
    const first = await service.emit(dto, 'tenant-1', auth, 'replay-key');
    lifecycle.submit.mockClear();
    repository.findByIdempotencyKey.mockResolvedValue(first);
    const repeated = await service.emit(dto, 'tenant-1', auth, 'replay-key');
    expect(repeated.id).toBe(first.id);
    expect(lifecycle.submit).not.toHaveBeenCalled();
    expect(queues.add).not.toHaveBeenCalled();
  });

  it('on a 23505 race returns the winner without enqueueing', async () => {
    const winner = await service.emit(dto, 'tenant-1', auth, 'race-key');
    lifecycle.submit.mockReset();
    lifecycle.submit.mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );
    repository.findByIdempotencyKey.mockReset();
    repository.findByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const result = await service.emit(dto, 'tenant-1', auth, 'race-key');
    expect(result).toBe(winner);
    expect(queues.add).not.toHaveBeenCalled();
  });

  it('on a 23505 race with a different payload throws IdempotencyConflictError', async () => {
    const winner = await service.emit(dto, 'tenant-1', auth, 'race-key-2');
    lifecycle.submit.mockReset();
    lifecycle.submit.mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );
    repository.findByIdempotencyKey.mockReset();
    repository.findByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    await expect(
      service.emit({ ...dto, amount: 999 }, 'tenant-1', auth, 'race-key-2'),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
