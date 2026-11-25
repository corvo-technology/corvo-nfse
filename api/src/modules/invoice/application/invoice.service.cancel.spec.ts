import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import {
  ConcurrentInvoiceTransitionError,
  InvoiceNotCancellableError,
  InvalidCancellationReasonError,
} from '../domain/errors';
import type { InvoiceStatus } from '../domain/invoice-status';
import { DEFAULT_CANCELLATION_DESCRIPTION } from '../domain/cancellation-reason';
import { InvoiceService } from './invoice.service';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';

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

function build(invoice: Invoice, stored?: Invoice) {
  const lifecycle = { transition: jest.fn().mockResolvedValue(true) };
  const webhooks = { publish: jest.fn() };
  const findByIdAndTenantId = jest.fn().mockResolvedValue(invoice);
  const registerCancellationIntent = jest.fn().mockResolvedValue(true);
  if (stored)
    findByIdAndTenantId
      .mockResolvedValueOnce(invoice)
      .mockResolvedValue(stored);
  const audit = new FakeAccountAudit();
  const service = new InvoiceService(
    { findByIdAndTenantId, registerCancellationIntent } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    lifecycle as never,
    {} as never,
    {} as never,
    webhooks as never,
    { isSimulated: (environment: string) => environment !== 'live' } as never,
    audit,
  );
  return { service, lifecycle, webhooks, registerCancellationIntent, audit };
}

const fiscal = {
  reason: 'issue_error' as const,
  description: 'Valor do serviço informado incorretamente',
};

describe('InvoiceService.cancel audit', () => {
  it('records invoice.cancelled after a cancellation is requested', async () => {
    const invoice = invoiceIn('authorized');
    const { service, audit } = build(invoice);
    await service.cancel(invoice.id, tenantId, 'test', fiscal);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      action: 'invoice.cancelled',
      tenantId,
      environment: 'test',
      target: { type: 'invoice', id: invoice.id, label: 'Cliente' },
    });
  });

  it('records a cancellation intent on an invoice still being issued', async () => {
    const invoice = invoiceIn('processing');
    const { service, audit } = build(invoice);
    await service.cancel(invoice.id, tenantId, 'test', fiscal);
    expect(audit.events.map((e) => e.action)).toEqual(['invoice.cancelled']);
  });

  it('does not record a repeated cancel of an invoice already cancelled', async () => {
    const invoice = invoiceIn('cancelled');
    const { service, audit } = build(invoice);
    await service.cancel(invoice.id, tenantId, 'test', fiscal);
    expect(audit.events).toHaveLength(0);
  });

  it('keeps the action when the recorder fails', async () => {
    const invoice = invoiceIn('authorized');
    const { service, audit } = build(invoice);
    jest.spyOn(audit, 'record').mockRejectedValue(new Error('boom'));
    await expect(
      service.cancel(invoice.id, tenantId, 'test', fiscal),
    ).resolves.toBe(invoice);
  });
});

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
      expect.objectContaining({ toStatus: 'cancelled' }),
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

  it.each([
    'retry_pending',
    'reconciliation_required',
    'manual_review',
    'rejected',
    'failed',
  ] as const)('refuses an invoice in %s', async (status) => {
    const invoice = invoiceIn(status);
    const { service, lifecycle, registerCancellationIntent } = build(invoice);
    await expect(
      service.cancel(invoice.id, tenantId, 'test', fiscal),
    ).rejects.toBeInstanceOf(InvoiceNotCancellableError);
    expect(lifecycle.transition).not.toHaveBeenCalled();
    expect(registerCancellationIntent).not.toHaveBeenCalled();
  });

  it('refuses a fiscal cancellation without a valid description', async () => {
    const invoice = invoiceIn('authorized');
    const { service, lifecycle } = build(invoice);
    await expect(
      service.cancel(invoice.id, tenantId, 'test', { reason: 'other' }),
    ).rejects.toBeInstanceOf(InvalidCancellationReasonError);
    expect(lifecycle.transition).not.toHaveBeenCalled();
  });

  it('publishes no webhook and returns the stored invoice when the transition was not applied', async () => {
    const invoice = invoiceIn('queued');
    const stored = invoiceIn('cancelled');
    const { service, lifecycle, webhooks } = build(invoice, stored);
    lifecycle.transition.mockResolvedValue(false);
    await expect(
      service.cancel(invoice.id, tenantId, 'test', { reason: 'other' }),
    ).resolves.toBe(stored);
    expect(webhooks.publish).not.toHaveBeenCalled();
  });

  it('returns the winner without a webhook when the transition loses the race to another cancel', async () => {
    const invoice = invoiceIn('queued');
    const stored = invoiceIn('cancelled');
    const { service, lifecycle, webhooks } = build(invoice, stored);
    lifecycle.transition.mockRejectedValue(
      new ConcurrentInvoiceTransitionError(invoice.id),
    );
    await expect(
      service.cancel(invoice.id, tenantId, 'test', { reason: 'other' }),
    ).resolves.toBe(stored);
    expect(webhooks.publish).not.toHaveBeenCalled();
  });

  it('rethrows unrelated transition errors', async () => {
    const invoice = invoiceIn('queued');
    const { service, lifecycle } = build(invoice);
    lifecycle.transition.mockRejectedValue(new Error('db down'));
    await expect(
      service.cancel(invoice.id, tenantId, 'test', { reason: 'other' }),
    ).rejects.toThrow('db down');
  });

  describe('while the invoice is being issued', () => {
    it('registers the intent without transition, outbox or webhook', async () => {
      const invoice = invoiceIn('processing');
      const { service, lifecycle, webhooks, registerCancellationIntent } =
        build(invoice);
      const result = await service.cancel(invoice.id, tenantId, 'test', fiscal);
      expect(result).toBe(invoice);
      expect(result.status).toBe('processing');
      expect(result.hasPendingCancellation).toBe(true);
      expect(registerCancellationIntent).toHaveBeenCalledWith(
        invoice.id,
        tenantId,
        {
          code: 'issue_error',
          description: fiscal.description,
          requestedAt: expect.any(Date),
        },
      );
      expect(lifecycle.transition).not.toHaveBeenCalled();
      expect(webhooks.publish).not.toHaveBeenCalled();
    });

    it.each([undefined, 'curta'])(
      'rejects description %p and writes nothing',
      async (description) => {
        const invoice = invoiceIn('processing');
        const { service, registerCancellationIntent } = build(invoice);
        await expect(
          service.cancel(invoice.id, tenantId, 'test', {
            reason: 'other',
            description,
          }),
        ).rejects.toBeInstanceOf(InvalidCancellationReasonError);
        expect(registerCancellationIntent).not.toHaveBeenCalled();
      },
    );

    it('keeps the first intent and ignores a second request', async () => {
      const invoice = invoiceIn('processing');
      invoice.registerPendingCancellation({
        code: 'issue_error',
        description: fiscal.description,
      });
      const { service, registerCancellationIntent } = build(invoice);
      const result = await service.cancel(invoice.id, tenantId, 'test', {
        reason: 'other',
        description: 'Outro motivo totalmente diferente',
      });
      expect(result).toBe(invoice);
      expect(result.cancellationReason?.code).toBe('issue_error');
      expect(registerCancellationIntent).not.toHaveBeenCalled();
    });

    it('follows the fiscal path when the worker authorized it meanwhile', async () => {
      const invoice = invoiceIn('processing');
      const authorized = invoiceIn('authorized');
      const { service, lifecycle, registerCancellationIntent } = build(
        invoice,
        authorized,
      );
      registerCancellationIntent.mockResolvedValue(false);
      const result = await service.cancel(invoice.id, tenantId, 'test', fiscal);
      expect(result).toBe(authorized);
      expect(result.status).toBe('cancelling');
      expect(lifecycle.transition).toHaveBeenCalledTimes(1);
    });

    it.each(['cancelling', 'cancelled'] as const)(
      'returns the invoice when the re-read shows %s',
      async (status) => {
        const invoice = invoiceIn('processing');
        const stored = invoiceIn(status);
        const { service, lifecycle, registerCancellationIntent } = build(
          invoice,
          stored,
        );
        registerCancellationIntent.mockResolvedValue(false);
        await expect(
          service.cancel(invoice.id, tenantId, 'test', fiscal),
        ).resolves.toBe(stored);
        expect(lifecycle.transition).not.toHaveBeenCalled();
      },
    );

    it('returns the invoice when the re-read shows an intent already pending', async () => {
      const invoice = invoiceIn('processing');
      const stored = invoiceIn('processing');
      stored.registerPendingCancellation({
        code: 'other',
        description: 'Cancelamento pedido antes por outro cliente',
      });
      const { service, registerCancellationIntent } = build(invoice, stored);
      registerCancellationIntent.mockResolvedValue(false);
      await expect(
        service.cancel(invoice.id, tenantId, 'test', fiscal),
      ).resolves.toBe(stored);
    });

    it('answers not-cancellable when the re-read shows another status', async () => {
      const invoice = invoiceIn('processing');
      const { service, registerCancellationIntent } = build(
        invoice,
        invoiceIn('rejected'),
      );
      registerCancellationIntent.mockResolvedValue(false);
      await expect(
        service.cancel(invoice.id, tenantId, 'test', fiscal),
      ).rejects.toBeInstanceOf(InvoiceNotCancellableError);
    });
  });

  describe('a queued cancel that lost the race to the worker', () => {
    function lost() {
      const invoice = invoiceIn('queued');
      const ctx = build(invoice, invoiceIn('processing'));
      ctx.lifecycle.transition.mockRejectedValue(
        new ConcurrentInvoiceTransitionError(invoice.id),
      );
      return { invoice, ...ctx };
    }

    it('registers the intent with the request description and no webhook', async () => {
      const { invoice, service, webhooks, registerCancellationIntent } = lost();
      const result = await service.cancel(invoice.id, tenantId, 'test', fiscal);
      expect(result.hasPendingCancellation).toBe(true);
      expect(registerCancellationIntent).toHaveBeenCalledWith(
        result.id,
        tenantId,
        expect.objectContaining({
          code: 'issue_error',
          description: fiscal.description,
        }),
      );
      expect(webhooks.publish).not.toHaveBeenCalled();
    });

    it.each(['issue_error', 'service_not_provided', 'other'] as const)(
      'falls back to the default text for %s when no description was sent',
      async (reason) => {
        const { invoice, service, webhooks, registerCancellationIntent } =
          lost();
        const result = await service.cancel(invoice.id, tenantId, 'test', {
          reason,
        });
        expect(result.hasPendingCancellation).toBe(true);
        expect(registerCancellationIntent).toHaveBeenCalledWith(
          result.id,
          tenantId,
          expect.objectContaining({
            code: reason,
            description: DEFAULT_CANCELLATION_DESCRIPTION[reason],
          }),
        );
        expect(webhooks.publish).not.toHaveBeenCalled();
      },
    );
  });
});
