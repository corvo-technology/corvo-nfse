import { Invoice } from './invoice';
import { InvalidInvoiceTransitionError } from './errors';
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';

describe('Invoice', () => {
  const defaultInput = {
    companyId: 'company-123',
    customer: {
      taxId: VALID_CNPJ,
      name: 'Customer Name',
      email: 'customer@example.com',
      address: {
        city: 'Sao Paulo',
        state: 'SP',
        country: 'BR',
      },
    },
    service: {
      description: 'Service description',
      code: '010101',
      municipalityCode: '3550308',
    },
    amount: 10000,
    competenceDate: new Date('2024-01-15'),
  };

  describe('create', () => {
    it('preserves scheduledFor in snapshots and JSON', () => {
      const scheduledFor = new Date('2026-10-14T03:00:00Z');
      const invoice = Invoice.create(
        { ...defaultInput, scheduledFor },
        'tenant-123',
      );
      expect(invoice.scheduledFor).toEqual(scheduledFor);
      expect(invoice.toSnapshot().scheduledFor).toEqual(scheduledFor);
      const serialized = JSON.parse(JSON.stringify(invoice)) as {
        props: { scheduledFor: string };
      };
      expect(serialized.props.scheduledFor).toBe(scheduledFor.toISOString());
      const immediate = Invoice.create(defaultInput, 'tenant-123');
      expect(immediate.scheduledFor).toBeNull();
      expect(immediate.toSnapshot().scheduledFor).toBeNull();
    });
    it('creates an invoice in queued status', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123', 'idem-key-1');

      expect(invoice.status).toBe('queued');
      expect(invoice.id).toBeDefined();
      expect(invoice.companyId).toBe('company-123');
      expect(invoice.tenantId).toBe('tenant-123');
      expect(invoice.idempotencyKey).toBe('idem-key-1');
      expect(invoice.toSnapshot().amount).toBe(10000);
      expect(invoice.toSnapshot().currency).toBe('BRL');
      expect(invoice.toSnapshot().fiscalProvider).toBe('national');
    });

    it('creates invoice without idempotency key', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      expect(invoice.status).toBe('queued');
      expect(invoice.idempotencyKey).toBeNull();
    });

    it('initializes documents and email fields to null', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      expect(invoice.documentsReadyAt).toBeNull();
      expect(invoice.lastEmailStatus).toBeNull();
      expect(invoice.lastEmailSentAt).toBeNull();
    });

    it('stores customer and service snapshots', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      expect(invoice.toSnapshot().customerSnapshot.taxId).toBe(VALID_CNPJ);
      expect(invoice.toSnapshot().customerSnapshot.name).toBe('Customer Name');
      expect(invoice.toSnapshot().serviceSnapshot.code).toBe('010101');
      expect(invoice.toSnapshot().serviceSnapshot.municipalityCode).toBe(
        '3550308',
      );
    });

    it('sets dps fields to null initially', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      expect(invoice.dpsNumber).toBeNull();
      expect(invoice.accessKey).toBeNull();
    });
  });

  describe('transitionTo', () => {
    it('transitions queued to processing', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      expect(invoice.status).toBe('queued');

      const event = invoice.transitionTo('processing');

      expect(invoice.status).toBe('processing');
      expect(event.fromStatus).toBe('queued');
      expect(event.toStatus).toBe('processing');
    });

    it('transitions processing to authorized', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();

      invoice.transitionTo('authorized');

      expect(invoice.status).toBe('authorized');
    });

    it('transitions processing to rejected', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();

      invoice.transitionTo('rejected', 'Validation failed');

      expect(invoice.status).toBe('rejected');
    });

    it('transitions processing to retry_pending', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();

      invoice.transitionTo('retry_pending');

      expect(invoice.status).toBe('retry_pending');
    });

    it('transitions retry_pending back to processing', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();
      invoice.transitionTo('retry_pending');

      invoice.transitionTo('processing');

      expect(invoice.status).toBe('processing');
    });

    it('transitions processing to reconciliation_required', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();

      invoice.transitionTo('reconciliation_required', 'Manual review needed');

      expect(invoice.status).toBe('reconciliation_required');
    });

    it('transitions reconciliation_required to authorized', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();
      invoice.transitionTo('reconciliation_required', 'Review complete');

      invoice.transitionTo('authorized');

      expect(invoice.status).toBe('authorized');
    });

    it('transitions reconciliation_required to manual_review', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();
      invoice.transitionTo('reconciliation_required', 'Escalated');

      invoice.transitionTo('manual_review');

      expect(invoice.status).toBe('manual_review');
    });

    it('transitions processing to failed', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();

      invoice.transitionTo('failed', 'System error');

      expect(invoice.status).toBe('failed');
    });

    it('rejects invalid transition from queued to authorized', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      expect(() => invoice.transitionTo('authorized')).toThrow(
        InvalidInvoiceTransitionError,
      );
      expect(invoice.status).toBe('queued');
    });

    it('rejects transition from terminal state (authorized)', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();
      invoice.transitionTo('authorized');

      expect(() => invoice.transitionTo('processing')).toThrow(
        InvalidInvoiceTransitionError,
      );
    });

    it('rejects transition from rejected (terminal)', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();
      invoice.transitionTo('rejected');

      expect(() => invoice.transitionTo('authorized')).toThrow(
        InvalidInvoiceTransitionError,
      );
    });

    it('rejects transition from failed (terminal)', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();
      invoice.transitionTo('failed');

      expect(() => invoice.transitionTo('processing')).toThrow(
        InvalidInvoiceTransitionError,
      );
    });

    it('rejects transition from manual_review (terminal)', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      invoice.setProcessing();
      invoice.transitionTo('reconciliation_required');
      invoice.transitionTo('manual_review');

      expect(() => invoice.transitionTo('authorized')).toThrow(
        InvalidInvoiceTransitionError,
      );
    });
  });

  describe('setDpsInfo', () => {
    it('sets DPS info correctly', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      invoice.setDpsInfo('SERIE_A', 12345);

      expect(invoice.toSnapshot().dpsId).toBeDefined();
      expect(invoice.toSnapshot().dpsSeries).toBe('SERIE_A');
      expect(invoice.toSnapshot().dpsNumber).toBe(12345);
    });

    it('updates the updatedAt timestamp', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');
      const originalUpdatedAt = invoice.toSnapshot().updatedAt;

      invoice.setDpsInfo('SERIE_A', 12345);

      expect(invoice.toSnapshot().updatedAt.getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt.getTime(),
      );
    });
  });

  describe('setAuthorized', () => {
    it('sets access key, nfse number, and timestamps', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      invoice.setAuthorized(
        '12345678901234567890123456789012345678901234',
        999,
      );

      expect(invoice.accessKey).toBe(
        '12345678901234567890123456789012345678901234',
      );
      expect(invoice.toSnapshot().nfseNumber).toBe(999);
      expect(invoice.toSnapshot().issuedAt).toBeInstanceOf(Date);
      expect(invoice.toSnapshot().authorizedAt).toBeInstanceOf(Date);
      expect(invoice.status).toBe('queued');
    });
  });

  describe('setRejected', () => {
    it('stores error information', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      invoice.setRejected('ERR001', 'Invalid fiscal data', 'Provider message');

      const snapshot = invoice.toSnapshot();
      expect(snapshot.lastErrorCode).toBe('ERR001');
      expect(snapshot.lastErrorMessage).toBe('Invalid fiscal data');
      expect(snapshot.lastErrorProvider).toBe('Provider message');
      expect(snapshot.status).toBe('queued');
    });

    it('sets provider error to null if not provided', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      invoice.setRejected('ERR001', 'Error occurred');

      expect(invoice.toSnapshot().lastErrorProvider).toBeNull();
    });
  });

  describe('setReconciliationRequired', () => {
    it('sets status and reason', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      invoice.setReconciliationRequired('Manual intervention required');

      const snapshot = invoice.toSnapshot();
      expect(snapshot.status).toBe('queued');
      expect(snapshot.lastErrorMessage).toBe('Manual intervention required');
    });
  });

  describe('setProcessing', () => {
    it('sets status to processing', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      invoice.setProcessing();

      expect(invoice.status).toBe('processing');
    });
  });

  describe('reconstitute', () => {
    it('reconstitutes from props without validation', () => {
      const props = {
        id: 'invoice-id',
        companyId: 'company-123',
        tenantId: 'tenant-123',
        externalId: 'ext-123',
        idempotencyKey: 'idem-key',
        status: 'authorized' as const,
        customerSnapshot: {
          taxId: VALID_CNPJ,
          name: 'Reconstituted Customer',
        },
        serviceSnapshot: {
          description: 'Reconstituted Service',
          code: '010101',
          municipalityCode: '3550308',
        },
        taxSnapshot: {},
        amount: 50000,
        currency: 'BRL',
        competenceDate: new Date('2024-02-01'),
        dpsId: 'dps-123',
        dpsSeries: 'SERIE_B',
        dpsNumber: 500,
        accessKey: '1234567890',
        nfseNumber: 500,
        fiscalProvider: 'national',
        fiscalSchemaVersion: 'v2_02',
        issuedAt: new Date(),
        authorizedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
        lastErrorProvider: null,
        documentsReadyAt: null,
        lastEmailStatus: null,
        lastEmailSentAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const invoice = Invoice.reconstitute(props);

      expect(invoice.id).toBe('invoice-id');
      expect(invoice.status).toBe('authorized');
      expect(invoice.dpsNumber).toBe(500);
      expect(invoice.accessKey).toBe('1234567890');
    });
  });

  describe('toSnapshot', () => {
    it('returns all props', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      const snapshot = invoice.toSnapshot();

      expect(snapshot.id).toBe(invoice.id);
      expect(snapshot.companyId).toBe('company-123');
      expect(snapshot.tenantId).toBe('tenant-123');
      expect(snapshot.status).toBe('queued');
      expect(snapshot.amount).toBe(10000);
      expect(snapshot.currency).toBe('BRL');
    });

    it('returns a copy, not the original props', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      const snapshot = invoice.toSnapshot();
      snapshot.amount = 999999;

      expect(invoice.toSnapshot().amount).toBe(10000);
    });
  });

  describe('externalId and idempotencyKey', () => {
    it('stores external ID when provided', () => {
      const invoice = Invoice.create(
        { ...defaultInput, externalId: 'external-123' },
        'tenant-123',
      );

      expect(invoice.externalId).toBe('external-123');
    });

    it('returns null for externalId when not provided', () => {
      const invoice = Invoice.create(defaultInput, 'tenant-123');

      expect(invoice.externalId).toBeNull();
    });
  });
});
