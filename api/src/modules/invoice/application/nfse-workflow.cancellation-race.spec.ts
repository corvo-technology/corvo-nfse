import { Logger } from '@nestjs/common';
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import { NfseWorkflowService } from './nfse-workflow.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function queuedInvoice(): Invoice {
  return Invoice.create(
    {
      companyId: 'company-1',
      environment: 'test',
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
}

function build(invoice: Invoice, transition: jest.Mock) {
  const invoices = {
    findByIdAndTenantId: jest.fn().mockResolvedValue(invoice),
    save: jest.fn(),
    saveDpsInfo: jest.fn(),
  };
  const provider = { issue: jest.fn() };
  const service = new NfseWorkflowService(
    invoices as any,
    {
      reserveNext: jest.fn().mockResolvedValue({ series: '1', number: 7 }),
    },
    {
      findById: jest.fn().mockResolvedValue({
        id: 'company-1',
        taxId: VALID_CNPJ,
        legalName: 'Empresa',
        municipalityCode: '3550308',
        taxRegime: 'Simples Nacional',
      }),
    } as any,
    {} as any,
    { resolve: () => provider, isSimulated: () => true } as any,
    { transition } as any,
    { add: jest.fn() } as any,
    { publish: jest.fn() } as any,
    {} as any,
    {
      findEffective: jest.fn().mockResolvedValue({
        taxRegime: 'SIMPLES_NACIONAL',
        specialTaxRegime: null,
      }),
    } as any,
    { findByInvoiceId: jest.fn().mockResolvedValue(null) } as any,
    {} as any,
    { get: jest.fn(), getOrThrow: jest.fn() } as any,
  );
  return { service, invoices, provider };
}

describe('NfseWorkflowService — cancellation race', () => {
  it('persists only the DPS identity, never the stale status', async () => {
    const invoice = queuedInvoice();
    const transition = jest
      .fn()
      .mockRejectedValue(new ConcurrentInvoiceTransitionError(invoice.id));
    const { service, invoices } = build(invoice, transition);
    await service.process({ invoiceId: invoice.id, tenantId });
    expect(invoices.saveDpsInfo).toHaveBeenCalledWith(invoice);
    expect(invoices.save).not.toHaveBeenCalled();
  });

  it('stops without issuing when the invoice was cancelled concurrently', async () => {
    const invoice = queuedInvoice();
    const transition = jest
      .fn()
      .mockRejectedValue(new ConcurrentInvoiceTransitionError(invoice.id));
    const { service, provider } = build(invoice, transition);
    await expect(
      service.process({ invoiceId: invoice.id, tenantId }),
    ).resolves.toBeUndefined();
    expect(provider.issue).not.toHaveBeenCalled();
  });

  it('logs the concurrent-transition exit with the invoice id', async () => {
    const invoice = queuedInvoice();
    const transition = jest
      .fn()
      .mockRejectedValue(new ConcurrentInvoiceTransitionError(invoice.id));
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const { service } = build(invoice, transition);
    await service.process({ invoiceId: invoice.id, tenantId });
    expect(debug).toHaveBeenCalledWith(expect.stringContaining(invoice.id));
    debug.mockRestore();
  });

  it('ignores a late emission job for an already cancelled invoice', async () => {
    const invoice = queuedInvoice();
    invoice.requestCancellation(cancellationReason('other'));
    const transition = jest.fn();
    const { service, provider, invoices } = build(invoice, transition);
    await service.process({ invoiceId: invoice.id, tenantId });
    expect(transition).not.toHaveBeenCalled();
    expect(invoices.saveDpsInfo).not.toHaveBeenCalled();
    expect(provider.issue).not.toHaveBeenCalled();
  });
});
