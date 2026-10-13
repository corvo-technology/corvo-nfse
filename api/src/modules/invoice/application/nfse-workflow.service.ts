import { Inject, Injectable, Logger } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { buildDpsId } from 'open-nfse';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';
import {
  DPS_SEQUENCE_REPOSITORY,
  type IDpsSequenceRepository,
} from '../domain/dps-sequence';
import { CompanyService } from '@/modules/company/application/company.service';
import { ApplicationCertificateDecryptor } from '@/modules/certificate/application/certificate-decryptor';
import { NfseProviderFactory } from '@/infra/external/nfse/nfse-provider.factory';
import type {
  IIssuePayload,
  FiscalIssueResult,
} from '@/infra/external/nfse/nfse-fiscal-provider';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import { IWebhookConfigRepository } from '@/modules/webhooks-config/domain/webhook-config.repository';
import { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import type { WebhookEvent } from '@/modules/webhooks-config/domain/webhook-event';
import {
  DOCUMENT_STORAGE,
  type IDocumentStorage,
} from '@/infra/storage/domain/document-storage';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import type { Invoice } from '../domain/invoice';
import { buildInvoiceState, type InvoiceState } from '../domain/invoice-state';

export interface FiscalJobData {
  invoiceId: string;
  tenantId: string;
  companyId?: string;
  apiKeyEnvironment?: 'test' | 'live';
  attemptCount?: number;
}

@Injectable()
export class NfseWorkflowService {
  private readonly logger = new Logger(NfseWorkflowService.name);
  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly invoices: IInvoiceRepository,
    @Inject(DPS_SEQUENCE_REPOSITORY)
    private readonly sequences: IDpsSequenceRepository,
    private readonly companies: CompanyService,
    private readonly certificates: ApplicationCertificateDecryptor,
    private readonly providers: NfseProviderFactory,
    private readonly lifecycle: InvoiceLifecycleService,
    private readonly queues: BullmqQueueService,
    private readonly webhooks: IWebhookConfigRepository,
    private readonly outbox: WebhookOutboxService,
    @Inject(DOCUMENT_STORAGE)
    private readonly documentStorage: IDocumentStorage,
  ) {}

  async process(data: FiscalJobData): Promise<void> {
    return runWithTenant(data.tenantId, () => this.processTenant(data));
  }

  private async processTenant(data: FiscalJobData): Promise<void> {
    const invoice = await this.invoices.findByIdAndTenantId(
      data.invoiceId,
      data.tenantId,
    );
    if (
      !invoice ||
      !['queued', 'processing', 'reconciliation_required'].includes(
        invoice.status,
      )
    )
      return;
    if (data.companyId && data.companyId !== invoice.companyId)
      throw new Error('Invoice/company job identity mismatch');
    const payload = await this.payload(invoice);
    if (invoice.status === 'queued') {
      const event = invoice.transitionTo(
        'processing',
        'Starting fiscal emission',
      );
      await this.lifecycle.transition(invoice, event);
    }
    let result: FiscalIssueResult;
    try {
      result = await this.providers.resolve(invoice.environment).issue(payload);
    } catch (error: unknown) {
      invoice.setReconciliationRequired(
        error instanceof Error ? error.message : 'Uncertain fiscal result',
      );
      // An uncertain network result must retain the reservation and original DPS.
      if (invoice.status === 'processing')
        await this.lifecycle.transition(
          invoice,
          invoice.transitionTo(
            'reconciliation_required',
            'Uncertain fiscal result',
          ),
        );
      await this.schedule(invoice);
      throw error;
    }
    if (result.success) {
      if (!result.xmlAuthorized || !result.accessKey)
        throw new Error('Authorized fiscal result lacks XML/access key');
      invoice.setAuthorized(result.accessKey, result.nfseNumber ?? 0);
      // The authorized XML lives only in document storage, never in the database.
      await this.documentStorage.saveXml(
        invoice.tenantId,
        invoice.id,
        result.xmlAuthorized,
        invoice.storageEnvironment,
      );
      await this.lifecycle.transition(
        invoice,
        invoice.transitionTo('authorized', 'NFS-e authorized'),
      );
      await this.emitWebhook(invoice, 'nfse.invoice.authorized', {
        accessKey: result.accessKey,
        nfseNumber: result.nfseNumber,
      });
      try {
        await this.queues.add(
          'nfse-doc-prep',
          'prepare',
          {
            invoiceId: invoice.id,
            companyId: invoice.companyId,
            tenantId: invoice.tenantId,
          },
          {
            attempts: 5,
            backoffMs: 10000,
            removeOnComplete: false,
            removeOnFail: 1000,
          },
        );
      } catch (error: unknown) {
        this.logger.error(
          { err: error, invoiceId: invoice.id },
          'Document recovery will enqueue preparation',
        );
      }
    } else if (result.requiresReconciliation) {
      if (invoice.status === 'processing')
        await this.lifecycle.transition(
          invoice,
          invoice.transitionTo('reconciliation_required', result.errorMessage),
        );
      const attempts = data.attemptCount ?? 0;
      if (attempts >= 5) {
        await this.lifecycle.transition(
          invoice,
          invoice.transitionTo(
            'manual_review',
            'Automatic reconciliation exhausted',
          ),
        );
        await this.emitWebhook(invoice, 'nfse.invoice.manual_review', {
          reason: result.errorMessage,
        });
      } else await this.schedule(invoice, attempts + 1);
    } else {
      invoice.setRejected(
        result.errorCode ?? 'ISSUE_REJECTED',
        result.errorMessage ?? 'Fiscal rejection',
      );
      await this.lifecycle.transition(
        invoice,
        invoice.transitionTo('rejected', result.errorMessage),
      );
      await this.emitWebhook(invoice, 'nfse.invoice.rejected', {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
    }
  }

  private async payload(invoice: Invoice): Promise<IIssuePayload> {
    const company = await this.companies.findById(
      invoice.companyId,
      invoice.tenantId,
      invoice.environment,
    );
    const credentials =
      invoice.environment === 'live'
        ? await this.certificates.decryptCredentials(
            company.id,
            invoice.tenantId,
            invoice.environment,
          )
        : { pfxBuffer: Buffer.alloc(0), password: '' };
    if (!invoice.dpsNumber) {
      const sequence = await this.sequences.reserveNext(
        company.id,
        invoice.tenantId,
        invoice.environment,
      );
      invoice.setDpsInfo(sequence.series, sequence.number);
      await this.invoices.save(invoice, invoice.tenantId);
    }
    const snapshot = invoice.toSnapshot();
    const taxId = snapshot.customerSnapshot.taxId
      .replace(/[./\s-]/g, '')
      .toUpperCase();
    const municipality = company.municipalityCode;
    if (!municipality || !/^\d{7}$/.test(municipality)) {
      throw new Error('Company municipalityCode is missing or invalid');
    }
    invoice.setDpsId(
      buildDpsId({
        cLocEmi: municipality,
        tipoInsc: 'CNPJ',
        inscricaoFederal: company.taxId,
        serie: snapshot.dpsSeries!,
        nDPS: String(invoice.dpsNumber),
      }),
    );
    return {
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      number: invoice.dpsNumber!,
      competenceDate: new Date(snapshot.competenceDate),
      issuedAt: snapshot.createdAt,
      pfxBuffer: credentials.pfxBuffer,
      p12Password: credentials.password,
      environment: invoice.environment,
      emitente: {
        cnpj: company.taxId,
        legalName: company.legalName,
        municipalReg: company.municipalReg,
        codMunicipio: municipality,
        regime: {
          opSimpNac:
            company.taxRegime === 'MEI'
              ? 2
              : company.taxRegime === 'Simples Nacional'
                ? 3
                : 1,
          regApTribSN: 1,
          regEspTrib: Number(company.specialRegime ?? 0),
        },
      },
      serie: snapshot.dpsSeries!,
      servico: {
        cTribNac: snapshot.serviceSnapshot.code,
        descricao: snapshot.serviceSnapshot.description,
        codMunicipioPrestacao: snapshot.serviceSnapshot.municipalityCode,
      },
      valores: { vServ: snapshot.amount },
      tomador: {
        documento: taxId.length === 14 ? { CNPJ: taxId } : { CPF: taxId },
        nome: snapshot.customerSnapshot.name,
      },
    };
  }
  private async schedule(invoice: Invoice, attemptCount = 0): Promise<void> {
    await this.queues.add(
      'nfse-reconciliation',
      'reconcile',
      {
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        tenantId: invoice.tenantId,
        attemptCount,
      },
      {
        attempts: 5,
        backoffMs: 30000,
        delayMs: Math.min(1800000, 60000 * 2 ** attemptCount),
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }
  async emailSent(invoice: Invoice, sentAt: Date): Promise<void> {
    await this.emitWebhook(
      invoice,
      'nfse.invoice.email_sent',
      { sentAt: sentAt.toISOString() },
      { emailStatus: 'sent' },
    );
  }
  async emailFailed(invoice: Invoice): Promise<void> {
    await this.emitWebhook(
      invoice,
      'nfse.invoice.email_failed',
      {},
      { emailStatus: 'failed' },
    );
  }

  /** Current fiscal/documents/email state; the event itself may be newer than the loaded invoice. */
  private stateOf(
    invoice: Invoice,
    override: Partial<Pick<InvoiceState, 'emailStatus'>>,
  ): InvoiceState {
    return buildInvoiceState({
      status: invoice.status,
      documentsReady: invoice.documentsReadyAt !== null,
      emailRequested: Boolean(invoice.emailSnapshot?.send),
      emailStatus: override.emailStatus ?? invoice.lastEmailStatus,
    });
  }

  private async emitWebhook(
    invoice: Invoice,
    type: WebhookEvent['type'],
    extra: Record<string, unknown>,
    stateOverride: Partial<Pick<InvoiceState, 'emailStatus'>> = {},
  ): Promise<void> {
    try {
      const configs = await this.webhooks.findByTenantIdAndEvent(
        invoice.tenantId,
        type,
      );
      const event: WebhookEvent = {
        id: `evt_${crypto.randomUUID()}`,
        type,
        environment: invoice.environment,
        createdAt: new Date().toISOString(),
        data: {
          invoiceId: invoice.id,
          companyId: invoice.companyId,
          environment: invoice.environment,
          ...this.stateOf(invoice, stateOverride),
          ...extra,
        },
      };
      for (const config of configs)
        if (config.active)
          await this.outbox.enqueue({
            tenantId: invoice.tenantId,
            webhookConfigId: config.id,
            eventType: type,
            environment: invoice.environment,
            url: config.url,
            payload: event,
            secret: config.secret,
          });
    } catch (error: unknown) {
      this.logger.error(
        { err: error, invoiceId: invoice.id },
        'Fiscal webhook enqueue failed',
      );
    }
  }
}
