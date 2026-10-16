import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { buildDpsId } from 'open-nfse';
import type { RtcConfig } from '@/infra/config/configuration';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';
import {
  DPS_SEQUENCE_REPOSITORY,
  type IDpsSequenceRepository,
} from '../domain/dps-sequence';
import { CompanyService } from '@/modules/company/application/company.service';
import { CompanyFiscalProfileService } from '@/modules/company/application/company-fiscal-profile.service';
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
import {
  FISCAL_SNAPSHOT_REPOSITORY,
  type IFiscalSnapshotRepository,
} from '../domain/fiscal/fiscal-snapshot.repository';
import { DpsBuilder } from '../domain/fiscal/dps/dps-builder';
import {
  recordAuthorizationFailure,
  recordDpsValidationFailure,
} from './fiscal/fiscal.metrics';
import type { FiscalError } from '../domain/fiscal/fiscal-error';
import { moneyString, toDecimal } from '../domain/fiscal/money';

export interface FiscalJobData {
  invoiceId: string;
  tenantId: string;
  companyId?: string;
  apiKeyEnvironment?: 'test' | 'live';
  attemptCount?: number;
}

/**
 * The DpsBuilder rejected the layout/schema: the invoice must be rejected
 * before `queued → processing` and before any provider `issue` call. The DPS
 * number already reserved by `payload()` stays associated with the invoice, so
 * it is never handed to another invoice.
 */
class DpsBuildRejectionError extends Error {
  constructor(readonly error: FiscalError) {
    super(error.message);
  }
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
    private readonly profiles: CompanyFiscalProfileService,
    @Inject(FISCAL_SNAPSHOT_REPOSITORY)
    private readonly fiscalSnapshots: IFiscalSnapshotRepository,
    private readonly dpsBuilder: DpsBuilder,
    private readonly config: ConfigService,
  ) {}

  async process(data: FiscalJobData): Promise<void> {
    return runWithTenant(data.tenantId, () => this.processTenant(data));
  }

  /**
   * Called when the emission job exhausted its retries. Without this the invoice
   * would stay queued/processing forever with no reason visible to the developer.
   * A queued invoice never reached the provider, so it is rejected with the
   * reason; a processing one may already have a fiscal result, so it goes to
   * reconciliation instead of being declared failed.
   */
  async handleEmissionExhausted(
    data: FiscalJobData,
    error: Error,
  ): Promise<void> {
    await runWithTenant(data.tenantId, async () => {
      const invoice = await this.invoices.findByIdAndTenantId(
        data.invoiceId,
        data.tenantId,
      );
      if (!invoice) return;
      const message = `Emission could not be completed: ${error.message}`.slice(
        0,
        300,
      );
      if (invoice.status === 'queued') {
        await this.rejectBeforeProcessing(
          invoice,
          'EMISSION_PROCESSING_FAILED',
          message,
        );
      } else if (invoice.status === 'processing') {
        invoice.setReconciliationRequired(message);
        await this.lifecycle.transition(
          invoice,
          invoice.transitionTo('reconciliation_required', message),
        );
        await this.schedule(invoice);
      }
    });
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
    let payload: IIssuePayload;
    try {
      payload = await this.payload(invoice);
    } catch (error: unknown) {
      if (!(error instanceof DpsBuildRejectionError)) throw error;
      recordDpsValidationFailure(error.error.code);
      await this.rejectBeforeProcessing(
        invoice,
        error.error.code,
        error.error.message,
      );
      return;
    }
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
      try {
        await this.queues.add(
          'nfse-fiscal-reconcile',
          'reconcile',
          {
            invoiceId: invoice.id,
            companyId: invoice.companyId,
            tenantId: invoice.tenantId,
          },
          {
            idempotencyKey: `fiscal-reconcile:${invoice.id}`,
            attempts: 5,
            backoffMs: 10000,
            removeOnComplete: false,
            removeOnFail: 1000,
          },
        );
      } catch (error: unknown) {
        this.logger.error(
          { err: error, invoiceId: invoice.id },
          'Recovery will enqueue fiscal reconciliation',
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
      recordAuthorizationFailure(result.errorCode ?? 'ISSUE_REJECTED');
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
    const customer = snapshot.customerSnapshot;
    // Anonymous consumer invoices have no customer taxId; the DPS is then
    // built without a `tomador` (allowed by open-nfse / RTC XSD).
    const taxId = customer?.taxId
      ? customer.taxId.replace(/[./\s-]/g, '').toUpperCase()
      : null;
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
    // The fiscal regime is read from the company's effective fiscal profile on
    // the invoice competence date (the Company aggregate no longer stores it).
    const profile = await this.profiles.findEffective(
      company.id,
      invoice.tenantId,
      // The competence date is a calendar date stored at UTC midnight; converting
      // it to the establishment timezone would shift it to the previous day.
      new Date(snapshot.competenceDate).toISOString().slice(0, 10),
    );
    if (!profile) {
      throw new Error(
        'Company fiscal profile not found for the invoice competence date',
      );
    }
    const payload: IIssuePayload = {
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
        municipalReg: company.municipalRegForDps,
        codMunicipio: municipality,
        regime: {
          opSimpNac:
            profile.taxRegime === 'MEI'
              ? 2
              : profile.taxRegime === 'SIMPLES_NACIONAL'
                ? 3
                : 1,
          regApTribSN: 1,
          regEspTrib: Number(profile.specialTaxRegime ?? 0),
        },
      },
      serie: snapshot.dpsSeries!,
      servico: {
        cTribNac: snapshot.serviceSnapshot.code,
        descricao: snapshot.serviceSnapshot.description,
        codMunicipioPrestacao: snapshot.serviceSnapshot.municipalityCode,
      },
      valores: { vServ: snapshot.amount },
      ...(taxId && customer
        ? {
            tomador: {
              documento: taxId.length === 14 ? { CNPJ: taxId } : { CPF: taxId },
              nome: customer.name,
            },
          }
        : {}),
    };
    const fiscalSnapshot = await this.fiscalSnapshots.findByInvoiceId(
      invoice.id,
      invoice.tenantId,
    );
    // Flag off / engine did not run: byte-identical legacy payload, no DPS build.
    if (fiscalSnapshot === null) return payload;
    // The numbering was already reserved and persisted above, so a failure from
    // here on keeps the number associated with this invoice.
    const dpsNumber = invoice.dpsNumber;
    const dpsSeries = snapshot.dpsSeries;
    if (dpsNumber === null || dpsSeries === null)
      throw new Error('Invoice DPS number is missing');
    const built = await this.dpsBuilder.build(
      {
        result: fiscalSnapshot.result,
        invoice: {
          number: String(dpsNumber),
          serie: dpsSeries,
          issuedAt: snapshot.createdAt.toISOString(),
          competenceDate: new Date(snapshot.competenceDate).toISOString(),
          description: snapshot.serviceSnapshot.description,
          municipalityCode: snapshot.serviceSnapshot.municipalityCode,
          environment: invoice.environment,
          sefin: this.sefinTarget(),
          customer:
            taxId && customer
              ? {
                  kind: taxId.length === 14 ? 'CNPJ' : 'CPF',
                  taxId,
                  name: customer.name,
                  ...(customer.email ? { email: customer.email } : {}),
                }
              : null,
          discountAmount: moneyString(toDecimal(snapshot.discount ?? 0)),
        },
        emitente: {
          cnpj: company.taxId,
          municipalReg: company.municipalRegForDps ?? null,
          municipalityCode: company.municipalityCode,
          specialTaxRegime: profile.specialTaxRegime ?? null,
        },
      },
      this.config.getOrThrow<RtcConfig>('rtc').dpsLayout,
    );
    if (!built.ok) throw new DpsBuildRejectionError(built.error);
    return { ...payload, preparedDps: built.value };
  }

  /** Where live invoices are received: the production Sefin unless the app runs in homologation mode. */
  private sefinTarget(): 'production' | 'restricted' {
    return this.config.get<string>('NFSE_SEFIN_ENVIRONMENT') === 'restricted'
      ? 'restricted'
      : 'production';
  }

  /**
   * Rejects the invoice while it is still pre-processing: the reserved DPS
   * number is consumed (never re-queued into the sequence) and no provider
   * `issue` call happens.
   */
  private async rejectBeforeProcessing(
    invoice: Invoice,
    code: string,
    errorMessage: string,
  ): Promise<void> {
    invoice.setRejected(code, errorMessage);
    await this.lifecycle.transition(
      invoice,
      invoice.transitionTo('rejected', errorMessage),
    );
    await this.emitWebhook(invoice, 'nfse.invoice.rejected', {
      errorCode: code,
      errorMessage,
    });
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
