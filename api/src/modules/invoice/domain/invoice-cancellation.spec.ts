import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from './invoice';
import {
  assertFiscalCancellationReason,
  CANCELLATION_DESCRIPTION_MAX,
  CANCELLATION_DESCRIPTION_MIN,
  CANCELLATION_REASON_CODES,
  cancellationReason,
  DEFAULT_CANCELLATION_DESCRIPTION,
} from './cancellation-reason';
import {
  InvalidCancellationReasonError,
  InvalidInvoiceTransitionError,
  InvoiceNotCancellableError,
} from './errors';
import {
  EMISSION_IN_PROGRESS_STATUSES,
  INVOICE_STATUSES,
  type InvoiceStatus,
} from './invoice-status';

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

describe('Pending cancellation while the invoice is being issued', () => {
  it.each(CANCELLATION_REASON_CODES)(
    'default description for %s fits the fiscal limits',
    (code) => {
      const description = DEFAULT_CANCELLATION_DESCRIPTION[code];
      expect(description.length).toBeGreaterThanOrEqual(
        CANCELLATION_DESCRIPTION_MIN,
      );
      expect(description.length).toBeLessThanOrEqual(
        CANCELLATION_DESCRIPTION_MAX,
      );
      expect(() =>
        assertFiscalCancellationReason({ code, description }),
      ).not.toThrow();
    },
  );

  it('fills cancellationRequestedAt when cancelling a queued invoice', () => {
    const invoice = invoiceIn('queued');
    const event = invoice.requestCancellation(cancellationReason('other'));
    expect(invoice.cancellationRequestedAt).toEqual(event.createdAt);
  });

  it('fills cancellationRequestedAt when requesting a fiscal cancellation', () => {
    const invoice = invoiceIn('authorized');
    const event = invoice.requestCancellation(fiscalReason);
    expect(invoice.cancellationRequestedAt).toEqual(event.createdAt);
  });

  it('registers a pending cancellation in processing without changing status', () => {
    const invoice = invoiceIn('processing');
    invoice.registerPendingCancellation(fiscalReason);
    expect(invoice.status).toBe('processing');
    expect(invoice.cancellationReason).toEqual(fiscalReason);
    expect(invoice.cancellationRequestedAt).toBeInstanceOf(Date);
  });

  it('rejects a pending cancellation with an invalid description', () => {
    const invoice = invoiceIn('processing');
    expect(() =>
      invoice.registerPendingCancellation(cancellationReason('other', 'curta')),
    ).toThrow(InvalidCancellationReasonError);
    expect(invoice.cancellationRequestedAt).toBeNull();
  });

  it.each(INVOICE_STATUSES.filter((s) => s !== 'processing'))(
    'refuses to register a pending cancellation in %s',
    (status) => {
      expect(() =>
        invoiceIn(status).registerPendingCancellation(fiscalReason),
      ).toThrow(InvoiceNotCancellableError);
    },
  );

  it.each(INVOICE_STATUSES)('hasPendingCancellation in %s', (status) => {
    const base = invoiceIn(status);
    const withDate = Invoice.reconstitute({
      ...base.toSnapshot(),
      cancellationRequestedAt: new Date('2026-10-14T13:00:00Z'),
    });
    expect(withDate.hasPendingCancellation).toBe(
      EMISSION_IN_PROGRESS_STATUSES.includes(status),
    );
    expect(base.hasPendingCancellation).toBe(false);
  });

  it('discards the pending cancellation, clearing the three fields', () => {
    const invoice = invoiceIn('processing');
    invoice.registerPendingCancellation(fiscalReason);
    invoice.discardPendingCancellation();
    expect(invoice.cancellationReason).toBeNull();
    expect(invoice.toSnapshot().cancellationDescription).toBeNull();
    expect(invoice.cancellationRequestedAt).toBeNull();
    expect(invoice.hasPendingCancellation).toBe(false);
  });
});
