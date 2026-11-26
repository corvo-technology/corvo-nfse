import { Inject, Injectable } from '@nestjs/common';
import type {
  NfeConsultResult,
  SignedNfe,
} from '@/infra/external/nfe/sefaz/signed-nfe';
import { CompanyService } from '@/modules/company/application/company.service';
import { ICompanyNfeSettingsRepository } from '@/modules/company/domain/company-nfe-settings.repository';
import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
import type { GatewayOutcome } from '@/modules/fiscal-core/domain/gateway-outcome';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { SigningContext } from '@/modules/fiscal-core/domain/ports/gateway.port';
import { reconciliationDelayMs } from '@/modules/fiscal-core/domain/reconciliation-schedule';
import {
  FiscalPortalBreaker,
  PortalUnavailableError,
} from '@/modules/invoice/application/fiscal-portal-breaker';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfeDocument } from '../domain/nfe-document';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import type { NfeStatus } from '../domain/nfe-status';
import { nfeInvalidState, nfeNotFound } from './nfe-errors';
import { nfeIssuerOf } from './nfe-issuer';
import { reconcileMessage } from './nfe-messages';
import {
  NO_ANSWER_CODE,
  NfeOutcomeService,
  keyOf,
  type IssueResolution,
} from './nfe-outcome.service';
import { NfeSefazAccess } from './nfe-sefaz-access';
import { NfeTransitionService } from './nfe-transition.service';

/** Automatic looks at the SEFAZ (2, 4, 8, 16 and 30 minutes) before a person has to step in. */
export const MAX_RECONCILE_ATTEMPTS = 5;

const HOUR_MS = 3_600_000;
const SETTLED: NfeStatus[] = [
  'authorized',
  'rejected',
  'denied',
  'cancelling',
  'cancelled',
  'discarded',
];

export type SyncMode = 'manual' | 'automatic';

/**
 * Reconciliation by key (`nfe.reconcile` and `POST /v1/invoices/{id}/sync`): asks the SEFAZ what it has
 * for the key of the document and adopts it. Nothing here renumbers or rebuilds the XML; when the
 * SEFAZ still does not know the key after `uncertainMaxHours`, the SAME signed XML is sent again.
 */
@Injectable()
export class NfeConsultService {
  constructor(
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    private readonly companies: CompanyService,
    @Inject(ICompanyNfeSettingsRepository)
    private readonly settingsRepository: ICompanyNfeSettingsRepository,
    private readonly gateways: FiscalDocumentRegistry,
    private readonly access: NfeSefazAccess,
    private readonly transitions: NfeTransitionService,
    private readonly outcomes: NfeOutcomeService,
    private readonly breaker: FiscalPortalBreaker,
  ) {}

  async sync(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    mode: SyncMode = 'manual',
  ): Promise<NfeDocument> {
    const doc = await this.documents.findById(id, tenantId, environment);
    if (!doc) throw nfeNotFound();
    const status = doc.status;
    if (status !== 'reconciliation_required' && status !== 'manual_review') {
      // Asked by hand about a note that is already settled: the answer is the note itself.
      if (mode === 'automatic' || SETTLED.includes(status)) return doc;
      throw nfeInvalidState(status, 'synchronized');
    }
    const snapshot = doc.toSnapshot();
    if (!snapshot.accessKey || !snapshot.signedXml) return doc;

    const company = await this.companies.findById(
      doc.companyId,
      tenantId,
      environment,
    );
    const settings = await this.settingsRepository.find(
      doc.companyId,
      tenantId,
    );
    const uf = nfeIssuerOf(company, settings).uf;
    const authority = this.access.breakerAuthority(uf, environment);

    if (mode === 'automatic') {
      try {
        await this.breaker.assertAvailable(environment, authority);
      } catch (error) {
        // The authority is paused: look again when it may be back, without spending an attempt.
        if (error instanceof PortalUnavailableError)
          return this.later(doc, error.retryAt, false);
        throw error;
      }
    }

    const certificate = await this.access.certificate(
      doc.companyId,
      tenantId,
      environment,
    );
    const ctx = this.access.context(uf, environment, certificate);
    const gateway = this.gateways.get<SignedNfe>('nfe');
    const consult = () =>
      gateway.consult.consultByKey(
        snapshot.accessKey as string,
        ctx,
      ) as Promise<GatewayOutcome<NfeConsultResult>>;

    const answer = await consult();
    if (answer.kind === 'ok') {
      await this.breaker.recordSuccess(environment, authority);
      const found = answer.value;
      if (found.status === 'authorized' && found.authorization)
        return this.done(
          await this.outcomes.authorized(doc, found.authorization),
          doc,
        );
      if (found.status === 'cancelled' && found.authorization)
        return this.done(
          await this.outcomes.cancelled(doc, found.authorization),
          doc,
        );
      if (found.status === 'denied')
        return this.done(
          await this.outcomes.denied(
            doc,
            found.cStat,
            found.xMotivo ?? 'Uso denegado',
          ),
          doc,
        );
      if (found.status === 'not_found' && this.mayResend(doc))
        return this.resend(doc, uf, ctx, authority, mode, consult);
    } else if (answer.kind !== 'rejected') {
      await this.breaker.recordFailure(environment, authority);
    }
    return this.later(doc, undefined, true, mode);
  }

  /** The SEFAZ has not seen the key for longer than the window: the same signed XML goes again. */
  private mayResend(doc: NfeDocument): boolean {
    const issuedAt = doc.toSnapshot().issuedAt;
    if (!issuedAt) return false;
    return (
      Date.now() - issuedAt.getTime() >=
      this.breaker.settings.uncertainMaxHours * HOUR_MS
    );
  }

  private async resend(
    doc: NfeDocument,
    uf: Uf,
    ctx: SigningContext,
    authority: string,
    mode: SyncMode,
    consult: () => Promise<GatewayOutcome<NfeConsultResult>>,
  ): Promise<NfeDocument> {
    const snapshot = doc.toSnapshot();
    const gateway = this.gateways.get<SignedNfe>('nfe');
    const outcome = await gateway.issuer.issue(
      {
        accessKey: snapshot.accessKey as string,
        signedXml: snapshot.signedXml as string,
        uf,
      },
      ctx,
    );
    const resolution = await this.outcomes.settle(
      doc,
      outcome,
      authority,
      consult,
    );
    if (resolution.kind === 'settled') return resolution.document;
    return this.later(doc, undefined, true, mode);
  }

  private done(
    resolution: IssueResolution,
    fallback: NfeDocument,
  ): NfeDocument {
    return resolution.kind === 'settled' ? resolution.document : fallback;
  }

  /**
   * Still no answer: another look later, or `manual_review` when the automatic ones are spent.
   * `spend` false keeps the count (the authority was paused, nothing was asked).
   */
  private async later(
    doc: NfeDocument,
    at: Date | undefined,
    spend: boolean,
    mode: SyncMode = 'automatic',
  ): Promise<NfeDocument> {
    // A person asked and nothing is new: the document stays as it is.
    if (mode === 'manual') return doc;
    const attempts = doc.toSnapshot().reconcileAttempts + (spend ? 1 : 0);
    if (spend && attempts >= MAX_RECONCILE_ATTEMPTS)
      return (
        await this.transitions.apply(keyOf(doc), 'manual_review', {
          from: ['reconciliation_required'],
          change: (d) => {
            d.scheduleCheck(null, attempts);
            d.recordError({
              type: 'communication',
              code: NO_ANSWER_CODE,
              message:
                'A SEFAZ não confirmou a nota; confira pelo painel ou tente sincronizar de novo',
            });
          },
        })
      ).document;
    const when = at ?? new Date(Date.now() + reconciliationDelayMs(attempts));
    return this.transitions.touch(keyOf(doc), {
      change: (d) => d.scheduleCheck(when, attempts),
      messages: [
        reconcileMessage(
          doc,
          spend ? attempts : `${attempts}p${when.getTime()}`,
          when,
        ),
      ],
    });
  }
}
