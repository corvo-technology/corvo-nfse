import { Inject, Injectable } from '@nestjs/common';
import { DocumentCreditLedger } from '@/modules/fiscal-core/application/document-credit-ledger';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfeDocument } from '../domain/nfe-document';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import { contentFromDraft } from '../domain/nfe-draft-mapper';
import type { NfeInput } from '../domain/nfe-input';
import {
  nfeInvalidState,
  nfeNotFound,
  nfeValidationFailed,
} from './nfe-errors';
import { emitMessage } from './nfe-messages';
import { NfePreparation, type PreparedNfe } from './nfe-preparation.service';
import { nfeRequestHash } from './nfe-request-hash';
import { keyOf } from './nfe-outcome.service';
import type { NfeSubmitted } from './nfe-intake.service';
import { NfeTransitionService, documentTypeOf } from './nfe-transition.service';

/** Not written as a literal `code`: the web error catalogue scans the API source for those. */
const COMPANY_MISMATCH = 'COMPANY_MISMATCH';

/**
 * What the customer can do with a rejected NF-e: correct and send it again (`PUT /v1/invoices/{id}`,
 * same number, new key) or give it up (`POST /v1/invoices/{id}/discard`). A rejection gave the credit
 * back, so a resubmission reserves it again, like a new NF-e.
 */
@Injectable()
export class NfeResubmitService {
  constructor(
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    private readonly preparation: NfePreparation,
    private readonly transitions: NfeTransitionService,
    private readonly ledger: DocumentCreditLedger,
  ) {}

  /** The NF-e (model 55). */
  resubmit(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfeInput,
  ): Promise<NfeSubmitted> {
    return this.resubmitWith(id, tenantId, environment, {
      companyId: input.companyId,
      requestHash: nfeRequestHash(input),
      prepare: () => this.preparation.prepare(tenantId, environment, input),
    });
  }

  /** The shared path; the NFC-e comes in here with its own `prepare` and `model: 65`. */
  async resubmitWith(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    submission: {
      companyId: string;
      requestHash: string;
      prepare: () => Promise<PreparedNfe>;
      model?: 55 | 65;
    },
  ): Promise<NfeSubmitted> {
    const { requestHash } = submission;
    const current = await this.find(
      id,
      tenantId,
      environment,
      submission.model,
    );
    if (current.status !== 'rejected')
      return this.replayOrConflict(current, requestHash, 'resubmitted');
    if (submission.companyId !== current.companyId)
      throw nfeValidationFailed([
        {
          field: 'companyId',
          code: COMPANY_MISMATCH,
          message: 'The company of a rejected NF-e cannot change',
        },
      ]);

    const { draft } = await submission.prepare();
    const content = contentFromDraft(draft);
    const result = await this.transitions.apply(keyOf(current), 'queued', {
      from: ['rejected'],
      change: async (locked) => {
        await this.ledger.reserve({
          type: documentTypeOf(locked.toSnapshot().model),
          id: locked.id,
          tenantId,
          environment,
        });
        locked.replaceContent(content, requestHash);
        locked.recordError(null);
        await this.documents.replaceItems(locked);
      },
      messages: [emitMessage(current)],
    });
    if (!result.applied)
      // Someone else resubmitted or discarded it between the read and the lock.
      return this.replayOrConflict(result.document, requestHash, 'resubmitted');
    return { id, status: result.document.status, replayed: false };
  }

  async discard(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    model?: 55 | 65,
  ): Promise<NfeDocument> {
    const current = await this.find(id, tenantId, environment, model);
    if (current.status === 'discarded') return current;
    if (current.status !== 'rejected')
      throw nfeInvalidState(current.status, 'discarded');
    const result = await this.transitions.apply(keyOf(current), 'discarded', {
      from: ['rejected'],
    });
    if (!result.applied && result.document.status !== 'discarded')
      throw nfeInvalidState(result.document.status, 'discarded');
    return result.document;
  }

  private async find(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    model?: 55 | 65,
  ): Promise<NfeDocument> {
    const doc = await this.documents.findById(
      id,
      tenantId,
      environment,
      model ? { model } : {},
    );
    if (!doc) throw nfeNotFound();
    return doc;
  }

  /** The same body sent again is the same request; any other body meets a state it cannot change. */
  private replayOrConflict(
    doc: NfeDocument,
    requestHash: string,
    operation: string,
  ): NfeSubmitted {
    if (doc.toSnapshot().requestHash === requestHash)
      return { id: doc.id, status: doc.status, replayed: true };
    throw nfeInvalidState(doc.status, operation);
  }
}
