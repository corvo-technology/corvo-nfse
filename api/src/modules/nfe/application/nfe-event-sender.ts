import { endpointTpEmis } from '@/infra/external/nfe/sefaz/endpoints';
import { Inject, Injectable } from '@nestjs/common';
import type { SignedNfe } from '@/infra/external/nfe/sefaz/signed-nfe';
import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
import type { GatewayOutcome } from '@/modules/fiscal-core/domain/gateway-outcome';
import type { EventReceipt } from '@/modules/fiscal-core/domain/ports/gateway.port';
import { reconciliationDelayMs } from '@/modules/fiscal-core/domain/reconciliation-schedule';
import {
  FiscalPortalBreaker,
  PortalUnavailableError,
} from '@/modules/invoice/application/fiscal-portal-breaker';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import { CANCEL_TP_EVENTO } from '../domain/nfe-event';
import { TypeormNfeEvents } from '../infra/typeorm-nfe-events';
import { NfeEventContext, certificateProblemOf } from './nfe-event-context';
import { NfeEventOutcomeService } from './nfe-event-outcome.service';
import { eventReconcileMessage, eventSendMessage } from './nfe-messages';
import { NfeSefazAccess } from './nfe-sefaz-access';
import { gatewayTypeOf } from './nfe-transition.service';

/** The breaker is open (or the service said 108/109): the same send is put off this long. */
const RETRY_DELAY_MS = 60_000;

/** An event the SEFAZ said it registered, as the outcome service stores it. */
export function receiptOf(value: EventReceipt) {
  return {
    protocol: value.protocol,
    procXml: value.procXml ?? null,
    cStat: value.cStat,
    xMotivo: value.xMotivo ?? null,
  };
}

/**
 * Sends one stored event (`nfe.cancel` / `nfe.correct`): the signed request goes out exactly as it
 * was stored, whatever the number of the try. The answer decides the event; no answer leaves it
 * `pending_check` for the reconciliation.
 */
@Injectable()
export class NfeEventSender {
  constructor(
    private readonly gateways: FiscalDocumentRegistry,
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    private readonly events: TypeormNfeEvents,
    private readonly context: NfeEventContext,
    private readonly access: NfeSefazAccess,
    private readonly breaker: FiscalPortalBreaker,
    private readonly outcomes: NfeEventOutcomeService,
  ) {}

  async send(
    eventId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    attempt = 0,
  ): Promise<void> {
    this.context.assertEnvironment(environment);
    const event = await this.events.find(eventId, tenantId);
    if (!event || event.status !== 'pending' || !event.requestXml) return;
    const doc = await this.documents.findById(
      event.documentId,
      tenantId,
      environment,
    );
    if (!doc) return;
    const cancel = event.tpEvento === CANCEL_TP_EVENTO;
    // The document moved on (cancelled by another path, never authorized): nothing to send.
    if (doc.status !== (cancel ? 'cancelling' : 'authorized')) return;

    const issuer = await this.context.issuer(
      doc.companyId,
      tenantId,
      environment,
    );
    let certificate;
    try {
      certificate = await this.access.certificate(
        doc.companyId,
        tenantId,
        environment,
      );
    } catch (error) {
      const problem = certificateProblemOf(error);
      return this.outcomes.rejected(event, doc, problem.code, problem.message);
    }

    const model = doc.toSnapshot().model;
    const tpEmis = endpointTpEmis(doc.toSnapshot().accessKey ?? '');
    const authority = this.access.breakerAuthority(
      issuer.uf,
      environment,
      model,
      tpEmis,
    );
    try {
      await this.breaker.assertAvailable(environment, authority);
    } catch (error) {
      if (error instanceof PortalUnavailableError)
        return this.outcomes.later(
          doc,
          eventSendMessage(
            doc,
            event,
            `paused-${error.retryAt.getTime()}`,
            error.retryAt,
            attempt + 1,
          ),
        );
      throw error;
    }

    const snapshot = doc.toSnapshot();
    const ctx = this.access.context(
      issuer.uf,
      environment,
      certificate,
      model,
      tpEmis,
    );
    const gateway = this.gateways.get<SignedNfe>(gatewayTypeOf(model));
    const text = event.text ?? '';
    const outcome: GatewayOutcome<EventReceipt> = cancel
      ? await (gateway.cancel?.cancel(
          {
            accessKey: snapshot.accessKey as string,
            reason: text,
            justification: text,
            protocol: snapshot.protocol ?? undefined,
            signedXml: event.requestXml,
          },
          ctx,
        ) ?? Promise.reject(new Error('The gateway cannot cancel')))
      : await (gateway.correct?.correct(
          {
            accessKey: snapshot.accessKey as string,
            correction: text,
            sequence: event.nSeq,
            signedXml: event.requestXml,
          },
          ctx,
        ) ?? Promise.reject(new Error('The gateway cannot correct')));

    switch (outcome.kind) {
      case 'ok':
        await this.breaker.recordSuccess(environment, authority);
        return this.outcomes.registered(event, doc, receiptOf(outcome.value));
      case 'rejected':
        await this.breaker.recordSuccess(environment, authority);
        return this.outcomes.rejected(
          event,
          doc,
          outcome.code,
          outcome.message,
        );
      case 'denied':
        await this.breaker.recordSuccess(environment, authority);
        return this.outcomes.rejected(
          event,
          doc,
          outcome.code,
          outcome.message,
        );
      case 'uncertain':
        await this.breaker.recordFailure(environment, authority);
        return this.outcomes.pendingCheck(
          event,
          doc,
          eventReconcileMessage(
            doc,
            event,
            1,
            new Date(Date.now() + reconciliationDelayMs(1)),
          ),
        );
      case 'unavailable': {
        await this.breaker.recordFailure(environment, authority);
        const retryAt = new Date(
          Date.now() + (outcome.retryAfterMs ?? RETRY_DELAY_MS),
        );
        return this.outcomes.later(
          doc,
          eventSendMessage(
            doc,
            event,
            `down-${retryAt.getTime()}`,
            retryAt,
            attempt + 1,
          ),
        );
      }
    }
  }
}
