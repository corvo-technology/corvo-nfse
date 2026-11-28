import {
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthorityNotConfiguredError } from '@/infra/external/nfe/sefaz/endpoints';
import { nfceUrlsFor } from '@/infra/external/nfe/sefaz/nfce-urls';
import { dhEmiFor } from '@/infra/external/nfe/sefaz/uf';
import { CertificateNotFoundError } from '@/modules/certificate/domain/errors';
import { CompanyService } from '@/modules/company/application/company.service';
import { ICompanyNfeSettingsRepository } from '@/modules/company/domain/company-nfe-settings.repository';
import {
  FISCAL_SITUATION_READER,
  adviseContingency,
  type FiscalSituationReader,
} from '@/modules/fiscal-core/domain/fiscal-situation';
import type { LoadedCertificate } from '@/modules/fiscal-core/domain/ports/xml.port';
import {
  NfeIntakeService,
  type NfeSubmitted,
} from '@/modules/nfe/application/nfe-intake.service';
import {
  nfeIssuerOf,
  nfeRespTec,
  nfeVerProc,
} from '@/modules/nfe/application/nfe-issuer';
import type { PreparedNfe } from '@/modules/nfe/application/nfe-preparation.service';
import { nfeRequestHash } from '@/modules/nfe/application/nfe-request-hash';
import { NfeSefazAccess } from '@/modules/nfe/application/nfe-sefaz-access';
import { randomCnf } from '@/modules/nfe/domain/access-key';
import { NfeXmlBuilder } from '@/modules/nfe/domain/builder/nfe-xml-builder';
import type { NfeDocument } from '@/modules/nfe/domain/nfe-document';
import { draftFromDocument } from '@/modules/nfe/domain/nfe-draft-mapper';
import { centsToString } from '@/modules/nfe/domain/totals';
import { TypeormNfeNumbering } from '@/modules/nfe/infra/typeorm-nfe-numbering';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { NfeIssuer } from '@/modules/nfe/domain/nfe-draft';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfceInput } from '../domain/nfce-input';
import {
  nfceQrCodeOffline,
  nfceQrPayloadOffline,
  type NfceQrOfflineParams,
} from '../domain/nfce-qr-code-offline';
import { NfcePreparation } from './nfce-preparation.service';

/** Why a note is off-line, as `xJust` carries it (15 to 256 characters, no accents). */
export const OFFLINE_REASON_REQUESTED =
  'Emissao em contingencia off-line solicitada pelo emitente';
export const OFFLINE_REASON_AUTHORITY_DOWN = 'SEFAZ indisponivel';
export const OFFLINE_REASON_NO_CONNECTION = 'Sem comunicacao com a SEFAZ';

/** Not written as a literal `code`: the web catalogue scans the API source for those (the texts exist). */
const CERTIFICATE_NOT_FOUND = 'CERTIFICATE_NOT_FOUND';
const CERTIFICATE_UNUSABLE = 'CERTIFICATE_UNUSABLE';

/** 422: this UF has no off-line NFC-e (no QR Code address in the table). */
export function nfceOfflineNotAvailable(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'NFCE_OFFLINE_NOT_AVAILABLE',
    message:
      'The off-line NFC-e is not available for the state of this company yet',
    type: 'configuration',
  });
}

/** The two-digit day of `dhEmi` (`2026-11-26T10:00:00-03:00` gives `26`). */
const dayOf = (dhEmi: string): string => dhEmi.slice(8, 10);

/**
 * The NFC-e issued off-line (`tpEmis` 9): the Corvo numbers, builds and signs the note, makes the QR
 * Code v3 with its signature (RSA SHA-1 with the A1) and answers at once. Nothing here calls the
 * SEFAZ: the transmission is the `nfe.emit` message left in the outbox, sent when the authority
 * answers (spec 4.3). Everything is written in the single transaction of the intake.
 */
@Injectable()
export class NfceOfflineService {
  private readonly logger = new Logger(NfceOfflineService.name);

  constructor(
    private readonly preparation: NfcePreparation,
    private readonly intake: NfeIntakeService,
    private readonly access: NfeSefazAccess,
    private readonly numbering: TypeormNfeNumbering,
    private readonly companies: CompanyService,
    @Inject(ICompanyNfeSettingsRepository)
    private readonly settingsRepository: ICompanyNfeSettingsRepository,
    @Inject(FISCAL_SITUATION_READER)
    private readonly situation: FiscalSituationReader,
    private readonly config: ConfigService,
  ) {}

  /**
   * Is this sale to go off-line, and why (`xJust`)? The PDV's `contingency: 'offline'` always counts.
   * Without it, the note goes off-line by itself, always, when
   * the situation of the authority is not `normal` (the SEFAZ is down, or our way to it is); otherwise
   * the answer is `null` and the note takes the normal path. (The old company option `nfceAutoOffline`
   * is ignored: the contingency is always on.)
   */
  async reasonFor(
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfceInput,
  ): Promise<string | null> {
    if (input.contingency === 'offline') return OFFLINE_REASON_REQUESTED;
    const settings = await this.settingsRepository.find(
      input.companyId,
      tenantId,
    );
    if (!settings) return null;
    const company = await this.companies.findById(
      input.companyId,
      tenantId,
      environment,
    );
    const issuer = nfeIssuerOf(company, settings);
    const tpAmb = this.access.tpAmb(environment);
    try {
      nfceUrlsFor(issuer.uf, tpAmb);
    } catch (error) {
      if (error instanceof AuthorityNotConfiguredError) return null;
      throw error;
    }
    const advice = adviseContingency(
      await this.situation.situation({
        authority: this.access.breakerAuthority(issuer.uf, environment, 65),
        environment,
      }),
    );
    if (advice === 'normal') return null;
    this.logger.log(
      { tenantId, environment, advice, uf: issuer.uf },
      'NFC-e goes off-line by itself (SEFAZ out of reach)',
    );
    return advice === 'authority_down'
      ? OFFLINE_REASON_AUTHORITY_DOWN
      : OFFLINE_REASON_NO_CONNECTION;
  }

  submit(
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfceInput,
    idempotencyKey: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<NfeSubmitted> {
    let certificate: LoadedCertificate | null = null;
    return this.intake.submitWith({
      tenantId,
      environment,
      companyId: input.companyId,
      idempotencyKey,
      requestHash: nfeRequestHash({ model: 65, ...input }),
      model: 65,
      prepare: async () => {
        const prepared = await this.preparation.prepare(
          tenantId,
          environment,
          input,
        );
        try {
          nfceUrlsFor(
            nfeIssuerOf(prepared.company, prepared.settings).uf,
            this.access.tpAmb(environment),
          );
        } catch (error) {
          if (error instanceof AuthorityNotConfiguredError)
            throw nfceOfflineNotAvailable();
          throw error;
        }
        certificate = await this.loadCertificate(
          prepared.company.id,
          tenantId,
          environment,
        );
        return prepared;
      },
      offline: {
        contingencyAt: now,
        reason,
        assemble: (document, prepared) =>
          this.assemble(document, prepared, certificate as LoadedCertificate, {
            tenantId,
            environment,
            reason,
            now,
          }),
      },
    });
  }

  private async loadCertificate(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<LoadedCertificate> {
    try {
      return await this.access.certificate(companyId, tenantId, environment);
    } catch (error) {
      const code =
        error instanceof CertificateNotFoundError
          ? CERTIFICATE_NOT_FOUND
          : CERTIFICATE_UNUSABLE;
      throw new UnprocessableEntityException({
        code,
        message:
          code === CERTIFICATE_NOT_FOUND
            ? 'Cadastre o certificado digital da empresa neste ambiente para emitir'
            : 'O certificado digital da empresa está vencido ou inválido; envie outro',
        type: 'configuration',
      });
    }
  }

  /**
   * Inside the transaction of the intake: draws the number, the `cNF`, builds the XML with `tpEmis` 9,
   * `dhCont` and `xJust`, signs the QR Code and then the XML with the same A1, and puts it all on the
   * document (the first attempt).
   */
  private async assemble(
    document: NfeDocument,
    prepared: PreparedNfe,
    certificate: LoadedCertificate,
    ctx: {
      tenantId: string;
      environment: ExecutionEnvironment;
      reason: string;
      now: Date;
    },
  ): Promise<void> {
    const { settings } = prepared;
    const issuer = nfeIssuerOf(prepared.company, settings);
    const { tenantId, environment, reason, now } = ctx;
    const next = await this.numbering.reserveNext({
      companyId: document.companyId,
      tenantId,
      environment,
      model: 65,
      series: settings.nfceDefaultSeries ?? 1,
    });
    document.assignNumber(next.series, next.number);
    this.construct(document, issuer, certificate, environment, {
      cNf: randomCnf(next.number),
      issuedAtText: dhEmiFor(issuer.uf, now),
      reason,
    });
  }

  /**
   * A correction of an off-line NFC-e that the SEFAZ rejected: the same number, series, `cNF`, `dhEmi`
   * and `dhCont`, so the key is the same, with the corrected body, signed again. The certificate is
   * loaded now, before the transaction, and the returned function runs inside it.
   */
  async rebuilder(
    prepared: PreparedNfe,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<(locked: NfeDocument, prepared: PreparedNfe) => void> {
    const certificate = await this.loadCertificate(
      prepared.company.id,
      tenantId,
      environment,
    );
    return (locked, again) => {
      const issuer = nfeIssuerOf(again.company, again.settings);
      const s = locked.toSnapshot();
      if (!s.cNf || !s.issuedAt || !s.contingencyReason || !s.contingencyAt)
        throw new Error('The off-line NFC-e has no issuance data to rebuild');
      this.construct(locked, issuer, certificate, environment, {
        cNf: s.cNf,
        issuedAtText: dhEmiFor(issuer.uf, s.issuedAt),
        dhContText: dhEmiFor(issuer.uf, s.contingencyAt),
        reason: s.contingencyReason,
      });
    };
  }

  /** The XML (key, QR Code, signature) of the document as it is now, written as its next attempt. */
  private construct(
    document: NfeDocument,
    issuer: NfeIssuer & { uf: Uf },
    certificate: LoadedCertificate,
    environment: ExecutionEnvironment,
    p: {
      cNf: string;
      issuedAtText: string;
      dhContText?: string;
      reason: string;
    },
  ): void {
    const snapshot = document.toSnapshot();
    const tpAmb = this.access.tpAmb(environment);
    const urls = nfceUrlsFor(issuer.uf, tpAmb);
    const draft = draftFromDocument(snapshot, issuer);
    const recipientId = draft.recipient?.taxId ?? '';
    const qrParams = (accessKey: string): NfceQrOfflineParams => ({
      accessKey,
      tpAmb,
      day: dayOf(p.issuedAtText),
      vNF: centsToString(draft.totals.vNF),
      destIdType:
        recipientId.length === 11 ? '2' : recipientId.length === 14 ? '1' : '',
      destId:
        recipientId.length === 11 || recipientId.length === 14
          ? recipientId
          : '',
    });
    const built = NfeXmlBuilder.for(draft)
      .withNumber(snapshot.series as number, snapshot.number as number)
      .withCnf(p.cNf)
      .withIssuedAt(p.issuedAtText)
      .withTpAmb(tpAmb)
      .withVerProc(nfeVerProc(this.config))
      .withRespTec(nfeRespTec(this.config))
      .withContingency({
        tpEmis: 9,
        dhCont: p.dhContText ?? p.issuedAtText,
        xJust: p.reason,
      })
      .withSupplement({
        urlChave: urls.urlChave,
        qrCodeOf: (accessKey) => {
          const params = qrParams(accessKey);
          return nfceQrCodeOffline(
            urls.qrCode,
            params,
            this.access.signQr(
              nfceQrPayloadOffline(params),
              certificate,
              environment,
            ),
          );
        },
      })
      .build();
    document.startAttempt(
      p.cNf,
      built.accessKey,
      this.access.sign(built.xml, certificate, environment),
      new Date(p.issuedAtText),
      built.qrCode && built.urlChave
        ? { qrCode: built.qrCode, urlChave: built.urlChave }
        : undefined,
    );
    document.setAuthority(this.access.authorityOf(issuer.uf, 65));
  }
}
