import { endpointTpEmis } from '@/infra/external/nfe/sefaz/endpoints';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  NfeConsultResult,
  SignedNfe,
} from '@/infra/external/nfe/sefaz/signed-nfe';
import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
import type { GatewayOutcome } from '@/modules/fiscal-core/domain/gateway-outcome';
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

/** Looks at the SEFAZ for an event before a person has to step in (same schedule as the NF-e). */
export const MAX_EVENT_LOOKS = 5;

/**
 * An event whose answer was lost (`pending_check`): asks the SEFAZ for the NF-e by its key (the
 * answer lists the registered events as `procEventoNFe`). The event is registered when it is
 * there; when the SEFAZ answers and it is not there, it goes back to `pending` and the SAME signed
 * request is sent again (never a new one). While the SEFAZ does not answer, the looks go on, up to
 * `MAX_EVENT_LOOKS`.
 */
@Injectable()
export class NfeEventReconcile {
  private readonly logger = new Logger(NfeEventReconcile.name);

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

  async reconcile(
    eventId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    look = 1,
  ): Promise<void> {
    this.context.assertEnvironment(environment);
    const event = await this.events.find(eventId, tenantId);
    if (!event || event.status !== 'pending_check') return;
    const doc = await this.documents.findById(
      event.documentId,
      tenantId,
      environment,
    );
    if (!doc) return;
    const snapshot = doc.toSnapshot();
    if (!snapshot.accessKey) return;

    const issuer = await this.context.issuer(
      doc.companyId,
      tenantId,
      environment,
    );
    const model = snapshot.model;
    const tpEmis = endpointTpEmis(snapshot.accessKey ?? '');
    const authority = this.access.breakerAuthority(
      issuer.uf,
      environment,
      model,
      tpEmis,
    );
    try {
      await this.breaker.assertAvailable(environment, authority);
    } catch (error) {
      // Paused: look again when it may be back, without spending a look.
      if (error instanceof PortalUnavailableError)
        return this.outcomes.later(
          doc,
          eventReconcileMessage(doc, event, look, error.retryAt, true),
        );
      throw error;
    }

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
    const ctx = this.access.context(
      issuer.uf,
      environment,
      certificate,
      model,
      tpEmis,
    );
    const answer = (await this.gateways
      .get<SignedNfe>(gatewayTypeOf(model))
      .consult.consultByKey(
        snapshot.accessKey,
        ctx,
      )) as GatewayOutcome<NfeConsultResult>;

    if (answer.kind !== 'ok') {
      if (answer.kind !== 'rejected')
        await this.breaker.recordFailure(environment, authority);
      return this.lookAgain(event, doc, look);
    }
    await this.breaker.recordSuccess(environment, authority);

    const found = answer.value.events.find(
      (e) => e.tpEvento === event.tpEvento && e.nSeq === event.nSeq,
    );
    if (found)
      return this.outcomes.registered(event, doc, {
        protocol: found.protocol || null,
        procXml: found.procEventoXml || null,
        cStat: '135',
        xMotivo: 'Evento registrado e vinculado a NF-e',
      });
    // Cancelled on the SEFAZ side with the event list left out of the answer: it is registered.
    if (
      event.tpEvento === CANCEL_TP_EVENTO &&
      answer.value.status === 'cancelled'
    )
      return this.outcomes.registered(event, doc, {
        protocol: null,
        procXml: null,
        cStat: answer.value.cStat,
        xMotivo: answer.value.xMotivo,
      });
    if (
      answer.value.status === 'authorized' ||
      answer.value.status === 'cancelled'
    )
      // The SEFAZ knows the NF-e and has no such event: send the same request again.
      return this.outcomes.backToPending(
        event,
        doc,
        eventSendMessage(doc, event, `resend-${Date.now()}`),
      );
    return this.lookAgain(event, doc, look);
  }

  private async lookAgain(
    event: Parameters<NfeEventOutcomeService['pendingCheck']>[0],
    doc: Parameters<NfeEventOutcomeService['pendingCheck']>[1],
    look: number,
  ): Promise<void> {
    if (look >= MAX_EVENT_LOOKS) {
      // Left `pending_check` on purpose: the SEFAZ never confirmed, and resending could duplicate.
      this.logger.warn(
        { documentId: doc.id, eventId: event.id },
        'The SEFAZ did not confirm the event after the automatic looks',
      );
      return;
    }
    const next = look + 1;
    await this.outcomes.later(
      doc,
      eventReconcileMessage(
        doc,
        event,
        next,
        new Date(Date.now() + reconciliationDelayMs(next)),
      ),
    );
  }
}
