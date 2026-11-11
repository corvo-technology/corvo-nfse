import { Inject, Injectable } from '@nestjs/common';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import { accountNotice } from '@/shared/events/account-notice.events';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { ConcurrentInvoiceTransitionError } from '@/modules/invoice/domain/errors';
import { InvoiceEvent } from '@/modules/invoice/domain/invoice-event';
import type { Invoice } from '@/modules/invoice/domain/invoice';
import type { InvoiceStatus } from '@/modules/invoice/domain/invoice-status';
import {
  INVOICE_EVENT_REPOSITORY,
  INVOICE_REPOSITORY,
  type IInvoiceEventRepository,
  type IInvoiceRepository,
} from '@/modules/invoice/domain/invoice.repository';
import { InvoiceLifecycleService } from '@/modules/invoice/application/invoice-lifecycle.service';
import { InvoiceWebhookPublisher } from '@/modules/invoice/application/invoice-webhook.publisher';
import type { StoredPortalDocument } from '../domain/portal-sync.repository';
import { effectOf, eventReason } from './portal-event';

export interface PortalDocumentContext {
  tenantId: string;
  companyId: string;
  environment: ExecutionEnvironment;
  /**
   * The document is older than the first complete read of the company: it updates the invoice but
   * tells nobody. Test never notifies either.
   */
  silent: boolean;
}

/**
 * Applies what the portal reports about invoices Corvo issued: a cancellation becomes `cancelled`,
 * a taker rejection or a block becomes a badge, everything else stays on the timeline.
 * An event only ever moves an invoice forward, and one for a key Corvo does not know is dropped.
 */
@Injectable()
export class PortalEventProcessor {
  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly invoices: IInvoiceRepository,
    @Inject(INVOICE_EVENT_REPOSITORY)
    private readonly timeline: IInvoiceEventRepository,
    private readonly lifecycle: InvoiceLifecycleService,
    private readonly webhooks: InvoiceWebhookPublisher,
    private readonly eventBus: ApplicationEventBus,
  ) {}

  /** Throws when the document cannot be handled; the caller keeps it for another try. */
  async process(
    document: StoredPortalDocument,
    context: PortalDocumentContext,
  ): Promise<void> {
    // Received notes are the next part: nothing to do with a NFS-e document here.
    if (document.documentType !== 'EVENTO') return;
    if (!document.eventType)
      throw new Error('Portal event without a known type');
    const effect = effectOf(document.eventType);
    if (effect.kind === 'ignore') return;

    const invoice = await this.invoices.findByAccessKeyAndTenantId(
      document.accessKey,
      context.tenantId,
      context.environment,
    );
    // Unknown key, or a note another company of the workspace issued to this one.
    if (!invoice || invoice.companyId !== context.companyId) return;

    const origin = { event: document.eventType, nsu: document.nsu };
    const reason = eventReason(document.xml);
    const notify = !context.silent && context.environment === 'live';

    if (effect.kind === 'cancel') {
      if (
        invoice.status === 'authorized' &&
        (await this.cancel(invoice, origin, reason, notify))
      )
        return;
      // Already cancelled here, or being cancelled: read the status as it is now.
      const now = await this.invoices.findByIdAndTenantId(
        invoice.id,
        invoice.tenantId,
        context.environment,
      );
      await this.record(
        invoice.id,
        invoice.tenantId,
        now?.status ?? invoice.status,
        origin,
        reason,
      );
      return;
    }

    const wrote = await this.record(
      invoice.id,
      invoice.tenantId,
      invoice.status,
      origin,
      reason,
    );
    if (invoice.status !== 'authorized') return;
    const current = invoice.toSnapshot().portalFlag ?? null;
    if (effect.kind === 'clear') {
      if (current === effect.flag)
        await this.invoices.setPortalFlag(invoice.id, invoice.tenantId, null);
      return;
    }
    if (current !== effect.flag)
      await this.invoices.setPortalFlag(
        invoice.id,
        invoice.tenantId,
        effect.flag,
      );
    if (!wrote || !notify) return;
    await this.announceFlag(invoice, effect.flag, reason);
  }

  /** True when the invoice became `cancelled` here; false when it was no longer ours to move. */
  private async cancel(
    invoice: Invoice,
    origin: { event: string; nsu: number },
    reason: string | null,
    notify: boolean,
  ): Promise<boolean> {
    try {
      const applied = await this.lifecycle.transition(
        invoice,
        invoice.markCancelledOnPortal(reason).withPortal(origin),
      );
      if (!applied) return false;
      if (notify) {
        await this.webhooks.publish(invoice, 'nfse.invoice.cancelled', {
          reason: 'other',
          source: 'portal',
        });
        this.eventBus.publishBestEffort(
          accountNotice(invoice.tenantId, {
            kind: 'invoice-cancelled-on-portal',
            invoiceId: invoice.id,
            nfseNumber: invoice.toSnapshot().nfseNumber,
            reason,
          }),
        );
      }
      return true;
    } catch (error: unknown) {
      // Corvo's own cancellation got there first: the timeline entry is all that is left to add.
      if (error instanceof ConcurrentInvoiceTransitionError) return false;
      throw error;
    }
  }

  /** Timeline entry for the portal document; false when this NSU was already recorded. */
  private record(
    invoiceId: string,
    tenantId: string,
    status: InvoiceStatus,
    origin: { event: string; nsu: number },
    reason: string | null,
  ): Promise<boolean> {
    return this.timeline.savePortalEntry(
      InvoiceEvent.fromPortal(
        invoiceId,
        status,
        status,
        origin,
        reason ?? undefined,
      ),
      tenantId,
    );
  }

  private async announceFlag(
    invoice: Invoice,
    flag: 'taker_rejected' | 'blocked',
    reason: string | null,
  ): Promise<void> {
    const nfseNumber = invoice.toSnapshot().nfseNumber;
    if (flag === 'taker_rejected') {
      await this.webhooks.publish(invoice, 'nfse.invoice.taker_rejected', {
        reason,
        source: 'portal',
      });
      this.eventBus.publishBestEffort(
        accountNotice(invoice.tenantId, {
          kind: 'invoice-rejected-by-taker',
          invoiceId: invoice.id,
          nfseNumber,
          reason,
        }),
      );
      return;
    }
    this.eventBus.publishBestEffort(
      accountNotice(invoice.tenantId, {
        kind: 'invoice-blocked-on-portal',
        invoiceId: invoice.id,
        nfseNumber,
      }),
    );
  }
}
