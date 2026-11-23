import { ConcurrentInvoiceTransitionError } from '@/modules/invoice/domain/errors';
import { Invoice } from '@/modules/invoice/domain/invoice';
import type { InvoiceStatus } from '@/modules/invoice/domain/invoice-status';
import type { PortalFlag } from '@/modules/invoice/domain/portal-flag';
import type { StoredPortalDocument } from '../domain/portal-sync.repository';
import {
  ACCESS_KEY,
  CANCELLATION_XML,
  TAKER_CONFIRMATION_XML,
  TAKER_REJECTION_XML,
} from '../__fixtures__/portal-events';
import {
  PortalEventProcessor,
  type PortalDocumentContext,
} from './portal-event.processor';

const TENANT = '0b1f5c1e-6a0e-4d6e-9c55-6f4c9f1f0a01';
const COMPANY = '5d0c8a52-2f4b-4c1b-8d0d-0d6c1a9e1b02';

function invoice(
  status: InvoiceStatus = 'authorized',
  overrides: Partial<{
    companyId: string;
    environment: 'test' | 'live';
    portalFlag: PortalFlag | null;
  }> = {},
): Invoice {
  return Invoice.reconstitute({
    id: 'c5a63c1b-7c0a-4a9f-a5e2-0f5e6d7a9a03',
    companyId: overrides.companyId ?? COMPANY,
    tenantId: TENANT,
    environment: overrides.environment ?? 'live',
    externalId: null,
    idempotencyKey: null,
    status,
    customerSnapshot: null,
    serviceSnapshot: {
      description: 'Consultoria',
      code: '010101',
      municipalityCode: '3550308',
    },
    taxSnapshot: {},
    amount: 100,
    currency: 'BRL',
    competenceDate: new Date('2026-04-01'),
    dpsId: null,
    dpsSeries: null,
    dpsNumber: null,
    accessKey: ACCESS_KEY,
    nfseNumber: 42,
    fiscalProvider: 'national',
    fiscalSchemaVersion: 'v2_02',
    issuedAt: null,
    authorizedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastErrorProvider: null,
    documentsReadyAt: null,
    lastEmailStatus: null,
    lastEmailSentAt: null,
    portalFlag: overrides.portalFlag ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function document(
  eventType: string | null,
  xml: string,
  nsu = 10,
): StoredPortalDocument {
  return {
    id: `doc-${nsu}`,
    nsu,
    accessKey: ACCESS_KEY,
    documentType: 'EVENTO',
    eventType,
    xml,
    generatedAt: new Date('2026-04-17T13:00:00Z'),
    attempts: 0,
  };
}

const live: PortalDocumentContext = {
  tenantId: TENANT,
  companyId: COMPANY,
  environment: 'live',
  silent: false,
};

function setup(stored: Invoice | null = invoice()) {
  const invoices = {
    findByAccessKeyAndTenantId: jest.fn().mockResolvedValue(stored),
    findByIdAndTenantId: jest.fn().mockResolvedValue(stored),
    setPortalFlag: jest.fn().mockResolvedValue(undefined),
  };
  const timeline = { savePortalEntry: jest.fn().mockResolvedValue(true) };
  const lifecycle = { transition: jest.fn().mockResolvedValue(true) };
  const webhooks = { publish: jest.fn().mockResolvedValue(undefined) };
  const eventBus = { publishBestEffort: jest.fn() };
  const processor = new PortalEventProcessor(
    invoices as never,
    timeline as never,
    lifecycle as never,
    webhooks as never,
    eventBus as never,
  );
  return { processor, invoices, timeline, lifecycle, webhooks, eventBus };
}

describe('PortalEventProcessor', () => {
  describe('cancellation on the portal', () => {
    it('moves an authorized invoice to cancelled with the portal as origin, and tells the customer', async () => {
      const { processor, lifecycle, webhooks, eventBus } = setup();

      await processor.process(document('CANCELAMENTO', CANCELLATION_XML), live);

      const [moved, event] = lifecycle.transition.mock.calls[0] as [
        Invoice,
        { toSnapshot(): Record<string, unknown> },
      ];
      expect(moved.status).toBe('cancelled');
      expect(moved.cancellationReason).toEqual({
        code: 'other',
        description: 'Cancelada no portal: Erro de digitação no valor',
      });
      expect(event.toSnapshot()).toMatchObject({
        fromStatus: 'authorized',
        toStatus: 'cancelled',
        source: 'portal',
        portalEvent: 'CANCELAMENTO',
        portalNsu: 10,
      });
      expect(webhooks.publish).toHaveBeenCalledWith(
        moved,
        'nfse.invoice.cancelled',
        { reason: 'other', source: 'portal' },
      );
      expect(eventBus.publishBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          notice: {
            kind: 'invoice-cancelled-on-portal',
            invoiceId: moved.id,
            nfseNumber: 42,
            reason: 'Erro de digitação no valor',
          },
        }),
      );
    });

    it('only records it on the timeline when Corvo already cancelled the invoice', async () => {
      const { processor, lifecycle, timeline, webhooks, eventBus } = setup(
        invoice('cancelled'),
      );

      await processor.process(document('CANCELAMENTO', CANCELLATION_XML), live);

      expect(lifecycle.transition).not.toHaveBeenCalled();
      expect(webhooks.publish).not.toHaveBeenCalled();
      expect(eventBus.publishBestEffort).not.toHaveBeenCalled();
      expect(timeline.savePortalEntry).toHaveBeenCalledTimes(1);
    });

    it('loses the race gracefully when Corvo starts cancelling at the same moment', async () => {
      const { processor, lifecycle, invoices, timeline, webhooks, eventBus } =
        setup();
      lifecycle.transition.mockRejectedValue(
        new ConcurrentInvoiceTransitionError('x'),
      );
      // The stored row is the source of truth after the race.
      invoices.findByIdAndTenantId.mockResolvedValue(invoice('cancelling'));

      await processor.process(document('CANCELAMENTO', CANCELLATION_XML), live);

      expect(webhooks.publish).not.toHaveBeenCalled();
      expect(eventBus.publishBestEffort).not.toHaveBeenCalled();
      const [entry] = timeline.savePortalEntry.mock.calls[0] as [
        { toSnapshot(): Record<string, unknown> },
      ];
      expect(entry.toSnapshot()).toMatchObject({
        fromStatus: 'cancelling',
        toStatus: 'cancelling',
        source: 'portal',
        portalNsu: 10,
      });
    });

    it('does not announce twice when the transition finds the invoice already cancelled', async () => {
      const { processor, lifecycle, webhooks, eventBus, timeline } = setup();
      lifecycle.transition.mockResolvedValue(false);

      await processor.process(document('CANCELAMENTO', CANCELLATION_XML), live);

      expect(webhooks.publish).not.toHaveBeenCalled();
      expect(eventBus.publishBestEffort).not.toHaveBeenCalled();
      expect(timeline.savePortalEntry).toHaveBeenCalledTimes(1);
    });

    it('never brings a cancelled invoice back, whatever the next event is', async () => {
      const { processor, lifecycle, invoices, timeline } = setup(
        invoice('cancelled'),
      );

      await processor.process(
        document('CONFIRMACAO_TOMADOR', TAKER_CONFIRMATION_XML, 11),
        live,
      );
      await processor.process(
        document('REJEICAO_TOMADOR', TAKER_REJECTION_XML, 12),
        live,
      );

      expect(lifecycle.transition).not.toHaveBeenCalled();
      expect(invoices.setPortalFlag).not.toHaveBeenCalled();
      expect(timeline.savePortalEntry).toHaveBeenCalledTimes(2);
    });

    it('stays quiet for a document of the first read, but still cancels', async () => {
      const { processor, lifecycle, webhooks, eventBus } = setup();

      await processor.process(document('CANCELAMENTO', CANCELLATION_XML), {
        ...live,
        silent: true,
      });

      expect(lifecycle.transition).toHaveBeenCalledTimes(1);
      expect(webhooks.publish).not.toHaveBeenCalled();
      expect(eventBus.publishBestEffort).not.toHaveBeenCalled();
    });

    it('in test it cancels and stays quiet: no webhook, no e-mail', async () => {
      const { processor, lifecycle, webhooks, eventBus } = setup(
        invoice('authorized', { environment: 'test' }),
      );

      await processor.process(document('CANCELAMENTO', CANCELLATION_XML), {
        ...live,
        environment: 'test',
      });

      expect(lifecycle.transition).toHaveBeenCalledTimes(1);
      expect(webhooks.publish).not.toHaveBeenCalled();
      expect(eventBus.publishBestEffort).not.toHaveBeenCalled();
    });
  });

  describe('taker rejection and block', () => {
    it('keeps the invoice authorized, raises the badge and warns by webhook and e-mail', async () => {
      const { processor, lifecycle, invoices, timeline, webhooks, eventBus } =
        setup();

      await processor.process(
        document('REJEICAO_TOMADOR', TAKER_REJECTION_XML),
        live,
      );

      expect(lifecycle.transition).not.toHaveBeenCalled();
      expect(invoices.setPortalFlag).toHaveBeenCalledWith(
        expect.any(String),
        TENANT,
        'taker_rejected',
      );
      expect(timeline.savePortalEntry).toHaveBeenCalledTimes(1);
      expect(webhooks.publish).toHaveBeenCalledWith(
        expect.anything(),
        'nfse.invoice.taker_rejected',
        { reason: 'Serviço não contratado', source: 'portal' },
      );
      expect(eventBus.publishBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          notice: expect.objectContaining({
            kind: 'invoice-rejected-by-taker',
            reason: 'Serviço não contratado',
          }),
        }),
      );
    });

    it('a block warns by e-mail only', async () => {
      const { processor, invoices, webhooks, eventBus } = setup();

      await processor.process(
        document('BLOQUEIO_POR_OFICIO', CANCELLATION_XML),
        live,
      );

      expect(invoices.setPortalFlag).toHaveBeenCalledWith(
        expect.any(String),
        TENANT,
        'blocked',
      );
      expect(webhooks.publish).not.toHaveBeenCalled();
      expect(eventBus.publishBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          notice: expect.objectContaining({
            kind: 'invoice-blocked-on-portal',
          }),
        }),
      );
    });

    it('a second delivery of the same NSU warns nobody again', async () => {
      const { processor, timeline, webhooks, eventBus } = setup();
      timeline.savePortalEntry.mockResolvedValue(false);

      await processor.process(
        document('REJEICAO_TOMADOR', TAKER_REJECTION_XML),
        live,
      );

      expect(webhooks.publish).not.toHaveBeenCalled();
      expect(eventBus.publishBestEffort).not.toHaveBeenCalled();
    });

    it('raises the badge in silence for history and for test', async () => {
      const silent = setup();
      await silent.processor.process(
        document('REJEICAO_TOMADOR', TAKER_REJECTION_XML),
        { ...live, silent: true },
      );
      expect(silent.invoices.setPortalFlag).toHaveBeenCalled();
      expect(silent.eventBus.publishBestEffort).not.toHaveBeenCalled();
      expect(silent.webhooks.publish).not.toHaveBeenCalled();

      const test = setup(invoice('authorized', { environment: 'test' }));
      await test.processor.process(
        document('REJEICAO_TOMADOR', TAKER_REJECTION_XML),
        { ...live, environment: 'test' },
      );
      expect(test.invoices.setPortalFlag).toHaveBeenCalled();
      expect(test.eventBus.publishBestEffort).not.toHaveBeenCalled();
      expect(test.webhooks.publish).not.toHaveBeenCalled();
    });

    it('a confirmation takes the taker badge away, but not a block', async () => {
      const rejected = setup(
        invoice('authorized', { portalFlag: 'taker_rejected' }),
      );
      await rejected.processor.process(
        document('CONFIRMACAO_TOMADOR', TAKER_CONFIRMATION_XML),
        live,
      );
      expect(rejected.invoices.setPortalFlag).toHaveBeenCalledWith(
        expect.any(String),
        TENANT,
        null,
      );

      const blocked = setup(invoice('authorized', { portalFlag: 'blocked' }));
      await blocked.processor.process(
        document('CONFIRMACAO_TOMADOR', TAKER_CONFIRMATION_XML),
        live,
      );
      expect(blocked.invoices.setPortalFlag).not.toHaveBeenCalled();
      expect(blocked.timeline.savePortalEntry).toHaveBeenCalledTimes(1);
    });

    it('an unblock takes the blocked badge away', async () => {
      const { processor, invoices } = setup(
        invoice('authorized', { portalFlag: 'blocked' }),
      );

      await processor.process(
        document('DESBLOQUEIO_POR_OFICIO', CANCELLATION_XML),
        live,
      );

      expect(invoices.setPortalFlag).toHaveBeenCalledWith(
        expect.any(String),
        TENANT,
        null,
      );
    });
  });

  describe('what it leaves alone', () => {
    it('drops an event for a key Corvo does not know', async () => {
      const { processor, lifecycle, timeline, invoices } = setup(null);

      await processor.process(document('CANCELAMENTO', CANCELLATION_XML), live);

      expect(lifecycle.transition).not.toHaveBeenCalled();
      expect(timeline.savePortalEntry).not.toHaveBeenCalled();
      expect(invoices.setPortalFlag).not.toHaveBeenCalled();
    });

    it('looks the invoice up inside the workspace and environment of the document', async () => {
      const { processor, invoices } = setup();

      await processor.process(document('CANCELAMENTO', CANCELLATION_XML), live);

      expect(invoices.findByAccessKeyAndTenantId).toHaveBeenCalledWith(
        ACCESS_KEY,
        TENANT,
        'live',
      );
    });

    it('ignores a note another company of the workspace issued', async () => {
      const { processor, lifecycle, timeline } = setup(
        invoice('authorized', { companyId: 'another-company' }),
      );

      await processor.process(document('CANCELAMENTO', CANCELLATION_XML), live);

      expect(lifecycle.transition).not.toHaveBeenCalled();
      expect(timeline.savePortalEntry).not.toHaveBeenCalled();
    });

    it('only stores events it does not act on, and NFS-e documents', async () => {
      const { processor, invoices, timeline } = setup();

      await processor.process(
        document('CONFIRMACAO_PRESTADOR', CANCELLATION_XML),
        live,
      );
      await processor.process(
        { ...document(null, '<NFSe/>'), documentType: 'NFSE' },
        live,
      );

      expect(invoices.findByAccessKeyAndTenantId).not.toHaveBeenCalled();
      expect(timeline.savePortalEntry).not.toHaveBeenCalled();
    });

    it('refuses an event whose type is unknown, so it stays stored for another try', async () => {
      const { processor } = setup();

      await expect(
        processor.process(document(null, CANCELLATION_XML), live),
      ).rejects.toThrow('known type');
    });
  });
});
