import { QUEUE_RETENTION } from '@/infra/redis/queue-retention';
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
import { reconciliationDelayMs } from '@/modules/fiscal-core/domain/reconciliation-schedule';
import { FiscalPortalBreaker, isPortalOutage } from './fiscal-portal-breaker';
import {
  PORTAL_DPS_QUERY_REJECTED,
  PORTAL_DPS_QUERY_REJECTED_MESSAGE,
  isPortalLookupRejected,
  portalBodyOf,
  reconciliationJobKey,
} from './reconciliation-job';
import { failureMessage } from '@/infra/external/nfse/connection-failure';
import {
  DpsNumberingService,
  NumberingCheckUnavailableError,
  NumberingNeedsConfirmationError,
  skippedNumbersMessage,
} from './dps-numbering.service';
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
import {
  checkPortalNfse,
  DPS_USED_BY_OTHER_NFSE,
  PORTAL_NFSE_WRONG_ENVIRONMENT,
  wrongEnvironmentMessage,
  dpsUsedByOtherNfseMessage,
  type PortalNfseCheck,
} from '../domain/fiscal/portal-nfse-match';

export interface FiscalJobData {
  invoiceId: string;
  tenantId: string;
  companyId?: string;
  apiKeyEnvironment?: 'test' | 'live';
  attemptCount?: number;
  /** ISO time the invoice first lost a conclusive answer; drives the manual review ceiling. */
  uncertainSince?: string;
  /** Set by a person on an invoice in manual review: confirm on the portal and discard it. */
  review?: 'discard' | 'sweep' | 'renumber';
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

/** Error kind, HTTP status and a short message: enough to trace a portal failure, no body or headers. */
export function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause).slice(0, 120);
  const status = (cause as { status?: unknown }).status;
  const parts = [cause.name || cause.constructor?.name];
  if (typeof status === 'number') parts.push(`HTTP ${status}`);
  parts.push(cause.message.slice(0, 120));
  return parts.join(' ');
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

/** The portal returned a note for our DPS that could not be read, so it was not accepted. */
export const PORTAL_NFSE_UNVERIFIED = 'PORTAL_NFSE_UNVERIFIED';

type AuthorizedResult = Pick<
  FiscalIssueResult,
  'accessKey' | 'nfseNumber' | 'xmlAuthorized'
>;

/**
 * The DpsBuilder rejected the layout/schema: the invoice must be rejected
 * before `queued → processing` and before any provider `issue` call. The DPS
 * number already reserved by `payload()` stays associated with the invoice, so
 * it is never handed to another invoice.
 */
/** Most times one emission may take a new DPS number because the government says it is used. */
const MAX_RENUMBERS = 3;

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
  /** Numbers skipped for an invoice, written in its first timeline entry. */
  private readonly skipNotes = new WeakMap<Invoice, string>();
  /** DPS numbers the government confirmed as used while this invoice was emitted, and the note for its timeline. */
  private readonly burned = new WeakMap<Invoice, number[]>();
  private readonly renumberNotes = new WeakMap<Invoice, string>();
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
    @Optional() private readonly numbering?: DpsNumberingService,
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

  private async processTenant(
    data: FiscalJobData,
    loaded?: Invoice,
    renumbers = 0,
  ): Promise<void> {
    const invoice =
      loaded ??
      (await this.invoices.findByIdAndTenantId(data.invoiceId, data.tenantId));
    if (!invoice) return;
    if (data.companyId && data.companyId !== invoice.companyId)
      throw new Error('Invoice/company job identity mismatch');
    if (data.review === 'discard') return this.discard(invoice);
    if (data.review === 'sweep') return this.sweepManualReview(invoice);
    if (data.review === 'renumber') {
      if (!(await this.reopenForRenumbering(invoice))) return;
      return this.processTenant({ ...data, review: undefined }, invoice, 1);
    }
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
    // A DPS never sent to the portal cannot be ours: a duplicate answer to it is proof it is used.
    const neverSent = renumbers > 0 || invoice.status === 'queued';
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
    if (renumbers > 0) {
      await this.invoices.saveDpsInfo(invoice);
      this.noteRenumbering(invoice);
    }
    if (invoice.status === 'queued') {
      const skipNote = this.skipNotes.get(invoice);
      const event = invoice.transitionTo(
        'processing',
        skipNote
          ? `Starting fiscal emission. ${skipNote}`
          : 'Starting fiscal emission',
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
      if (isPortalLookupRejected(error))
        return this.stopOnRejectedLookup(invoice, error, 'reconciliation');
      if (isPortalOutage(error))
        await this.breaker?.recordFailure(invoice.environment);
      this.logReconciliation('warn', invoice, failureKind(error), {
        attempt: data.attemptCount ?? 0,
        nextDelayMs: reconciliationDelayMs((data.attemptCount ?? 0) + 1),
        errorName: error instanceof Error ? error.name : undefined,
        reason: safeReason(error instanceof Error ? error.message : undefined),
        portalBody: portalBodyOf(error) || undefined,
      });
      invoice.setReconciliationRequired(
        failureMessage(error, 'Uncertain fiscal result'),
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
      await this.authorize(invoice, result, () =>
        this.renumberAndRetry(invoice, data, renumbers),
      );
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
    } else if (
      neverSent &&
      result.errorCode === 'DPS_NUMBER_ALREADY_USED' &&
      (await this.renumberAndRetry(invoice, data, renumbers))
    ) {
      return;
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
   * The government confirmed the invoice's DPS number belongs to another note (E0014 on a DPS
   * never sent, or the portal's note for it is someone else's). The number stays burned: probe
   * forward, raise the sequence, and emit the SAME invoice again with a new DPS. Capped per
   * emission; returns false when it should not or cannot (then the old behaviour applies). An
   * unavailable portal throws, so the job stays retryable.
   */
  private async renumberAndRetry(
    invoice: Invoice,
    data: FiscalJobData,
    renumbers: number,
  ): Promise<boolean> {
    const old = invoice.toSnapshot().dpsNumber;
    if (!this.numbering || !old || renumbers >= MAX_RENUMBERS) return false;
    try {
      await this.numbering.skipForward(
        invoice.companyId,
        invoice.tenantId,
        invoice.environment,
      );
    } catch (error: unknown) {
      if (error instanceof NumberingNeedsConfirmationError) return false;
      throw error;
    }
    this.burned.set(invoice, [...(this.burned.get(invoice) ?? []), old]);
    this.logger.warn(
      { invoiceId: invoice.id, burnedNumber: old, renumbers: renumbers + 1 },
      'DPS number already used at the government; emitting again with the next free number',
    );
    invoice.resetDpsForRenumbering();
    await this.processTenant(data, invoice, renumbers + 1);
    return true;
  }

  /** Timeline text for the renumbered invoice, once its new number is known. */
  private noteRenumbering(invoice: Invoice): void {
    const burned = this.burned.get(invoice);
    if (!burned?.length) return;
    const used =
      burned.length === 1
        ? `O número ${burned[0]} já estava usado`
        : `Os números ${burned.join(', ')} já estavam usados`;
    const note = `${used} no governo; a nota saiu com o número ${invoice.dpsNumber}.`;
    this.renumberNotes.set(invoice, note);
    this.skipNotes.set(invoice, note);
  }

  /**
   * "Tentar de novo" on a manual-review invoice whose DPS belongs to another note: the portal is
   * asked again, and only when it still says the note is someone else's does the invoice go back
   * to emission with a new number. Our own note is authorized; any doubt leaves it in review.
   */
  private async reopenForRenumbering(invoice: Invoice): Promise<boolean> {
    if (invoice.status !== 'manual_review') return false;
    if (invoice.toSnapshot().lastErrorCode !== DPS_USED_BY_OTHER_NFSE)
      return false;
    await this.breaker?.assertAvailable(invoice.environment);
    const found = await this.lookUpDps(invoice);
    if (!found) return false;
    await this.breaker?.recordSuccess(invoice.environment);
    if (found.status !== 'authorized' || !found.xmlAuthorized) {
      await this.keepInReview(
        invoice,
        'Renumbering not done: the portal did not confirm the number is used',
      );
      return false;
    }
    const check = await this.checkPortalNote(invoice, found.xmlAuthorized);
    if (check.matches) {
      await this.markAuthorized(invoice, found);
      return false;
    }
    if (
      check.differences.includes('unreadable') ||
      check.differences.includes('environment')
    )
      return false;
    try {
      await this.numbering?.skipForward(
        invoice.companyId,
        invoice.tenantId,
        invoice.environment,
      );
    } catch (error: unknown) {
      if (!(error instanceof NumberingNeedsConfirmationError)) throw error;
      await this.keepInReview(invoice, error.message);
      return false;
    }
    await this.lifecycle.transition(
      invoice,
      invoice.transitionTo(
        'reconciliation_required',
        'Retry with a new DPS number requested in manual review',
      ),
    );
    const old = invoice.toSnapshot().dpsNumber;
    if (old) this.burned.set(invoice, [old]);
    invoice.resetDpsForRenumbering();
    return true;
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

  /**
   * Every path that takes an authorized NFS-e from the portal for this invoice (emission answer,
   * reconciliation, manual-review sweep) comes through here. The portal answers by DPS id, so a
   * DPS number already used by another emission returns THAT note: it is checked against the
   * invoice first and, when it is not ours, the invoice goes to manual review instead.
   */
  private async authorize(
    invoice: Invoice,
    result: AuthorizedResult,
    renumber?: () => Promise<boolean>,
  ): Promise<void> {
    if (!result.xmlAuthorized || !result.accessKey)
      throw new Error('Authorized fiscal result lacks XML/access key');
    const check = await this.checkPortalNote(invoice, result.xmlAuthorized);
    if (!check.matches) {
      // The portal proved the number belongs to another note: take the next free one.
      const foreign =
        !check.differences.includes('unreadable') &&
        !check.differences.includes('environment');
      if (foreign && renumber && (await renumber())) return;
      return this.refusePortalNote(invoice, check);
    }
    return this.markAuthorized(invoice, result);
  }

  /** What our invoice says, compared with the NFS-e the portal returned for its DPS. */
  private async checkPortalNote(
    invoice: Invoice,
    xml: string,
  ): Promise<PortalNfseCheck> {
    const company = await this.companies.findById(
      invoice.companyId,
      invoice.tenantId,
      invoice.environment,
    );
    const snapshot = invoice.toSnapshot();
    const customer = snapshot.customerSnapshot;
    return checkPortalNfse(xml, {
      environment: invoice.environment,
      providerTaxId: company.taxId,
      customerTaxId: customer?.foreign ? null : (customer?.taxId ?? null),
      amount: snapshot.amount,
      competenceDate: new Date(snapshot.competenceDate)
        .toISOString()
        .slice(0, 10),
      series: snapshot.dpsSeries ?? '',
      number: invoice.dpsNumber ?? 0,
    });
  }

  /** The text and code shown on an invoice whose DPS the portal has on another note. */
  private portalNoteError(
    invoice: Invoice,
    check: Exclude<PortalNfseCheck, { matches: true }>,
  ): { code: string; message: string } {
    const snapshot = invoice.toSnapshot();
    if (check.differences.includes('unreadable'))
      return {
        code: PORTAL_NFSE_UNVERIFIED,
        message: `O portal devolveu uma nota para o DPS ${snapshot.dpsNumber} (série ${snapshot.dpsSeries}) que não conseguimos conferir, então ela não foi aceita. Fale com o suporte antes de emitir de novo.`,
      };
    if (check.differences.includes('environment'))
      return {
        code: PORTAL_NFSE_WRONG_ENVIRONMENT,
        message: wrongEnvironmentMessage(invoice.environment, check.found),
      };
    return {
      code: DPS_USED_BY_OTHER_NFSE,
      message: dpsUsedByOtherNfseMessage(
        { series: snapshot.dpsSeries ?? '', number: snapshot.dpsNumber ?? 0 },
        check.found,
      ),
    };
  }

  /**
   * The portal's note is not this invoice's: never authorize, never store its XML. The invoice
   * goes to manual review with the reason; a person discards it and issues the sale again.
   */
  private async refusePortalNote(
    invoice: Invoice,
    check: Exclude<PortalNfseCheck, { matches: true }>,
  ): Promise<void> {
    const { code, message } = this.portalNoteError(invoice, check);
    this.logReconciliation('warn', invoice, 'portal_nfse_mismatch', {
      errorCode: code,
      differences: check.differences,
      portalNfseNumber: check.found?.nfseNumber,
      portalIssuedOn: check.found?.issuedOn,
    });
    invoice.setRejected(code, message);
    if (invoice.status === 'manual_review') {
      await this.invoices.save(invoice, invoice.tenantId);
      return;
    }
    if (invoice.status === 'processing')
      await this.lifecycle.transition(
        invoice,
        invoice.transitionTo('reconciliation_required', message),
      );
    await this.lifecycle.transition(
      invoice,
      invoice.transitionTo('manual_review', message),
    );
    await this.webhooks.publish(invoice, 'nfse.invoice.manual_review', {
      reason: message,
      errorCode: code,
    });
  }

  /** Saves the authorized XML, moves the invoice to authorized and starts the follow-up jobs. */
  private async markAuthorized(
    invoice: Invoice,
    result: AuthorizedResult,
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
    const renumberNote = this.renumberNotes.get(invoice);
    await this.lifecycle.transition(
      invoice,
      invoice.transitionTo(
        'authorized',
        renumberNote ? `NFS-e authorized. ${renumberNote}` : 'NFS-e authorized',
      ),
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
          ...QUEUE_RETENTION['nfse-doc-prep'],
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
          ...QUEUE_RETENTION['nfse-fiscal-reconcile'],
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
    // The portal already said this DPS belongs to another note: asking again changes nothing.
    const lastCode = invoice.toSnapshot().lastErrorCode;
    if (
      lastCode === DPS_USED_BY_OTHER_NFSE ||
      lastCode === PORTAL_NFSE_WRONG_ENVIRONMENT ||
      lastCode === PORTAL_DPS_QUERY_REJECTED
    )
      return;
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
      if (isPortalOutage(error))
        await this.breaker?.recordFailure(invoice.environment);
      this.logReconciliation('warn', invoice, failureKind(error), {
        source: 'manual_review_sweep',
        errorName: error instanceof Error ? error.name : undefined,
        reason: safeReason(error instanceof Error ? error.message : undefined),
        portalBody: portalBodyOf(error) || undefined,
      });
      if (isPortalLookupRejected(error))
        await this.markLookupRejected(invoice, error);
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
    if (found.status === 'authorized') return this.discardFound(invoice, found);
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

  /**
   * Discard found an NFS-e for the DPS. If it is ours, the invoice is authorized (never a second
   * NFS-e). If it is another note, this invoice was never issued: it is rejected and its credit
   * returns, keeping the reason. A note that cannot be read leaves the invoice in review.
   */
  private async discardFound(
    invoice: Invoice,
    found: FiscalQueryResult,
  ): Promise<void> {
    if (!found.xmlAuthorized || !found.accessKey)
      throw new Error('Authorized fiscal result lacks XML/access key');
    const check = await this.checkPortalNote(invoice, found.xmlAuthorized);
    if (check.matches) return this.markAuthorized(invoice, found);
    if (check.differences.includes('unreadable'))
      return this.refusePortalNote(invoice, check);
    this.logReconciliation(
      'warn',
      invoice,
      'discarded_dps_used_by_other_nfse',
      {
        differences: check.differences,
        portalNfseNumber: check.found?.nfseNumber,
      },
    );
    const snapshot = invoice.toSnapshot();
    const discarded = dpsUsedByOtherNfseMessage(
      { series: snapshot.dpsSeries ?? '', number: snapshot.dpsNumber ?? 0 },
      check.found,
      true,
    );
    invoice.setRejected(DPS_USED_BY_OTHER_NFSE, discarded);
    await this.lifecycle.transition(
      invoice,
      invoice.transitionTo('rejected', discarded),
    );
    await this.webhooks.publish(invoice, 'nfse.invoice.rejected', {
      errorCode: DPS_USED_BY_OTHER_NFSE,
      errorMessage: discarded,
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
      if (isPortalOutage(error))
        await this.breaker?.recordFailure(invoice.environment);
      const reason = error instanceof Error ? error.message : 'no answer';
      const body = portalBodyOf(error);
      this.logReconciliation('warn', invoice, failureKind(error), {
        source: 'manual_review_discard',
        reason: safeReason(reason),
        portalBody: body || undefined,
      });
      await this.keepInReview(
        invoice,
        body
          ? `Discard not confirmed: ${reason}. Portal: ${body}`
          : `Discard not confirmed: ${reason}`,
      );
      return null;
    }
  }

  /**
   * The portal answered the DPS lookup with HTTP 400: the lookup itself was refused, so asking
   * again changes nothing. No new attempt is queued; the invoice goes to manual review with the
   * portal's (sanitized) words so a person can see why.
   */
  private async stopOnRejectedLookup(
    invoice: Invoice,
    error: unknown,
    source: string,
  ): Promise<void> {
    this.logReconciliation('warn', invoice, 'lookup_rejected', {
      source,
      status: 400,
      portalBody: portalBodyOf(error) || undefined,
    });
    await this.markLookupRejected(invoice, error);
  }

  private async markLookupRejected(
    invoice: Invoice,
    error: unknown,
  ): Promise<void> {
    if (
      invoice.status === 'manual_review' &&
      invoice.toSnapshot().lastErrorCode === PORTAL_DPS_QUERY_REJECTED
    )
      return;
    const detail = portalBodyOf(error);
    const reason = detail
      ? `${PORTAL_DPS_QUERY_REJECTED_MESSAGE} Detalhe do portal: ${detail}`
      : PORTAL_DPS_QUERY_REJECTED_MESSAGE;
    invoice.setRejected(
      PORTAL_DPS_QUERY_REJECTED,
      PORTAL_DPS_QUERY_REJECTED_MESSAGE,
      detail || undefined,
    );
    if (invoice.status === 'manual_review') {
      await this.invoices.save(invoice, invoice.tenantId);
      return;
    }
    if (invoice.status === 'processing')
      await this.lifecycle.transition(
        invoice,
        invoice.transitionTo('reconciliation_required', reason),
      );
    await this.lifecycle.transition(
      invoice,
      invoice.transitionTo('manual_review', reason),
    );
    await this.webhooks.publish(invoice, 'nfse.invoice.manual_review', {
      reason,
      errorCode: PORTAL_DPS_QUERY_REJECTED,
    });
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

  /**
   * First emission of a company: the government is asked before a DPS number is reserved. Numbers
   * it confirms as used are skipped (the numbering only moves forward) and the skip is written on
   * the invoice timeline. If the portal cannot run the check, the note goes on with the next number
   * of the sequence: nothing is guessed, because the government refuses a DPS number already used
   * (E0014) and that answer takes the next free number (renumberAndRetry). If every number asked is
   * used, the invoice is rejected (credit returned) so the owner adjusts the numbering.
   */
  private async skipUsedNumbers(invoice: Invoice): Promise<void> {
    try {
      await this.skipUsedNumbersOrFail(invoice);
    } catch (error: unknown) {
      if (!(error instanceof NumberingCheckUnavailableError)) throw error;
      this.logger.warn(
        {
          invoiceId: invoice.id,
          companyId: invoice.companyId,
          environment: invoice.environment,
          cause: describeCause(error.cause),
        },
        'Numbering check before the first note was not possible; emitting with the next number of the sequence',
      );
    }
  }

  private async skipUsedNumbersOrFail(invoice: Invoice): Promise<void> {
    try {
      const skipped = await this.numbering?.skipUsedNumbers(
        invoice.companyId,
        invoice.tenantId,
        invoice.environment,
      );
      if (!skipped) return;
      const note = skippedNumbersMessage(skipped);
      this.skipNotes.set(invoice, note);
      this.logger.warn({ invoiceId: invoice.id, ...skipped }, note);
    } catch (error: unknown) {
      if (!(error instanceof NumberingNeedsConfirmationError)) throw error;
      throw new DpsBuildRejectionError(
        fiscalError({
          code: 'DPS_NUMBERING_NEEDS_CONFIRMATION',
          message: error.message,
          category: 'VALIDATION',
          step: 'NfseWorkflow',
          details: {
            usedNumbers: error.check.usedNumbers,
            suggestedNext: error.check.suggestedNext,
          },
        }),
      );
    }
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
      await this.skipUsedNumbers(invoice);
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
        // One chain per invoice: a second job for the same attempt slot is ignored by the queue.
        idempotencyKey: reconciliationJobKey(invoice.id, attemptCount),
        attempts: 5,
        backoffMs: 30000,
        delayMs: reconciliationDelayMs(attemptCount),
        removeOnComplete: true,
        removeOnFail: true,
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
