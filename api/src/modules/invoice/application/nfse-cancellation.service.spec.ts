import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import { NfseCancellationService } from './nfse-cancellation.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function cancelling(environment: 'test' | 'live' = 'test'): Invoice {
  const created = Invoice.create(
    {
      companyId: 'company-1',
      environment,
      customer: { taxId: VALID_CNPJ, name: 'Cliente' },
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-10-14'),
    },
    tenantId,
  );
  const invoice = Invoice.reconstitute({
    ...created.toSnapshot(),
    status: 'authorized',
    authorizedAt: new Date(),
    accessKey: '9'.repeat(50),
  });
  invoice.requestCancellation(
    cancellationReason('issue_error', 'Valor informado incorretamente'),
  );
  return invoice;
}

function build(invoice: Invoice | null, result: unknown) {
  const provider = { cancel: jest.fn().mockResolvedValue(result) };
  const lifecycle = { transition: jest.fn() };
  const webhooks = { publish: jest.fn() };
  const certificates = {
    decryptCredentials: jest
      .fn()
      .mockResolvedValue({ pfxBuffer: Buffer.from('pfx'), password: 'pw' }),
  };
  const service = new NfseCancellationService(
    { findByIdAndTenantId: jest.fn().mockResolvedValue(invoice) } as never,
    {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'company-1', taxId: '11222333000181' }),
    } as never,
    certificates as never,
    { resolve: jest.fn().mockReturnValue(provider) } as never,
    lifecycle as never,
    webhooks as never,
  );
  return { service, provider, lifecycle, webhooks, certificates };
}

const job = (invoice: Invoice) => ({ invoiceId: invoice.id, tenantId });

describe('NfseCancellationService', () => {
  it('confirms the cancellation and notifies when the Sefin accepts it', async () => {
    const invoice = cancelling();
    const ctx = build(invoice, { status: 'cancelled' });
    await ctx.service.process(job(invoice));
    expect(ctx.provider.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        accessKey: '9'.repeat(50),
        emitenteCnpj: '11222333000181',
        reason: 'issue_error',
        description: 'Valor informado incorretamente',
        environment: 'test',
      }),
    );
    expect(invoice.status).toBe('cancelled');
    expect(ctx.lifecycle.transition).toHaveBeenCalledTimes(1);
    expect(ctx.webhooks.publish).toHaveBeenCalledWith(
      invoice,
      'nfse.invoice.cancelled',
      { reason: 'issue_error' },
    );
  });

  it('restores authorized with the error when the Sefin rejects it', async () => {
    const invoice = cancelling();
    const ctx = build(invoice, {
      status: 'rejected',
      errorCode: 'E0840',
      errorMessage: 'Prazo expirado',
    });
    await ctx.service.process(job(invoice));
    expect(invoice.status).toBe('authorized');
    expect(ctx.webhooks.publish).toHaveBeenCalledWith(
      invoice,
      'nfse.invoice.cancellation_rejected',
      { errorCode: 'E0840', errorMessage: 'Prazo expirado' },
    );
  });

  it('throws so BullMQ retries when the result is still pending', async () => {
    const invoice = cancelling();
    const ctx = build(invoice, { status: 'pending', errorMessage: 'timeout' });
    await expect(ctx.service.process(job(invoice))).rejects.toThrow('timeout');
    expect(invoice.status).toBe('cancelling');
    expect(ctx.lifecycle.transition).not.toHaveBeenCalled();
  });

  // Characterization of the accepted risk in spec section 11 ("lost response after
  // the Sefin accepted"): if persisting the cancellation fails after the Sefin
  // accepted it, the job rejects and BullMQ retries, re-sending the cancellation
  // event. This is accepted and must be validated in the sandbox.
  it('rejects without notifying when the transition fails after the Sefin accepted', async () => {
    const invoice = cancelling();
    const ctx = build(invoice, { status: 'cancelled' });
    ctx.lifecycle.transition.mockRejectedValue(new Error('db down'));
    await expect(ctx.service.process(job(invoice))).rejects.toThrow('db down');
    expect(ctx.webhooks.publish).not.toHaveBeenCalled();
  });

  it('decrypts the company certificate in live', async () => {
    const invoice = cancelling('live');
    const ctx = build(invoice, { status: 'cancelled' });
    await ctx.service.process(job(invoice));
    expect(ctx.certificates.decryptCredentials).toHaveBeenCalledWith(
      'company-1',
      tenantId,
      'live',
    );
    expect(ctx.provider.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ p12Password: 'pw' }),
    );
  });

  it('does nothing for an invoice that is no longer cancelling', async () => {
    const invoice = cancelling();
    invoice.confirmCancellation();
    const ctx = build(invoice, { status: 'cancelled' });
    await ctx.service.process(job(invoice));
    expect(ctx.provider.cancel).not.toHaveBeenCalled();
  });
});
