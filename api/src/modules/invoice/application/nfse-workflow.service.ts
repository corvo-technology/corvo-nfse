import type { Company } from '@/modules/company/domain/company';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  regApTribSNFor,
  type CompanyFiscalProfile,
} from '@/modules/company/domain/fiscal-profile';
import { ConfigService } from '@nestjs/config';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { buildDpsId, parseNfseXml } from 'open-nfse';
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
  FiscalQueryResult,
} from '@/infra/external/nfse/nfse-fiscal-provider';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import {
  DOCUMENT_STORAGE,
  type IDocumentStorage,
} from '@/infra/storage/domain/document-storage';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import { FiscalPortalBreaker } from './fiscal-portal-breaker';
import type { Invoice } from '../domain/invoice';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';
import {
  FISCAL_SNAPSHOT_REPOSITORY,
  type IFiscalSnapshotRepository,
} from '../domain/fiscal/fiscal-snapshot.repository';
import { DpsBuilder } from '../domain/fiscal/dps/dps-builder';
import {
  recordAuthorizationFailure,
  recordDpsValidationFailure,
} from './fiscal/fiscal.metrics';
import { DateTime } from 'luxon';
import { fiscalError, type FiscalError } from '../domain/fiscal/fiscal-error';
import { moneyString, toDecimal } from '../domain/fiscal/money';

export interface FiscalJobData {
  invoiceId: string;
  tenantId: string;
  companyId?: string;
  apiKeyEnvironment?: 'test' | 'live';
  attemptCount?: number;
  /** ISO time the invoice first lost a conclusive answer; drives the manual review ceiling. */
  uncertainSince?: string;
  /** Set by a person on an invoice in manual review: confirm on the portal and discard it. */
  review?: 'discard' | 'sweep';
}

/** Delay before the next automatic reconciliation: 2, 4, 8, 16 min, then 30 min. */
export function reconciliationDelayMs(attempt: number): number {
  return Math.min(1800000, 60000 * 2 ** attempt);
}

/** `timeout` when the portal did not answer in time; `error` for any other failure. */
export function failureKind(error: unknown): 'timeout' | 'error' {
  const e = (error ?? {}) as { name?: string; code?: string; message?: string };
  const text = [e.name, e.code, e.message]
    .filter((v) => typeof v === 'string')
    .join(' ');
  return /time.?out|timed out|ETIMEDOUT|ECONNABORTED|abort/i.test(text)
    ? 'timeout'
    : 'error';
}

/** Short reason safe for logs: no markup (XML), no line breaks, bounded. */
/** The portal's processing time (dhProc) in the authorized NFS-e XML; null when it cannot be read. */
function portalProcessedAt(xml: string): Date | null {
  try {
    const value: unknown = parseNfseXml(xml).infNFSe.dhProc;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function safeReason(message: string | undefined): string | undefined {
  if (!message) return undefined;
  return message
    .replace(/<[^>]*>?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Error code of an invoice discarded after the portal confirmed its DPS was never registered. */
export const DISCARDED_ERROR_CODE = 'DISCARDED_AFTER_REVIEW';

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

/**
 * dhEmi of the DPS. A scheduled invoice is created before its competence day,
 * and the Sefin rejects a competence later than dhEmi (E0015), so it uses the
 * fixed release instant instead of the creation time.
 */
function dpsIssuedAt(snapshot: {
  createdAt: Date;
  scheduledFor?: Date | null;
}): Date {
  return snapshot.scheduledFor ?? snapshot.createdAt;
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
    private readonly webhooks: InvoiceWebhookPublisher,
    @Inject(DOCUMENT_STORAGE)
    private readonly documentStorage: IDocumentStorage,
    private readonly profiles: CompanyFiscalProfileService,
    @Inject(FISCAL_SNAPSHOT_REPOSITORY)
    private readonly fiscalSnapshots: IFiscalSnapshotRepository,
    private readonly dpsBuilder: DpsBuilder,
    private readonly config: ConfigService,
    // Optional so the workflow keeps today's DPS where they are not provided.
    @Optional() private readonly breaker?: FiscalPortalBreaker,
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
    if (!invoice) return;
    if (data.companyId && data.companyId !== invoice.companyId)
      throw new Error('Invoice/company job identity mismatch');
    if (data.review === 'discard') return this.discard(invoice);
    if (data.review === 'sweep') return this.sweepManualReview(invoice);
    if (
      !['queued', 'processing', 'reconciliation_required'].includes(
        invoice.status,
      )
    )
      return;
    const uncertainSince = data.uncertainSince
      ? new Date(data.uncertainSince)
      : new Date();
    if (
      invoice.status === 'reconciliation_required' &&
      this.pastUncertainCeiling(uncertainSince)
    ) {
      this.logReconciliation('warn', invoice, 'manual_review', {
        attempt: data.attemptCount ?? 0,
        reason: 'uncertain_ceiling',
      });
      await this.toManualReview(
        invoice,
        `No conclusive answer from the fiscal portal for more than ${this.uncertainMaxHours()}h. Retry it with the same DPS or discard it in manual review.`,
      );
      return;
    }
    // While the portal is paused the job waits (PortalUnavailableError) without spending attempts.
    await this.breaker?.assertAvailable(invoice.environment);
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
      try {
        await this.lifecycle.transition(invoice, event);
      } catch (error: unknown) {
        // Cancelled (or taken by another worker) after we loaded it: never issue.
        if (error instanceof ConcurrentInvoiceTransitionError) {
          this.logger.debug(
            `Invoice ${invoice.id} changed concurrently (likely cancelled); skipping emission`,
          );
          return;
        }
        throw error;
      }
    }
    let result: FiscalIssueResult;
    try {
      result = await this.providers.resolve(invoice.environment).issue(payload);
    } catch (error: unknown) {
      await this.breaker?.recordFailure(invoice.environment);
      this.logReconciliation('warn', invoice, failureKind(error), {
        attempt: data.attemptCount ?? 0,
        nextDelayMs: reconciliationDelayMs((data.attemptCount ?? 0) + 1),
        errorName: error instanceof Error ? error.name : undefined,
        reason: safeReason(error instanceof Error ? error.message : undefined),
      });
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
      // Exactly one follow-up job: rethrowing would also retry this job and multiply them.
      await this.schedule(
        invoice,
        (data.attemptCount ?? 0) + 1,
        uncertainSince,
      );
      return;
    }
    if (result.requiresReconciliation)
      await this.breaker?.recordFailure(invoice.environment);
    else await this.breaker?.recordSuccess(invoice.environment);
    if (result.success) {
      this.logReconciliation('log', invoice, 'authorized', {
        attempt: data.attemptCount ?? 0,
      });
      await this.authorize(invoice, result);
    } else if (result.requiresReconciliation) {
      const attempt = data.attemptCount ?? 0;
      this.logReconciliation('warn', invoice, 'pending', {
        attempt,
        nextDelayMs:
          attempt >= 5 ? undefined : reconciliationDelayMs(attempt + 1),
        reason: safeReason(result.errorMessage),
      });
      if (invoice.status === 'processing')
        await this.lifecycle.transition(
          invoice,
          invoice.transitionTo('reconciliation_required', result.errorMessage),
        );
      const attempts = data.attemptCount ?? 0;
      if (attempts >= 5)
        await this.toManualReview(
          invoice,
          'Automatic reconciliation exhausted',
          result.errorMessage,
        );
      else await this.schedule(invoice, attempts + 1, uncertainSince);
    } else {
      this.logReconciliation('log', invoice, 'rejected', {
        attempt: data.attemptCount ?? 0,
        reason: safeReason(result.errorCode),
      });
      recordAuthorizationFailure(result.errorCode ?? 'ISSUE_REJECTED');
      invoice.setRejected(
        result.errorCode ?? 'ISSUE_REJECTED',
        result.errorMessage ?? 'Fiscal rejection',
      );
      await this.lifecycle.transition(
        invoice,
        invoice.transitionTo('rejected', result.errorMessage),
      );
      await this.webhooks.publish(invoice, 'nfse.invoice.rejected', {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
    }
  }

  /**
   * The `subst` data of a substitute: the access key of the invoice it replaces. The original must
   * still be authorized; anything else is refused here instead of at the Sefin.
   */
  private async substitutionFor(
    invoice: Invoice,
  ): Promise<{ accessKey: string; description: string } | undefined> {
    const originalId = invoice.substitutesInvoiceId;
    if (!originalId) return undefined;
    const original = await this.invoices.findByIdAndTenantId(
      originalId,
      invoice.tenantId,
    );
    if (
      !original ||
      original.status !== 'authorized' ||
      !original.accessKey ||
      !invoice.substitutionDescription
    )
      throw new DpsBuildRejectionError(
        fiscalError({
          code: 'FISCAL_VALIDATION_FAILED',
          message:
            'The invoice to substitute is no longer authorized, so it cannot be substituted',
          category: 'VALIDATION',
          step: 'NfseWorkflow',
          details: { fields: ['substitutesInvoiceId'] },
        }),
      );
    return {
      accessKey: original.accessKey,
      description: invoice.substitutionDescription,
    };
  }

  /**
   * After a substitute is authorized, the Sefin has already cancelled the original: mirror it here.
   * A failure is logged and never undoes the authorization, which is a fiscal fact.
   */
  private async settleSubstitution(substitute: Invoice): Promise<void> {
    const originalId = substitute.substitutesInvoiceId;
    if (!originalId) return;
    try {
      const original = await this.invoices.findByIdAndTenantId(
        originalId,
        substitute.tenantId,
      );
      if (!original || original.status !== 'authorized') {
        this.logger.warn(
          { invoiceId: substitute.id, originalId, status: original?.status },
          'Substituted invoice was not authorized locally; left as is',
        );
        return;
      }
      await this.lifecycle.transition(
        original,
        original.markSubstituted(substitute.id),
      );
      await this.webhooks.publish(original, 'nfse.invoice.cancelled', {
        reason: 'other',
        substitutedBy: substitute.id,
      });
    } catch (error: unknown) {
      this.logger.error(
        { err: error, invoiceId: substitute.id, originalId },
        'Substitute authorized, but the original could not be marked as cancelled',
      );
    }
  }

  /** Saves the authorized XML, moves the invoice to authorized and starts the follow-up jobs. */
  private async authorize(
    invoice: Invoice,
    result: Pick<
      FiscalIssueResult,
      'accessKey' | 'nfseNumber' | 'xmlAuthorized'
    >,
  ): Promise<void> {
    if (!result.xmlAuthorized || !result.accessKey)
      throw new Error('Authorized fiscal result lacks XML/access key');
    invoice.setAuthorized(
      result.accessKey,
      result.nfseNumber ?? 0,
      portalProcessedAt(result.xmlAuthorized),
    );
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
    await this.webhooks.publish(invoice, 'nfse.invoice.authorized', {
      accessKey: result.accessKey,
      nfseNumber: result.nfseNumber,
    });
    await this.settleSubstitution(invoice);
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
  }

  private async toManualReview(
    invoice: Invoice,
    reason: string,
    detail?: string,
  ): Promise<void> {
    invoice.setReconciliationRequired(detail ?? reason);
    await this.lifecycle.transition(
      invoice,
      invoice.transitionTo('manual_review', reason),
    );
    await this.webhooks.publish(invoice, 'nfse.invoice.manual_review', {
      reason: detail ?? reason,
    });
  }

  private uncertainMaxHours(): number {
    return this.breaker?.settings.uncertainMaxHours ?? 6;
  }

  private pastUncertainCeiling(since: Date): boolean {
    return Date.now() - since.getTime() > this.uncertainMaxHours() * 3_600_000;
  }

  private logReconciliation(
    level: 'log' | 'warn',
    invoice: Invoice,
    outcome: string,
    extra: Record<string, unknown>,
  ): void {
    this.logger[level](
      {
        invoiceId: invoice.id,
        dpsId: invoice.toSnapshot().dpsId,
        environment: invoice.environment,
        outcome,
        ...extra,
      },
      'Fiscal reconciliation attempt',
    );
  }

  /**
   * Periodic sweep over an invoice in manual review. QUERY ONLY: it asks the portal for the DPS and,
   * if the NFS-e exists, authorizes the invoice like any reconciliation. Any other answer (not found,
   * error, timeout) changes nothing: the invoice stays in review, nothing is sent or discarded.
   */
  private async sweepManualReview(invoice: Invoice): Promise<void> {
    if (invoice.status !== 'manual_review') return;
    // Never reserve a DPS number here: without one there is nothing to look up.
    if (!invoice.toSnapshot().dpsNumber) {
      this.logReconciliation('warn', invoice, 'skipped', {
        source: 'manual_review_sweep',
        reason: 'no_dps_number',
      });
      return;
    }
    await this.breaker?.assertAvailable(invoice.environment);
    let found: FiscalQueryResult;
    try {
      const payload = await this.payload(invoice);
      const idDps = invoice.toSnapshot().dpsId;
      if (!idDps) throw new Error('Invoice has no DPS to look up');
      found = await this.providers
        .resolve(invoice.environment)
        .queryByDps(idDps, payload);
    } catch (error: unknown) {
      if (!(error instanceof DpsBuildRejectionError))
        await this.breaker?.recordFailure(invoice.environment);
      this.logReconciliation('warn', invoice, failureKind(error), {
        source: 'manual_review_sweep',
        errorName: error instanceof Error ? error.name : undefined,
        reason: safeReason(error instanceof Error ? error.message : undefined),
      });
      return;
    }
    await this.breaker?.recordSuccess(invoice.environment);
    if (found.status === 'authorized') {
      this.logReconciliation('log', invoice, 'authorized', {
        source: 'manual_review_sweep',
      });
      return this.authorize(invoice, found);
    }
    this.logReconciliation('log', invoice, found.status, {
      source: 'manual_review_sweep',
    });
  }

  /**
   * A person asked to discard an invoice in manual review. It is only rejected when the portal
   * confirms its DPS was never registered; if the portal already has it, it becomes authorized
   * (never a second NFS-e for the same service). Any other answer leaves it in manual review.
   */
  private async discard(invoice: Invoice): Promise<void> {
    if (invoice.status !== 'manual_review') return;
    await this.breaker?.assertAvailable(invoice.environment);
    const found = await this.lookUpDps(invoice);
    if (!found) return;
    await this.breaker?.recordSuccess(invoice.environment);
    if (found.status === 'authorized') return this.authorize(invoice, found);
    if (found.status !== 'not_found')
      return this.keepInReview(
        invoice,
        'Discard not confirmed: the portal did not say whether this DPS exists',
      );
    const message =
      'Discarded in manual review: the fiscal portal confirmed this DPS was never registered';
    invoice.setRejected(DISCARDED_ERROR_CODE, message);
    await this.lifecycle.transition(
      invoice,
      invoice.transitionTo('rejected', message),
    );
    await this.webhooks.publish(invoice, 'nfse.invoice.rejected', {
      errorCode: DISCARDED_ERROR_CODE,
      errorMessage: message,
    });
  }

  /** Asks the portal for the invoice's DPS; on failure the invoice stays in review with the reason. */
  private async lookUpDps(invoice: Invoice): Promise<FiscalQueryResult | null> {
    try {
      const payload = await this.payload(invoice);
      const idDps = invoice.toSnapshot().dpsId;
      if (!idDps) throw new Error('Invoice has no DPS to look up');
      return await this.providers
        .resolve(invoice.environment)
        .queryByDps(idDps, payload);
    } catch (error: unknown) {
      if (!(error instanceof DpsBuildRejectionError))
        await this.breaker?.recordFailure(invoice.environment);
      const reason = error instanceof Error ? error.message : 'no answer';
      await this.keepInReview(invoice, `Discard not confirmed: ${reason}`);
      return null;
    }
  }

  private async keepInReview(invoice: Invoice, message: string): Promise<void> {
    invoice.setReconciliationRequired(message.slice(0, 300));
    await this.invoices.save(invoice, invoice.tenantId);
  }

  /**
   * Last line of defence before the DPS is built: the Receita rejects a competence later than dhEmi (E0015).
   * Compared by calendar day in São Paulo, so a note scheduled for its competence day still goes out.
   */
  private assertCompetenceNotAfterIssue(invoice: Invoice): void {
    const snapshot = invoice.toSnapshot();
    const competenceDay = new Date(snapshot.competenceDate)
      .toISOString()
      .slice(0, 10);
    const issueDay = DateTime.fromJSDate(dpsIssuedAt(snapshot), {
      zone: 'America/Sao_Paulo',
    }).toISODate();
    if (competenceDay <= (issueDay ?? '')) return;
    throw new DpsBuildRejectionError(
      fiscalError({
        code: 'COMPETENCE_DATE_IN_FUTURE',
        message:
          'The competence date is later than the issue date of the DPS. Use today or an earlier date, or schedule the emission.',
        category: 'VALIDATION',
        step: 'NfseWorkflow',
        details: { competenceDate: competenceDay, issueDate: issueDay },
      }),
    );
  }

  private async payload(invoice: Invoice): Promise<IIssuePayload> {
    this.assertCompetenceNotAfterIssue(invoice);
    const company = await this.companies.findById(
      invoice.companyId,
      invoice.tenantId,
      invoice.environment,
    );
    // The simulator never reaches the Sefin, so it needs no certificate; every other path signs with the company's.
    const credentials = this.providers.isSimulated(invoice.environment)
      ? { pfxBuffer: Buffer.alloc(0), password: '' }
      : await this.certificates.decryptCredentials(
          company.id,
          invoice.tenantId,
          invoice.environment,
        );
    if (!invoice.dpsNumber) {
      const sequence = await this.sequences.reserveNext(
        company.id,
        invoice.tenantId,
        invoice.environment,
      );
      invoice.setDpsInfo(sequence.series, sequence.number);
      await this.invoices.saveDpsInfo(invoice);
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
      issuedAt: dpsIssuedAt(snapshot),
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
    if (fiscalSnapshot === null) {
      // The legacy payload cannot carry a deduction: issuing it would silently
      // tax the full amount, so a declared deduction is rejected instead.
      if (snapshot.deduction !== undefined && snapshot.deduction > 0) {
        throw new DpsBuildRejectionError(
          fiscalError({
            code: 'FISCAL_VALIDATION_FAILED',
            message:
              'A declared deduction cannot be issued without a fiscal calculation snapshot',
            category: 'VALIDATION',
            step: 'NfseWorkflow',
            details: { fields: ['deduction'] },
          }),
        );
      }
      // The legacy payload only identifies a customer by CPF or CNPJ.
      if (customer?.foreign) {
        throw new DpsBuildRejectionError(
          fiscalError({
            code: 'FISCAL_VALIDATION_FAILED',
            message:
              'A customer abroad (customer.foreign) cannot be issued without a fiscal calculation snapshot',
            category: 'VALIDATION',
            step: 'NfseWorkflow',
            details: { fields: ['customer.foreign'] },
          }),
        );
      }
      // A substitute must carry the `subst` group, which the legacy payload cannot.
      if (invoice.substitutesInvoiceId) {
        throw new DpsBuildRejectionError(
          fiscalError({
            code: 'FISCAL_VALIDATION_FAILED',
            message:
              'A substitute invoice cannot be issued without a fiscal calculation snapshot',
            category: 'VALIDATION',
            step: 'NfseWorkflow',
            details: { fields: ['substitutesInvoiceId'] },
          }),
        );
      }
      // Same reasoning for the complementary info: never issue without what was asked.
      const { purchaseOrder, notes } = snapshot.serviceSnapshot;
      if (purchaseOrder !== undefined || notes !== undefined) {
        throw new DpsBuildRejectionError(
          fiscalError({
            code: 'FISCAL_VALIDATION_FAILED',
            message:
              'purchaseOrder and notes cannot be issued without a fiscal calculation snapshot',
            category: 'VALIDATION',
            step: 'NfseWorkflow',
            details: { fields: ['purchaseOrder', 'notes'] },
          }),
        );
      }
      return payload;
    }
    // The numbering was already reserved and persisted above, so a failure from
    // here on keeps the number associated with this invoice.
    const dpsNumber = invoice.dpsNumber;
    const dpsSeries = snapshot.dpsSeries;
    if (dpsNumber === null || dpsSeries === null)
      throw new Error('Invoice DPS number is missing');
    const substitution = await this.substitutionFor(invoice);
    const built = await this.dpsBuilder.build(
      {
        result: fiscalSnapshot.result,
        invoice: {
          number: String(dpsNumber),
          serie: dpsSeries,
          issuedAt: dpsIssuedAt(snapshot).toISOString(),
          competenceDate: new Date(snapshot.competenceDate).toISOString(),
          description: snapshot.serviceSnapshot.description,
          municipalityCode: snapshot.serviceSnapshot.municipalityCode,
          environment: invoice.environment,
          sefin: this.sefinTarget(invoice.environment),
          customer: customer?.foreign
            ? {
                kind: 'FOREIGN' as const,
                name: customer.name,
                ...(customer.email ? { email: customer.email } : {}),
                foreign: customer.foreign,
              }
            : taxId && customer
              ? {
                  kind: taxId.length === 14 ? 'CNPJ' : 'CPF',
                  taxId,
                  name: customer.name,
                  ...(customer.email ? { email: customer.email } : {}),
                }
              : null,
          discountAmount: moneyString(toDecimal(snapshot.discount ?? 0)),
          ...(snapshot.deduction !== undefined && snapshot.deduction > 0
            ? { deductionAmount: moneyString(toDecimal(snapshot.deduction)) }
            : {}),
          ...(substitution ? { substitution } : {}),
          ...(snapshot.serviceSnapshot.purchaseOrder !== undefined
            ? { purchaseOrder: snapshot.serviceSnapshot.purchaseOrder }
            : {}),
          ...(snapshot.serviceSnapshot.notes !== undefined
            ? { notes: snapshot.serviceSnapshot.notes }
            : {}),
        },
        emitente: {
          cnpj: company.taxId,
          municipalReg: company.municipalRegForDps ?? null,
          municipalityCode: company.municipalityCode,
          specialTaxRegime: profile.specialTaxRegime ?? null,
          simplesIssRate:
            profile.taxRegime === 'SIMPLES_NACIONAL'
              ? (company.simplesIssRate ?? null)
              : (profile.simplesIssRate ?? null),
          ...this.simplesTotTribFor(profile, company),
        },
      },
      this.config.getOrThrow<RtcConfig>('rtc').dpsLayout,
      {
        cutoverAt: this.config.getOrThrow<RtcConfig>('rtc').nt009CutoverAt,
      },
    );
    if (!built.ok) throw new DpsBuildRejectionError(built.error);
    return { ...payload, preparedDps: built.value };
  }

  /**
   * The DPS carries the Simples approximate tax rate (pTotTribSN) and the
   * profile's regApTribSN. A MEI has no rate. An ME/EPP without one is refused
   * at intake, so it only reaches here with the rate.
   */
  private simplesTotTribFor(
    profile: CompanyFiscalProfile,
    company: Company,
  ): {
    simplesTotTrib?: {
      regApTribSN: 1 | 2 | 3 | null;
      totalRate: string | null;
    };
  } {
    const regApTribSN = regApTribSNFor(profile);
    if (profile.taxRegime === 'MEI')
      return { simplesTotTrib: { regApTribSN, totalRate: null } };
    if (profile.taxRegime !== 'SIMPLES_NACIONAL' || !company.simplesRate)
      return {};
    return {
      simplesTotTrib: { regApTribSN, totalRate: company.simplesRate },
    };
  }

  /**
   * Where the invoice is received: test always goes to the Sefin Produção Restrita; live goes to
   * production unless the app runs in homologation mode (`NFSE_SEFIN_ENVIRONMENT=restricted`).
   */
  private sefinTarget(
    environment: 'test' | 'live',
  ): 'production' | 'restricted' {
    return environment === 'test' ||
      this.config.get<string>('NFSE_SEFIN_ENVIRONMENT') === 'restricted'
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
    await this.webhooks.publish(invoice, 'nfse.invoice.rejected', {
      errorCode: code,
      errorMessage,
    });
  }
  private async schedule(
    invoice: Invoice,
    attemptCount = 0,
    uncertainSince: Date = new Date(),
  ): Promise<void> {
    await this.queues.add(
      'nfse-reconciliation',
      'reconcile',
      {
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        tenantId: invoice.tenantId,
        attemptCount,
        uncertainSince: uncertainSince.toISOString(),
      },
      {
        attempts: 5,
        backoffMs: 30000,
        delayMs: reconciliationDelayMs(attemptCount),
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }
  async emailSent(invoice: Invoice, sentAt: Date): Promise<void> {
    await this.webhooks.publish(
      invoice,
      'nfse.invoice.email_sent',
      { sentAt: sentAt.toISOString() },
      { emailStatus: 'sent' },
    );
  }
  async emailFailed(invoice: Invoice): Promise<void> {
    await this.webhooks.publish(
      invoice,
      'nfse.invoice.email_failed',
      {},
      { emailStatus: 'failed' },
    );
  }
}
