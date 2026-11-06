import { InvoiceIntakeService } from './invoice-intake.service';
import { IdempotencyConflictError } from '../domain/errors';
import { Company } from '@/modules/company/domain/company';
import { InvoiceDomainService } from '../domain/invoice-domain.service';
import { InvoiceService } from './invoice.service';
import { IntegrationInvoiceIssuer } from './integration-invoice-issuer';
import type { Invoice } from '../domain/invoice';
import type { CreateInvoiceDto } from '../http/invoice.dto';

describe('IntegrationInvoiceIssuer', () => {
  const request = {
    companyTaxId: '11222333000181',
    customer: { name: 'Cliente', taxId: '52998224725' },
    service: { description: 'Consultoria' },
    amount: 49.9,
    competenceDate: '2026-10-29',
  } as unknown as CreateInvoiceDto;
  let companies: {
    findByTaxId: jest.Mock;
    findById: jest.Mock;
    ensureReady: jest.Mock;
  };
  let certificates: { getActive: jest.Mock };
  let repository: { findByIdempotencyKey: jest.Mock };
  let lifecycle: { submit: jest.Mock };
  let issuer: IntegrationInvoiceIssuer;

  beforeEach(() => {
    const company = Company.create(
      {
        legalName: 'Empresa',
        taxId: '11222333000181',
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
    const service = new InvoiceService(
      repository as never,
      {} as never,
      {} as never,
      companies as never,
      certificates as never,
      {} as never,
      lifecycle as never,
      { getStatus: jest.fn().mockResolvedValue({ dailyLimit: null }) } as never,
      new InvoiceIntakeService(companies as never, new InvoiceDomainService()),
      {} as never,
      { isSimulated: (environment: string) => environment !== 'live' } as never,
    );
    issuer = new IntegrationInvoiceIssuer(service, repository as never);
  });

  it('issues through the normal emission path with the idempotency key and no AuthContext', async () => {
    const result = await issuer.issue({
      tenantId: 'tenant-1',
      environment: 'test',
      request,
      idempotencyKey: 'integ_1',
    });
    expect(lifecycle.submit).toHaveBeenCalledTimes(1);
    const submitted = (
      lifecycle.submit.mock.calls as unknown[][]
    )[0][0] as Invoice;
    expect(submitted.idempotencyKey).toBe('integ_1');
    expect(result).toEqual({ invoiceId: submitted.id, replay: false });
  });

  it('a second call with the same key and request returns the same invoice as a replay, without a new submit', async () => {
    const first = await issuer.issue({
      tenantId: 'tenant-1',
      environment: 'test',
      request,
      idempotencyKey: 'integ_1',
    });
    repository.findByIdempotencyKey.mockResolvedValue(
      (lifecycle.submit.mock.calls as unknown[][])[0][0],
    );
    const again = await issuer.issue({
      tenantId: 'tenant-1',
      environment: 'test',
      request,
      idempotencyKey: 'integ_1',
    });
    expect(again).toEqual({ invoiceId: first.invoiceId, replay: true });
    expect(lifecycle.submit).toHaveBeenCalledTimes(1);
  });

  it('the same key with a different request is an idempotency conflict', async () => {
    await issuer.issue({
      tenantId: 'tenant-1',
      environment: 'test',
      request,
      idempotencyKey: 'integ_1',
    });
    repository.findByIdempotencyKey.mockResolvedValue(
      (lifecycle.submit.mock.calls as unknown[][])[0][0],
    );
    await expect(
      issuer.issue({
        tenantId: 'tenant-1',
        environment: 'test',
        request: { ...request, amount: 99 },
        idempotencyKey: 'integ_1',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('the environment decides the live checks', async () => {
    await issuer.issue({
      tenantId: 'tenant-1',
      environment: 'test',
      request,
      idempotencyKey: 'a',
    });
    expect(companies.ensureReady).not.toHaveBeenCalled();
    await issuer.issue({
      tenantId: 'tenant-1',
      environment: 'live',
      request,
      idempotencyKey: 'b',
    });
    expect(companies.ensureReady).toHaveBeenCalledTimes(1);
    expect(certificates.getActive).toHaveBeenCalledTimes(1);
  });
});
