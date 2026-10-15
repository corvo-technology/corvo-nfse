import { Inject, Injectable, Logger } from '@nestjs/common';
import { parseNfseXml } from 'open-nfse';
import { DOCUMENT_STORAGE } from '@/infra/storage/domain/document-storage';
import type { IDocumentStorage } from '@/infra/storage/domain/document-storage';
import { IWebhookConfigRepository } from '@/modules/webhooks-config/domain/webhook-config.repository';
import { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import type {
  WebhookEnvironment,
  WebhookEventType,
} from '@/modules/webhooks-config/domain/webhook-event';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../../domain/invoice.repository';
import {
  FISCAL_SNAPSHOT_REPOSITORY,
  type IFiscalSnapshotRepository,
} from '../../domain/fiscal/fiscal-snapshot.repository';
import {
  FISCAL_RECONCILIATION_REPOSITORY,
  type IFiscalReconciliationRepository,
} from '../../domain/fiscal/reconciliation/fiscal-reconciliation.repository';
import { Decimal } from '../../domain/fiscal/money';
import { TAX_RULES } from '../../domain/fiscal/policies/rules';
import { reconcile } from '../../domain/fiscal/reconciliation/reconcile';
import { recordReconciliationMismatch } from './fiscal.metrics';

function reconciliationToleranceAbsolute(): Decimal {
  const rule = TAX_RULES.find(
    (candidate) => candidate.ruleKey === 'reconciliation.tolerance',
  );
  if (!rule || !('absolute' in rule.parameters))
    throw new Error('reconciliation.tolerance rule is not configured');
  return new Decimal(rule.parameters.absolute);
}

export interface InvoiceWebhookContext {
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly environment: WebhookEnvironment;
}

/**
 * Enqueues a webhook event through the same outbox path the NFS-e workflow
 * uses. Webhook failures are swallowed: reconciliation must never fail
 * because an endpoint is misbehaving.
 */
@Injectable()
export class InvoiceWebhookPublisher {
  private readonly logger = new Logger(InvoiceWebhookPublisher.name);

  constructor(
    private readonly webhooks: IWebhookConfigRepository,
    private readonly outbox: WebhookOutboxService,
  ) {}

  async publish(
    context: InvoiceWebhookContext,
    type: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      const configs = await this.webhooks.findByTenantIdAndEvent(
        context.tenantId,
        type,
      );
      const event = {
        id: `evt_${crypto.randomUUID()}`,
        type,
        environment: context.environment,
        createdAt: new Date().toISOString(),
        // Only the requested fields — never the XML or full documents.
        data,
      };
      for (const config of configs)
        if (config.active)
          await this.outbox.enqueue({
            tenantId: context.tenantId,
            webhookConfigId: config.id,
            eventType: type,
            environment: context.environment,
            url: config.url,
            payload: event,
            secret: config.secret,
          });
    } catch (error: unknown) {
      this.logger.error(
        { err: error, invoiceId: context.invoiceId },
        'Fiscal discrepancy webhook enqueue failed',
      );
    }
  }
}

/**
 * Reconciles the immutable fiscal snapshot against the authorized NFS-e the
 * Sefin returned. It never alters the snapshot, the stored XML or the invoice
 * status — divergence is a persisted record plus a metric and a webhook.
 */
@Injectable()
export class FiscalReconciliationService {
  constructor(
    @Inject(FISCAL_SNAPSHOT_REPOSITORY)
    private readonly snapshots: IFiscalSnapshotRepository,
    @Inject(FISCAL_RECONCILIATION_REPOSITORY)
    private readonly reconciliations: IFiscalReconciliationRepository,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoices: IInvoiceRepository,
    @Inject(DOCUMENT_STORAGE)
    private readonly documentStorage: IDocumentStorage,
    private readonly webhooks: InvoiceWebhookPublisher,
  ) {}

  async reconcileInvoice(invoiceId: string, tenantId: string): Promise<void> {
    const snapshot = await this.snapshots.findByInvoiceId(invoiceId, tenantId);
    if (!snapshot) return;
    const invoice = await this.invoices.findByIdAndTenantId(
      invoiceId,
      tenantId,
    );
    if (!invoice) return;

    const xml = await this.documentStorage.getXml(
      tenantId,
      invoiceId,
      invoice.storageEnvironment,
    );
    const authorized = parseNfseXml(xml);
    const outcome = reconcile(
      snapshot.result,
      authorized,
      reconciliationToleranceAbsolute(),
    );

    const inserted = await this.reconciliations.insert({
      invoiceId,
      tenantId,
      status: outcome.status,
      localValues: { ...outcome.localValues },
      authorizedValues: { ...outcome.authorizedValues },
      differences: [...outcome.differences],
      toleranceAbsolute: outcome.toleranceAbsolute,
      rulesVersion: snapshot.result.rulesVersion,
      reconciledAt: new Date(),
    });

    if (outcome.status !== 'divergent') return;
    recordReconciliationMismatch(tenantId);
    // Webhook only on the first insert — retried jobs must not notify twice.
    if (inserted)
      await this.webhooks.publish(
        {
          invoiceId,
          tenantId,
          companyId: invoice.companyId,
          environment: invoice.environment,
        },
        'nfse.invoice.fiscal_discrepancy',
        {
          invoiceId,
          status: invoice.status,
          differences: outcome.differences,
        },
      );
  }
}
