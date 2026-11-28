import { Injectable, Logger, Optional } from '@nestjs/common';
import type {
  NfeAuthorization,
  NfeConsultResult,
} from '@/infra/external/nfe/sefaz/signed-nfe';
import type { GatewayOutcome } from '@/modules/fiscal-core/domain/gateway-outcome';
import type { Authorization } from '@/modules/fiscal-core/domain/ports/gateway.port';
import {
  CUSTOMER_NAME_MAX,
  CustomerDirectory,
} from '@/modules/invoice/domain/customer-directory';
import { FiscalPortalBreaker } from '@/modules/invoice/application/fiscal-portal-breaker';
import type { NfeDocument } from '../domain/nfe-document';
import { prepareDocumentsMessage } from './nfe-messages';
import { NfeTransitionService, type NfeKey } from './nfe-transition.service';

/** What the caller still has to do: nothing (settled) or deal with a communication failure. */
export type IssueResolution =
  | { kind: 'settled'; document: NfeDocument }
  | { kind: 'uncertain'; reason: 'timeout' | 'network' | 'server' }
  | { kind: 'unavailable'; retryAfterMs?: number };

export const keyOf = (doc: NfeDocument): NfeKey => ({
  id: doc.id,
  tenantId: doc.tenantId,
  environment: doc.environment,
});

/** What the customer reads in `lastError` when the SEFAZ did not answer (never in the XML). */
export const NO_ANSWER_CODE = 'SEFAZ_NO_ANSWER';
export const UNAVAILABLE_CODE = 'SEFAZ_UNAVAILABLE';

/**
 * Turns what the SEFAZ answered into the document's next state. Shared by the first send and by
 * the reconciliation that sends the same signed XML again, so both end the same way. A
 * communication failure is not settled here: the caller decides to wait or to reconcile.
 */
@Injectable()
export class NfeOutcomeService {
  private readonly logger = new Logger(NfeOutcomeService.name);

  constructor(
    private readonly transitions: NfeTransitionService,
    private readonly breaker: FiscalPortalBreaker,
    @Optional() private readonly customers?: CustomerDirectory,
  ) {}

  /**
   * Saves the recipient of an authorized NF-e in the customers list (as the NFS-e does), so the next
   * note for the same CPF/CNPJ is filled in. Best effort: it never fails or delays the note.
   */
  private async rememberRecipient(doc: NfeDocument): Promise<void> {
    const recipient = doc.toSnapshot().recipient;
    if (!recipient) return;
    const { taxId, name, email, address, indIeDest, stateRegistration } =
      recipient;
    const clean = name?.trim();
    if (!this.customers || !taxId || !clean || clean.length > CUSTOMER_NAME_MAX)
      return;
    try {
      await this.customers.remember(
        { tenantId: doc.tenantId, environment: doc.environment },
        {
          taxId,
          name: clean,
          email: email ?? null,
          address,
          indIeDest,
          stateRegistration,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not remember the recipient of NF-e ${doc.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * @param consult asks the SEFAZ about the key (used when it says the NF-e is a duplicate).
   */
  async settle(
    doc: NfeDocument,
    outcome: GatewayOutcome<Authorization>,
    breakerAuthority: string,
    consult: () => Promise<GatewayOutcome<NfeConsultResult>>,
  ): Promise<IssueResolution> {
    const env = doc.environment;
    switch (outcome.kind) {
      case 'ok':
        await this.breaker.recordSuccess(env, breakerAuthority);
        return this.authorized(doc, outcome.value as NfeAuthorization);
      case 'rejected':
        await this.breaker.recordSuccess(env, breakerAuthority);
        // 204: the SEFAZ already has this key. Adopt its authorization instead of failing.
        if (outcome.code === '204') return this.duplicate(doc, consult);
        return this.settled(
          await this.transitions.apply(keyOf(doc), 'rejected', {
            info: { cStat: outcome.code, xMotivo: outcome.message },
            change: (d) =>
              d.recordError({
                type: 'validation',
                code: outcome.code,
                message: outcome.message,
              }),
          }),
        );
      case 'denied':
        await this.breaker.recordSuccess(env, breakerAuthority);
        return this.denied(doc, outcome.code, outcome.message);
      case 'uncertain':
        await this.breaker.recordFailure(env, breakerAuthority);
        return { kind: 'uncertain', reason: outcome.reason };
      case 'unavailable':
        await this.breaker.recordFailure(env, breakerAuthority);
        return { kind: 'unavailable', retryAfterMs: outcome.retryAfterMs };
    }
  }

  /** The authorization found by a consultation, adopted as if the send had answered it. */
  async authorized(
    doc: NfeDocument,
    auth: NfeAuthorization,
  ): Promise<IssueResolution> {
    const result = await this.transitions.apply(keyOf(doc), 'authorized', {
      info: { cStat: auth.cStat ?? '100', xMotivo: auth.xMotivo ?? null },
      change: (d) =>
        d.recordAuthorization({
          accessKey: auth.accessKey,
          protocol: auth.protocol,
          authorizedAt: auth.authorizedAt,
          cStat: auth.cStat,
          xMotivo: auth.xMotivo,
          protNFeXml: auth.protNFeXml,
        }),
      // Same transaction: the documents (nfeProc, DANFE) are prepared once, after this commit.
      messages: [prepareDocumentsMessage(doc)],
    });
    await this.rememberRecipient(doc);
    return this.settled(result);
  }

  /** The authority says the NF-e is denied: same ending as a denial answered to the send. */
  async denied(
    doc: NfeDocument,
    cStat: string,
    xMotivo: string,
  ): Promise<IssueResolution> {
    await this.leaveManualReview(doc);
    return this.settled(
      await this.transitions.apply(keyOf(doc), 'denied', {
        info: { cStat, xMotivo },
        change: (d) =>
          d.recordError({ type: 'validation', code: cStat, message: xMotivo }),
      }),
    );
  }

  /**
   * The authority says the NF-e was authorized and then cancelled: the document goes through the
   * authorization and ends `cancelled` (no credit comes back: it was authorized once).
   */
  async cancelled(
    doc: NfeDocument,
    auth: NfeAuthorization,
  ): Promise<IssueResolution> {
    await this.authorized(doc, auth);
    await this.transitions.apply(keyOf(doc), 'cancelling', {
      from: ['authorized'],
    });
    return this.settled(
      await this.transitions.apply(keyOf(doc), 'cancelled', {
        from: ['cancelling'],
      }),
    );
  }

  /** `manual_review` cannot go to `denied` directly: it goes back to reconciling first. */
  private async leaveManualReview(doc: NfeDocument): Promise<void> {
    if (doc.status === 'manual_review')
      await this.transitions.apply(keyOf(doc), 'reconciliation_required', {
        from: ['manual_review'],
      });
  }

  private async duplicate(
    doc: NfeDocument,
    consult: () => Promise<GatewayOutcome<NfeConsultResult>>,
  ): Promise<IssueResolution> {
    const found = await consult();
    if (found.kind === 'ok' && found.value.authorization)
      return this.authorized(doc, found.value.authorization);
    // The SEFAZ says it has the key but would not show the protocol: only a later look can tell.
    return { kind: 'uncertain', reason: 'server' };
  }

  private settled(result: { document: NfeDocument }): IssueResolution {
    return { kind: 'settled', document: result.document };
  }
}
