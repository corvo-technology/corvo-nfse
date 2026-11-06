import { InvoiceIntakeService } from './invoice-intake.service';
import { IdempotencyConflictError } from '../domain/errors';
import { Company } from '@/modules/company/domain/company';
import type { AuthContext } from '@/modules/auth/auth-context';
import { InvoiceDomainService } from '../domain/invoice-domain.service';
import { InvoiceService } from './invoice.service';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';

describe('InvoiceService.prepareEmission', () => {
  const testAuth = { executionEnvironment: 'test' } as AuthContext;
  const liveAuth = { executionEnvironment: 'live' } as AuthContext;
  const dto = {
    companyTaxId: '11222333000181',
    customer: { name: 'Cliente', taxId: '52998224725' },
    service: { description: 'Desenvolvimento' },
    amount: 150.5,
    competenceDate: '2026-01-01',
  };
  let companies: {
    findByTaxId: jest.Mock;
    findById: jest.Mock;
    ensureReady: jest.Mock;
  };
  let certificates: { getActive: jest.Mock };
  let repository: { findByIdempotencyKey: jest.Mock };
  let lifecycle: { submit: jest.Mock };
  let providers: { isSimulated: jest.Mock };
  let service: InvoiceService;

  beforeEach(() => {
    const company = Company.create(
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
      ensureReady: jest.fn().mockResolvedValue(undefined),
    };
    certificates = { getActive: jest.fn().mockResolvedValue({}) };
    repository = { findByIdempotencyKey: jest.fn().mockResolvedValue(null) };
    lifecycle = { submit: jest.fn() };
    providers = { isSimulated: jest.fn().mockReturnValue(false) };
    service = new InvoiceService(
      repository as never,
      {} as never,
      {} as never,
      companies as never,
      certificates as never,
      {} as never,
      lifecycle as never,
      { getStatus: jest.fn() } as never,
      new InvoiceIntakeService(companies as never, new InvoiceDomainService()),
      {} as never,
      providers as never,
    );
  });

  it('returns ready with an unsaved queued invoice and its queued event', async () => {
    const prepared = await service.prepareEmission(dto, 'tenant-1', testAuth);
    expect(prepared.kind).toBe('ready');
    if (prepared.kind !== 'ready') return;
    expect(prepared.event.invoiceId).toBe(prepared.invoice.id);
    expect(prepared.invoice.status).toBe('queued');
    expect(lifecycle.submit).not.toHaveBeenCalled();
  });

  it('a test invoice needs a ready company and an active certificate, like a live one (it goes to the Sefin Produção Restrita)', async () => {
    await service.prepareEmission(dto, 'tenant-1', testAuth);
    expect(companies.ensureReady).toHaveBeenCalledWith(
      expect.any(String),
      'tenant-1',
      'test',
    );
    expect(certificates.getActive).toHaveBeenCalledWith(
      expect.any(String),
      'tenant-1',
      'test',
    );
  });

  it('a test invoice needs neither while the simulator is on (CI and e2e)', async () => {
    providers.isSimulated.mockReturnValue(true);
    await service.prepareEmission(dto, 'tenant-1', testAuth);
    expect(companies.ensureReady).not.toHaveBeenCalled();
    expect(certificates.getActive).not.toHaveBeenCalled();
  });

  it('returns replay when the idempotency key exists with the same hash', async () => {
    await service.emit(dto, 'tenant-1', testAuth, 'key-1');
    const stored = (lifecycle.submit.mock.calls as unknown[][])[0]?.[0];
    repository.findByIdempotencyKey.mockResolvedValue(stored);
    companies.findByTaxId.mockClear();

    const prepared = await service.prepareEmission(
      dto,
      'tenant-1',
      testAuth,
      'key-1',
    );

    expect(prepared).toEqual({ kind: 'replay', invoice: stored });
    expect(companies.findByTaxId).not.toHaveBeenCalled();
  });

  it('throws IdempotencyConflictError when the key exists with a different hash', async () => {
    await service.emit(dto, 'tenant-1', testAuth, 'key-1');
    repository.findByIdempotencyKey.mockResolvedValue(
      (lifecycle.submit.mock.calls as unknown[][])[0]?.[0],
    );

    await expect(
      service.prepareEmission(
        { ...dto, amount: 999 },
        'tenant-1',
        testAuth,
        'key-1',
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('a live invoice always needs a ready company and an active certificate', async () => {
    providers.isSimulated.mockReturnValue(false);
    await service.prepareEmission(dto, 'tenant-1', liveAuth);
    expect(companies.ensureReady).toHaveBeenCalledTimes(1);
    expect(certificates.getActive).toHaveBeenCalledTimes(1);
  });

  it.each(['2026-W53', '2026-366', '2026-13-45'])(
    'rejects the unparsable competenceDate %s with a validation error instead of crashing',
    async (competenceDate) => {
      const error = await service
        .prepareEmission({ ...dto, competenceDate }, 'tenant-1', testAuth)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FiscalValidationError);
      expect((error as FiscalValidationError).issues[0]).toMatchObject({
        field: 'competenceDate',
        code: 'invalid_date',
      });
    },
  );
});
