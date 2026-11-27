import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nfceUrlsFor } from '@/infra/external/nfe/sefaz/nfce-urls';
import { dhEmiFor } from '@/infra/external/nfe/sefaz/uf';
import type {
  NfeConsultResult,
  SignedNfe,
} from '@/infra/external/nfe/sefaz/signed-nfe';
import type { GatewayOutcome } from '@/modules/fiscal-core/domain/gateway-outcome';
import { CertificateNotFoundError } from '@/modules/certificate/domain/errors';
import { CompanyService } from '@/modules/company/application/company.service';
import { ICompanyNfeSettingsRepository } from '@/modules/company/domain/company-nfe-settings.repository';
import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
import { reconciliationDelayMs } from '@/modules/fiscal-core/domain/reconciliation-schedule';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { LoadedCertificate } from '@/modules/fiscal-core/domain/ports/xml.port';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import {
  FiscalPortalBreaker,
  PortalUnavailableError,
} from '@/modules/invoice/application/fiscal-portal-breaker';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { randomCnf } from '../domain/access-key';
import { NfeXmlBuilder } from '../domain/builder/nfe-xml-builder';
import type { NfeDocument } from '../domain/nfe-document';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import { draftFromDocument } from '../domain/nfe-draft-mapper';
import { NFE_EMIT, type NfeMessagePayload } from '../domain/nfe-message-types';
import { TypeormNfeNumbering } from '../infra/typeorm-nfe-numbering';
import { nfeIssuerOf, nfeRespTec, nfeVerProc } from './nfe-issuer';
import { emitRetryMessage, reconcileMessage } from './nfe-messages';
import {
  NO_ANSWER_CODE,
  NfeOutcomeService,
  UNAVAILABLE_CODE,
  keyOf,
} from './nfe-outcome.service';
import { NfeSefazAccess } from './nfe-sefaz-access';
import { NfeTransitionService, gatewayTypeOf } from './nfe-transition.service';

/** After this long without an answer from an open breaker, the job waits instead of failing. */
const RETRY_DELAY_MS = 60_000;

/** `certificate` problems end the document: the customer has to fix the company, not retry. */
const CERTIFICATE_NOT_FOUND = 'CERTIFICATE_NOT_FOUND';
const CERTIFICATE_UNUSABLE = 'CERTIFICATE_UNUSABLE';

/**
 * Emits one NF-e or NFC-e (outbox `nfe.emit`; the model is the document's).
 *
 *  1. Under the row lock, `queued` (or `retry_pending`) becomes `processing`; for a new attempt the
 *     number is drawn (kept when the document already has one), the `cNF`, the key, the XML and its
 *     signature are made, and all of it is committed BEFORE anything is sent (write-ahead).
 *  2. Outside any transaction, the authority's breaker is checked and the signed XML is sent.
 *  3. The answer decides the next state (`NfeOutcomeService`).
 *
 * A worker that dies after the send leaves the document `processing`; the redelivered message sees
 * that and hands the document to the reconciliation, which asks the SEFAZ by key and never renumbers.
 * The decrypted certificate lives only inside `process`.
 */
@Injectable()
export class NfeEmitHandler implements OutboxHandler, OnModuleInit {
  readonly type = NFE_EMIT;
  private readonly logger = new Logger(NfeEmitHandler.name);

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly gateways: FiscalDocumentRegistry,
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    private readonly companies: CompanyService,
    @Inject(ICompanyNfeSettingsRepository)
    private readonly settingsRepository: ICompanyNfeSettingsRepository,
    private readonly numbering: TypeormNfeNumbering,
    private readonly access: NfeSefazAccess,
    private readonly transitions: NfeTransitionService,
    private readonly outcomes: NfeOutcomeService,
    private readonly breaker: FiscalPortalBreaker,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { documentId, tenantId } =
      message.payload as unknown as NfeMessagePayload;
    await this.process(documentId, tenantId, message.environment);
  }

  async process(
    documentId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<void> {
    if (environment === 'live' && !this.access.productionEnabled())
      throw new Error('NF-e em produção ainda não liberada');
    const doc = await this.documents.findById(
      documentId,
      tenantId,
      environment,
    );
    if (!doc) {
      this.logger.warn({ documentId }, 'NF-e not found; message dropped');
      return;
    }
    if (doc.status === 'processing') return this.afterLostWorker(doc);
    if (
      doc.status !== 'queued' &&
      doc.status !== 'retry_pending' &&
      doc.status !== 'contingency_pending'
    )
      return;

    const company = await this.companies.findById(
      doc.companyId,
      tenantId,
      environment,
    );
    const settings = await this.settingsRepository.find(
      doc.companyId,
      tenantId,
    );
    const issuer = nfeIssuerOf(company, settings);
    const uf = issuer.uf;
    const model = doc.toSnapshot().model;

    let certificate: LoadedCertificate;
    try {
      certificate = await this.access.certificate(
        doc.companyId,
        tenantId,
        environment,
      );
    } catch (error) {
      return this.failConfiguration(doc, error);
    }

    // A retry and an off-line NFC-e (already numbered, keyed and signed) send the very same XML.
    const reuse =
      doc.status === 'retry_pending' || doc.status === 'contingency_pending';
    const started = await this.transitions.apply(keyOf(doc), 'processing', {
      from: ['queued', 'retry_pending', 'contingency_pending'],
      change: async (locked) => {
        locked.setAuthority(this.access.authorityOf(uf, model));
        // A retry sends the very same signed XML: nothing new is numbered, keyed or signed.
        if (reuse) return;
        if (locked.number === null) {
          const next = await this.numbering.reserveNext({
            companyId: locked.companyId,
            tenantId,
            environment,
            model,
            series:
              (model === 65
                ? settings?.nfceDefaultSeries
                : settings?.defaultSeries) ?? 1,
          });
          locked.assignNumber(next.series, next.number);
        }
        const { series, number } = locked.toSnapshot();
        const cNf = randomCnf(number as number);
        const issuedAtText = dhEmiFor(uf, new Date());
        const tpAmb = this.access.tpAmb(environment);
        const base = NfeXmlBuilder.for(
          draftFromDocument(locked.toSnapshot(), issuer),
        )
          .withNumber(series as number, number as number)
          .withCnf(cNf)
          .withIssuedAt(issuedAtText)
          .withTpAmb(tpAmb)
          .withVerProc(nfeVerProc(this.config))
          .withRespTec(nfeRespTec(this.config));
        // The NFC-e carries its QR Code (`infNFeSupl`), built with the key of this very attempt.
        const urls = model === 65 ? nfceUrlsFor(uf, tpAmb) : null;
        const built = (
          urls
            ? base.withSupplement({
                qrCodeBase: urls.qrCode,
                urlChave: urls.urlChave,
              })
            : base
        ).build();
        locked.startAttempt(
          cNf,
          built.accessKey,
          this.access.sign(built.xml, certificate, environment),
          new Date(issuedAtText),
          built.qrCode && built.urlChave
            ? { qrCode: built.qrCode, urlChave: built.urlChave }
            : undefined,
        );
      },
    });
    // Another worker took it first, or it moved on: nothing left to do here.
    if (!started.applied) return;
    await this.send(started.document, uf, certificate, model);
  }

  private async send(
    doc: NfeDocument,
    uf: Uf,
    certificate: LoadedCertificate,
    model: 55 | 65,
  ): Promise<void> {
    const snapshot = doc.toSnapshot();
    const environment = doc.environment;
    const authority = this.access.breakerAuthority(uf, environment, model);
    try {
      await this.breaker.assertAvailable(environment, authority);
    } catch (error) {
      if (error instanceof PortalUnavailableError)
        return this.waitFor(doc, error.retryAt);
      throw error;
    }
    // Proof that this attempt may have reached the SEFAZ, committed before the call (decision 14).
    if (snapshot.tpEmis === 9)
      await this.transitions.touch(keyOf(doc), {
        change: (d) => d.markTransmitted(new Date()),
      });
    const gateway = this.gateways.get<SignedNfe>(gatewayTypeOf(model));
    const ctx = this.access.context(uf, environment, certificate, model);
    const signed: SignedNfe = {
      accessKey: snapshot.accessKey as string,
      signedXml: snapshot.signedXml as string,
      uf,
    };
    const outcome = await gateway.issuer.issue(signed, ctx);
    const resolution = await this.outcomes.settle(
      doc,
      outcome,
      authority,
      () =>
        gateway.consult.consultByKey(signed.accessKey, ctx) as Promise<
          GatewayOutcome<NfeConsultResult>
        >,
    );
    if (resolution.kind === 'settled') return;
    if (resolution.kind === 'unavailable')
      return this.waitFor(
        doc,
        new Date(Date.now() + (resolution.retryAfterMs ?? RETRY_DELAY_MS)),
      );
    await this.toReconciliation(doc, NO_ANSWER_CODE);
  }

  /** Nothing was sent: the same attempt waits for the authority and goes out again. */
  private async waitFor(doc: NfeDocument, retryAt: Date): Promise<void> {
    // An off-line NFC-e goes back to the state it came from: it is with the consumer already.
    const offline = doc.toSnapshot().tpEmis === 9;
    await this.transitions.apply(
      keyOf(doc),
      offline ? 'contingency_pending' : 'retry_pending',
      {
        from: ['processing'],
        change: (d) => {
          d.scheduleCheck(retryAt);
          d.recordError({
            type: 'communication',
            code: UNAVAILABLE_CODE,
            message:
              'A SEFAZ está fora do ar; a nota será enviada quando voltar',
          });
        },
        messages: [emitRetryMessage(doc, retryAt)],
      },
    );
  }

  /** The send may have reached the SEFAZ: from now on only a consultation by key can tell. */
  private async toReconciliation(
    doc: NfeDocument,
    code: string,
  ): Promise<void> {
    const delay = reconciliationDelayMs(1);
    const at = new Date(Date.now() + delay);
    await this.transitions.apply(keyOf(doc), 'reconciliation_required', {
      from: ['processing'],
      change: (d) => {
        d.scheduleCheck(at, 1);
        d.recordError({
          type: 'communication',
          code,
          message:
            'Não houve resposta da SEFAZ; estamos conferindo pela chave, sem reenviar',
        });
      },
      messages: [reconcileMessage(doc, 1, at)],
    });
  }

  /** The message came back while the document is `processing`: the previous worker died mid-way. */
  private async afterLostWorker(doc: NfeDocument): Promise<void> {
    this.logger.warn(
      { documentId: doc.id },
      'NF-e left processing by a lost worker; reconciling by key',
    );
    await this.toReconciliation(doc, NO_ANSWER_CODE);
  }

  /** No usable certificate: the document ends `rejected` with a `configuration` error (credit refunded). */
  private async failConfiguration(
    doc: NfeDocument,
    error: unknown,
  ): Promise<void> {
    const code =
      error instanceof CertificateNotFoundError
        ? CERTIFICATE_NOT_FOUND
        : CERTIFICATE_UNUSABLE;
    const message =
      code === CERTIFICATE_NOT_FOUND
        ? 'Cadastre o certificado digital da empresa neste ambiente para emitir'
        : 'O certificado digital da empresa está vencido ou inválido; envie outro';
    await this.transitions.apply(keyOf(doc), 'processing', {
      from: ['queued', 'retry_pending', 'contingency_pending'],
    });
    await this.transitions.apply(keyOf(doc), 'rejected', {
      change: (d) => d.recordError({ type: 'configuration', code, message }),
    });
  }
}
