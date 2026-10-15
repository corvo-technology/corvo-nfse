import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import {
  InvoiceNotCancellableError,
  InvalidCancellationReasonError,
} from '../domain/errors';
import type { InvoiceStatus } from '../domain/invoice-status';
import { InvoiceService } from './invoice.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function invoiceIn(status: InvoiceStatus): Invoice {
  const created = Invoice.create(
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
  return Invoice.reconstitute({
    ...created.toSnapshot(),
    status,
    authorizedAt: status === 'queued' ? null : new Date(),
  });
}

function build(invoice: Invoice) {
  const lifecycle = { transition: jest.fn() };
  const webhooks = { publish: jest.fn() };
  const service = new InvoiceService(
    { findByIdAndTenantId: jest.fn().mockResolvedValue(invoice) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    lifecycle as never,
    {} as never,
    {} as never,
    webhooks as never,
  );
  return { service, lifecycle, webhooks };
}

const fiscal = {
  reason: 'issue_error' as const,
  description: 'Valor do serviço informado incorretamente',
};

describe('InvoiceService.cancel', () => {
  it('cancels a queued invoice locally and notifies without an outbox message', async () => {
    const invoice = invoiceIn('queued');
    const { service, lifecycle, webhooks } = build(invoice);
    const result = await service.cancel(invoice.id, tenantId, 'test', {
      reason: 'other',
    });
    expect(result.status).toBe('cancelled');
    expect(lifecycle.transition).toHaveBeenCalledWith(
      invoice,
      expect.objectContaining({}),
      undefined,
    );
    expect(webhooks.publish).toHaveBeenCalledWith(
      invoice,
      'nfse.invoice.cancelled',
      { reason: 'other' },
    );
  });

  it('requests a fiscal cancellation with an outbox message for an authorized invoice', async () => {
    const invoice = invoiceIn('authorized');
    const { service, lifecycle, webhooks } = build(invoice);
    const result = await service.cancel(invoice.id, tenantId, 'test', fiscal);
    expect(result.status).toBe('cancelling');
    const [, , message] = lifecycle.transition.mock.calls[0] as unknown[];
    expect(message).toMatchObject({
      type: 'invoice.cancel',
      aggregateId: invoice.id,
    });
    expect(webhooks.publish).not.toHaveBeenCalled();
  });

  it.each(['cancelling', 'cancelled'] as const)(
    'is idempotent for an invoice already %s',
    async (status) => {
      const invoice = invoiceIn(status);
      const { service, lifecycle, webhooks } = build(invoice);
      await expect(
        service.cancel(invoice.id, tenantId, 'test', fiscal),
      ).resolves.toBe(invoice);
      expect(lifecycle.transition).not.toHaveBeenCalled();
      expect(webhooks.publish).not.toHaveBeenCalled();
    },
  );

  it('refuses an invoice that is being issued', async () => {
    const invoice = invoiceIn('processing');
    const { service } = build(invoice);
    await expect(
      service.cancel(invoice.id, tenantId, 'test', fiscal),
    ).rejects.toBeInstanceOf(InvoiceNotCancellableError);
  });

  it('refuses a fiscal cancellation without a valid description', async () => {
    const invoice = invoiceIn('authorized');
    const { service, lifecycle } = build(invoice);
    await expect(
      service.cancel(invoice.id, tenantId, 'test', { reason: 'other' }),
    ).rejects.toBeInstanceOf(InvalidCancellationReasonError);
    expect(lifecycle.transition).not.toHaveBeenCalled();
  });
});
