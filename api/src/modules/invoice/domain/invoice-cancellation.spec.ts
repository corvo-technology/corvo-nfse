import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from './invoice';
import { cancellationReason } from './cancellation-reason';
import {
  InvalidCancellationReasonError,
  InvalidInvoiceTransitionError,
  InvoiceNotCancellableError,
} from './errors';
import type { InvoiceStatus } from './invoice-status';

const fiscalReason = cancellationReason(
  'issue_error',
  'Valor do serviço informado incorretamente',
);

function invoiceIn(status: InvoiceStatus): Invoice {
  const created = Invoice.create(
    {
      companyId: 'company-1',
      customer: { taxId: VALID_CNPJ, name: 'Cliente' },
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-10-14'),
    },
    'tenant-1',
  );
  return Invoice.reconstitute({
    ...created.toSnapshot(),
    status,
    authorizedAt: ['authorized', 'cancelling', 'cancelled'].includes(status)
      ? new Date('2026-10-14T12:00:00Z')
      : null,
  });
}

describe('Invoice cancellation', () => {
  it('cancels a queued invoice locally without requiring a description', () => {
    const invoice = invoiceIn('queued');
    const event = invoice.requestCancellation(cancellationReason('other'));
    expect(invoice.status).toBe('cancelled');
    expect(event.fromStatus).toBe('queued');
    expect(event.toStatus).toBe('cancelled');
    expect(invoice.cancelledAt).toEqual(event.createdAt);
    expect(invoice.cancellationReason).toEqual({
      code: 'other',
      description: null,
    });
  });

  it('moves an authorized invoice to cancelling and records the reason', () => {
    const invoice = invoiceIn('authorized');
    const event = invoice.requestCancellation(fiscalReason);
    expect(invoice.status).toBe('cancelling');
    expect(event.toStatus).toBe('cancelling');
    expect(invoice.cancelledAt).toBeNull();
    expect(invoice.cancellationReason).toEqual(fiscalReason);
  });

  it.each([
    ['shorter than 15', 'curto demais'],
    ['longer than 255', 'x'.repeat(256)],
    ['missing', undefined],
  ])(
    'refuses a fiscal cancellation whose description is %s',
    (_label, description) => {
      const invoice = invoiceIn('authorized');
      expect(() =>
        invoice.requestCancellation(cancellationReason('other', description)),
      ).toThrow(InvalidCancellationReasonError);
      expect(invoice.status).toBe('authorized');
      expect(invoice.cancellationReason).toBeNull();
    },
  );

  it.each([
    'processing',
    'retry_pending',
    'reconciliation_required',
    'manual_review',
    'rejected',
    'failed',
    'cancelling',
    'cancelled',
  ] as const)('refuses to cancel a %s invoice', (status) => {
    expect(() => invoiceIn(status).requestCancellation(fiscalReason)).toThrow(
      InvoiceNotCancellableError,
    );
  });

  it('confirms a pending cancellation', () => {
    const invoice = invoiceIn('authorized');
    invoice.requestCancellation(fiscalReason);
    const event = invoice.confirmCancellation();
    expect(invoice.status).toBe('cancelled');
    expect(event.fromStatus).toBe('cancelling');
    expect(invoice.cancelledAt).toEqual(event.createdAt);
  });

  it('returns to authorized with the Sefin error when the cancellation is rejected', () => {
    const invoice = invoiceIn('authorized');
    invoice.requestCancellation(fiscalReason);
    const event = invoice.rejectCancellation('E0840', 'Prazo expirado');
    expect(invoice.status).toBe('authorized');
    expect(event.toStatus).toBe('authorized');
    expect(invoice.toSnapshot().lastErrorCode).toBe('E0840');
    expect(invoice.toSnapshot().lastErrorMessage).toBe('Prazo expirado');
  });

  it('clears the previous rejection error when a new cancellation is requested', () => {
    const invoice = invoiceIn('authorized');
    invoice.requestCancellation(fiscalReason);
    invoice.rejectCancellation('E0840', 'Prazo expirado');
    expect(invoice.toSnapshot().lastErrorCode).toBe('E0840');
    invoice.requestCancellation(fiscalReason);
    expect(invoice.toSnapshot().lastErrorCode).toBeNull();
    expect(invoice.toSnapshot().lastErrorMessage).toBeNull();
  });

  it('leaves no stale error after the cancellation is confirmed', () => {
    const invoice = invoiceIn('authorized');
    invoice.requestCancellation(fiscalReason);
    invoice.rejectCancellation('E0840', 'Prazo expirado');
    invoice.requestCancellation(fiscalReason);
    invoice.confirmCancellation();
    expect(invoice.toSnapshot().lastErrorCode).toBeNull();
    expect(invoice.toSnapshot().lastErrorMessage).toBeNull();
  });

  it('cannot confirm a cancellation that was never requested', () => {
    expect(() => invoiceIn('queued').confirmCancellation()).toThrow(
      InvalidInvoiceTransitionError,
    );
  });

  it('trims the description and treats blank text as absent', () => {
    expect(cancellationReason('other', '   ')).toEqual({
      code: 'other',
      description: null,
    });
    expect(cancellationReason('other', '  texto  ').description).toBe('texto');
  });

  it('reports wasAuthorized only after authorization', () => {
    expect(invoiceIn('queued').wasAuthorized).toBe(false);
    expect(invoiceIn('cancelled').wasAuthorized).toBe(true);
  });
});
