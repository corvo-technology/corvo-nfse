import { Inject, Injectable, Logger } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import type { CachePort } from '@/infra/redis/cache.port';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { BillingRepository } from '@/modules/billing/domain/billing.repository';
import { DocumentCreditLedger } from '@/modules/fiscal-core/application/document-credit-ledger';
import { OutboxService } from '@/modules/invoice/application/outbox.service';
import { CustomerDirectory } from '@/modules/invoice/domain/customer-directory';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { NfeDocument } from '../domain/nfe-document';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import { contentFromDraft } from '../domain/nfe-draft-mapper';
import type { NfeInput } from '../domain/nfe-input';
import type { NfeStatus } from '../domain/nfe-status';
import {
  nfeIdempotencyKeyInvalid,
  nfeIdempotencyKeyRequired,
  nfeIdempotencyKeyReused,
} from './nfe-errors';
import { emitMessage, transmitMessage } from './nfe-messages';
import { NfePreparation, type PreparedNfe } from './nfe-preparation.service';
import { isValidIdempotencyKey, nfeRequestHash } from './nfe-request-hash';
import { documentTypeOf } from './nfe-transition.service';

/** What `submitWith` needs to accept a document of either model. */
export interface NfeSubmission {
  tenantId: string;
  environment: ExecutionEnvironment;
  companyId: string;
  idempotencyKey: string;
  requestHash: string;
  /** 55 NF-e, 65 NFC-e. */
  model: 55 | 65;
  /** The preconditions and the validators of the model; throws when anything is refused. */
  prepare: () => Promise<PreparedNfe>;
  /**
   * NFC-e issued off-line (`tpEmis` 9): the document is born `contingency_pending` and `assemble`
   * numbers, keys and signs it inside the same transaction, so the note is complete when it commits.
   */
  offline?: {
    contingencyAt: Date;
    /** `xJust`. */
    reason: string;
    assemble: (document: NfeDocument, prepared: PreparedNfe) => Promise<void>;
  };
}

export interface NfeSubmitted {
  id: string;
  status: NfeStatus;
  /** True when the key had already created this very NF-e: nothing new was written. */
  replayed: boolean;
}

/**
 * `POST /v1/invoices` (`type: "nfe"`): accepts the NF-e and returns at once; the SEFAZ is called later by the worker.
 * Everything that can be refused is refused here (preconditions, validators), before any write.
 * Once accepted, the document, its first history row, the credit reservation (live) and the
 * `nfe.emit` message commit together, under the tenant's billing lock, which also makes two
 * simultaneous requests with the same `Idempotency-Key` create a single document.
 */
@Injectable()
export class NfeIntakeService {
  private readonly logger = new Logger(NfeIntakeService.name);

  constructor(
    private readonly preparation: NfePreparation,
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly billing: BillingRepository,
    private readonly ledger: DocumentCreditLedger,
    private readonly outbox: OutboxService,
    private readonly customers: CustomerDirectory,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  /** Throws 400 when the header is missing or has the wrong size. */
  static assertIdempotencyKey(key: string | undefined): string {
    if (key === undefined) throw nfeIdempotencyKeyRequired();
    if (!isValidIdempotencyKey(key)) throw nfeIdempotencyKeyInvalid();
    return key;
  }

  /** The NF-e (model 55). */
  submit(
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfeInput,
    idempotencyKey: string,
  ): Promise<NfeSubmitted> {
    return this.submitWith({
      tenantId,
      environment,
      companyId: input.companyId,
      idempotencyKey,
      requestHash: nfeRequestHash(input),
      model: 55,
      prepare: () => this.preparation.prepare(tenantId, environment, input),
    });
  }

  /**
   * The shared path: replay by `Idempotency-Key`, then the checks of the model (`prepare`), then the
   * single transaction that writes the document, the credit and the message. The NFC-e comes in here
   * with `model: 65` (see `NfceIntakeService`).
   */
  async submitWith(submission: NfeSubmission): Promise<NfeSubmitted> {
    const {
      tenantId,
      environment,
      companyId,
      idempotencyKey,
      requestHash,
      model,
    } = submission;
    const earlier = await this.documents.findByIdempotencyKey(
      idempotencyKey,
      tenantId,
      environment,
    );
    if (earlier) return this.replayOrConflict(earlier, requestHash);

    const prepared = await submission.prepare();
    const { offline } = submission;
    const params = {
      tenantId,
      companyId,
      environment,
      idempotencyKey,
      requestHash,
      ...contentFromDraft(prepared.draft),
    };
    const document =
      offline && model === 65
        ? NfeDocument.createOffline({
            ...params,
            model,
            contingencyAt: offline.contingencyAt,
            contingencyReason: offline.reason,
          })
        : NfeDocument.create({ ...params, model });

    const outcome = await runWithTenant(tenantId, () =>
      this.unitOfWork.execute(() =>
        this.billing.locked(tenantId, async () => {
          // A concurrent request may have committed this key while the checks above ran.
          const winner = await this.documents.findByIdempotencyKey(
            idempotencyKey,
            tenantId,
            environment,
          );
          if (winner) return this.replayOrConflict(winner, requestHash);
          await this.ledger.reserve({
            type: documentTypeOf(model),
            id: document.id,
            tenantId,
            environment,
          });
          await offline?.assemble(document, prepared);
          await this.documents.insert(document);
          await this.documents.appendHistory(document.creationEntry());
          await this.outbox.enqueue(
            offline ? transmitMessage(document) : emitMessage(document),
          );
          return {
            id: document.id,
            status: document.status,
            replayed: false,
          } satisfies NfeSubmitted;
        }),
      ),
    );
    if (outcome.replayed) return outcome;
    await this.afterCommit(document);
    return outcome;
  }

  private replayOrConflict(
    existing: NfeDocument,
    requestHash: string,
  ): NfeSubmitted {
    if (existing.toSnapshot().requestHash !== requestHash)
      throw nfeIdempotencyKeyReused();
    return { id: existing.id, status: existing.status, replayed: true };
  }

  /** The balance cache and the customer directory: neither may undo or delay an accepted NF-e. */
  private async afterCommit(document: NfeDocument): Promise<void> {
    const { tenantId, environment, recipient } = document.toSnapshot();
    try {
      if (environment === 'live')
        await this.cache.delete(`credit:balance:${tenantId}`);
    } catch (error) {
      this.logger.warn(
        `Could not invalidate the credit balance cache: ${String(error)}`,
      );
    }
    if (!recipient?.taxId || !recipient.name) return;
    try {
      await runWithTenant(tenantId, () =>
        this.customers.remember(
          { tenantId, environment },
          {
            taxId: recipient.taxId,
            name: recipient.name,
            email: recipient.email,
          },
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Could not remember the recipient of NF-e ${document.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
