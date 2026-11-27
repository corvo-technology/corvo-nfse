import {
  resolveDpsLayout,
  XML_LAYOUT,
  type ConfiguredDpsLayout,
  type DpsLayoutPolicy,
} from '@/modules/invoice/domain/fiscal/dps/dps-layout';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type {
  MunicipalityAgreementAnswer,
  MunicipalityAgreementPort,
} from '@/modules/company/domain/municipality-agreement';
import { renderInvoicePdf } from '@/modules/invoice/infra/danfse/danfse';
import { ConfigService } from '@nestjs/config';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Dispatcher } from 'undici';
import { GovRouteSelector } from '@/modules/portal-reachability/gov-route.selector';
import {
  NfseClient,
  parsePfx,
  Ambiente,
  TipoAmbiente,
  TipoAmbienteDps,
  buildDpsId,
  pendingEmissionId,
  ReceitaRejectionError,
  ValidationError,
  NotFoundError,
  HttpStatusError,
  fetchDpsStatus,
  JustificativaCancelamento,
  parseNfseXml,
  type PendingEvent,
  type RetryStore,
  type NfseEmitResult,
  type DpsDryRunResult,
  type NfseQueryResult,
  type NsuQueryResult,
} from 'open-nfse';
import { InvoiceOrmEntity } from '@/modules/invoice/infra/invoice.orm-entity';
import type {
  FiscalProvider,
  FiscalIssueResult,
  FiscalQueryResult,
  IIssuePayload,
  ICancelPayload,
  FiscalCancelResult,
  FiscalCancellationReason,
} from './nfse-fiscal-provider';
import { issueParams, type SefinEnvironment } from './issue-params';
import { explainRejection, rejectionCode } from './rejection-guidance';
import { failureMessage } from './connection-failure';
import { GovRateLimiter } from './gov-rate-limiter';

const CANCELLATION_REASON: Record<
  FiscalCancellationReason,
  JustificativaCancelamento
> = {
  issue_error: JustificativaCancelamento.ErroEmissao,
  service_not_provided: JustificativaCancelamento.ServicoNaoPrestado,
  other: JustificativaCancelamento.Outros,
};

/** The portal says the DPS id is malformed (400, E2400): the form of the id is wrong, not the DPS. */
function isMalformedDpsId(error: unknown): boolean {
  return (
    error instanceof HttpStatusError &&
    error.status === 400 &&
    (error.body ?? '').includes('E2400')
  );
}

@Injectable()
export class OpenNfseProvider
  implements FiscalProvider, MunicipalityAgreementPort
{
  private readonly logger = new Logger(OpenNfseProvider.name);
  /** `NFSE_SEFIN_ENVIRONMENT=restricted` forces every invoice, live included, to the homologation Sefin. */
  private readonly homologationOnly: boolean;
  private readonly configuredLayout: ConfiguredDpsLayout;
  private readonly layoutPolicy: DpsLayoutPolicy;
  /** Sefin environments whose DPS lookup takes the 42 digits without the "DPS" prefix (see `dpsStatus`). */
  private readonly dpsIdWithoutPrefix = new Set<SefinEnvironment>();

  constructor(
    @InjectDataSource() private readonly database: DataSource,
    config: ConfigService,
    /** Backup route: absent (tests) means every government call goes direct. */
    @Optional() private readonly routes?: GovRouteSelector,
    @Optional() private readonly limiter?: GovRateLimiter,
  ) {
    this.homologationOnly =
      config.get<SefinEnvironment>('NFSE_SEFIN_ENVIRONMENT') === 'restricted';
    this.configuredLayout =
      config.get<ConfiguredDpsLayout>('rtc.dpsLayout') ?? 'rtc-v1.01';
    this.layoutPolicy = {
      cutoverAt: config.get<string>('rtc.nt009CutoverAt'),
    };
    if (this.homologationOnly) {
      this.logger.warn(
        'NFSE_SEFIN_ENVIRONMENT=restricted: live invoices go to the Sefin Produção Restrita (homologation), not to production.',
      );
    }
  }

  /** Test invoices always go to the Produção Restrita; live ones go to production unless homologation-only. */
  private sefinFor(environment: 'test' | 'live'): SefinEnvironment {
    return environment === 'test' || this.homologationOnly
      ? 'restricted'
      : 'production';
  }

  /**
   * One call to a government host, behind the shared rate limit. `sefin` serves issue, cancel and
   * the DPS/note lookups; `adn` serves the portal feed and the municipal parameters. A 429 (or a
   * 503 with Retry-After) pauses the host for every replica.
   */
  private async gov<T>(
    environment: 'test' | 'live',
    host: 'sefin' | 'adn',
    call: () => Promise<T>,
  ): Promise<T> {
    if (!this.limiter) return call();
    const key = `${host}:${this.sefinFor(environment)}`;
    await this.limiter.acquire(key);
    try {
      return await call();
    } catch (error) {
      await this.limiter.noteError(key, error);
      throw error;
    }
  }

  /** `replayPendingEvents` answers with the error instead of throwing it: the pause must still happen. */
  private async noteReplayError(
    environment: 'test' | 'live',
    result: { status: string; error?: unknown } | undefined,
  ): Promise<void> {
    if (result?.error)
      await this.limiter?.noteError(
        `sefin:${this.sefinFor(environment)}`,
        result.error,
      );
  }

  private ambienteFor(environment: 'test' | 'live'): Ambiente {
    return this.sefinFor(environment) === 'restricted'
      ? Ambiente.ProducaoRestrita
      : Ambiente.Producao;
  }

  /** The `tpAmb` of an event: the same as the Sefin that receives it (1 production, 2 Produção Restrita). */
  private tpAmbFor(environment: 'test' | 'live'): TipoAmbienteDps {
    return this.sefinFor(environment) === 'production'
      ? TipoAmbienteDps.Producao
      : TipoAmbienteDps.Homologacao;
  }

  private store(
    payload: Pick<IIssuePayload, 'invoiceId' | 'tenantId' | 'environment'>,
  ): RetryStore {
    const tenantId = payload.tenantId!;
    requireTenantId(tenantId);
    const repo = this.database.getRepository(InvoiceOrmEntity);
    const identity = {
      id: payload.invoiceId!,
      tenantId: payload.tenantId!,
      environment: payload.environment,
    };
    return {
      save: async (entry) =>
        runWithTenant(tenantId, async () => {
          await repo
            .createQueryBuilder()
            .update()
            .set({
              pendingEmission: () => 'CAST(:pending AS jsonb)',
              dpsId: entry.kind === 'emission' ? entry.idDps : undefined,
            })
            .where(identity)
            .setParameter('pending', JSON.stringify(entry))
            .execute();
        }),
      list: async () =>
        runWithTenant(tenantId, async () => {
          const row = await repo
            .createQueryBuilder('i')
            .addSelect('i.pendingEmission')
            .where(
              'i.id = :id AND i.tenant_id = :tenantId AND i.environment = :environment',
              identity,
            )
            .getOneOrFail();
          if (!row.pendingEmission) return [];
          const entry = row.pendingEmission as unknown as PendingEvent;
          return [
            {
              ...entry,
              firstAttemptAt: new Date(entry.firstAttemptAt),
              lastAttemptAt: new Date(entry.lastAttemptAt),
              ...(entry.notBefore
                ? { notBefore: new Date(entry.notBefore) }
                : {}),
            },
          ];
        }),
      // Keep signed XML until the fiscal result is committed, including across a crash.
      delete: async () => {},
    };
  }
  /**
   * The backup route for this call: a CONNECT-proxy dispatcher while our network cannot reach the
   * government, `undefined` (direct) otherwise. The client keeps mTLS end to end through the tunnel.
   */
  private async routeFor(
    payload: Pick<IIssuePayload, 'environment' | 'pfxBuffer' | 'p12Password'>,
  ): Promise<Dispatcher | undefined> {
    if (!this.routes || !(await this.routes.useProxy())) return undefined;
    try {
      const host =
        this.sefinFor(payload.environment) === 'restricted'
          ? 'sefin.producaorestrita.nfse.gov.br'
          : 'sefin.nfse.gov.br';
      const pem = parsePfx(payload.pfxBuffer, payload.p12Password);
      return await this.routes.dispatcherFor(host, 'nfse', pem);
    } catch {
      return undefined;
    }
  }

  private client(
    payload: Pick<IIssuePayload, 'environment' | 'pfxBuffer' | 'p12Password'>,
    retryStore?: RetryStore,
    at: Date = new Date(),
    dispatcher?: Dispatcher,
  ): NfseClient {
    return new NfseClient({
      ambiente: this.ambienteFor(payload.environment),
      certificado: { pfx: payload.pfxBuffer, password: payload.p12Password },
      retryStore,
      // Every endpoint of the client is Sefin/ADN, so the proxy only ever sees allowlisted hosts.
      ...(dispatcher ? { dispatcher } : {}),
      dpsLayout:
        XML_LAYOUT[
          resolveDpsLayout({
            ...this.layoutPolicy,
            configured: this.configuredLayout,
            sefinEnvironment: this.sefinFor(payload.environment),
            at,
          })
        ],
    });
  }
  /** Municipality agreement with the Sefin (`consultarConvenio`). Always fresh: the caller stores the answer. */
  async lookup(input: {
    municipalityCode: string;
    environment: 'test' | 'live';
    pfxBuffer: Buffer;
    password: string;
  }): Promise<MunicipalityAgreementAnswer> {
    const route = {
      environment: input.environment,
      pfxBuffer: input.pfxBuffer,
      p12Password: input.password,
    };
    const client = this.client(
      route,
      undefined,
      undefined,
      await this.routeFor(route),
    );
    try {
      const result = await this.gov(input.environment, 'adn', () =>
        client.consultarConvenio(input.municipalityCode, {
          useCache: false,
        }),
      );
      const agreement = result.parametrosConvenio;
      if (!agreement)
        return {
          municipalityCode: input.municipalityCode,
          found: false,
          ...(result.mensagem ? { message: result.mensagem } : {}),
        };
      return {
        municipalityCode: input.municipalityCode,
        found: true,
        agreementType: agreement.tipoConvenio,
        nationalEnvironment: agreement.aderenteAmbienteNacional,
        nationalIssuer: agreement.aderenteEmissorNacional,
        rfbStandardIssuance: agreement.situacaoEmissaoPadraoContribuintesRFB,
        ...(result.mensagem ? { message: result.mensagem } : {}),
      };
    } finally {
      await client.close();
    }
  }

  private result(result: NfseEmitResult | NfseQueryResult): FiscalIssueResult {
    return {
      success: true,
      accessKey: result.chaveAcesso,
      nfseNumber: Number(result.nfse.infNFSe.nNFSe),
      xmlAuthorized: result.xmlNfse,
      requiresReconciliation: false,
    };
  }
  /** Event 101101. The pending_emission slot (free once authorized) holds the signed event for replay. */
  async cancel(payload: ICancelPayload): Promise<FiscalCancelResult> {
    const store = this.store(payload);
    const client = this.client(
      payload,
      store,
      undefined,
      await this.routeFor(payload),
    );
    try {
      const [pending] = await store.list();
      if (pending?.kind === 'cancelamento_simples') {
        const [replayed] = await this.gov(payload.environment, 'sefin', () =>
          client.replayPendingEvents(store),
        );
        await this.noteReplayError(payload.environment, replayed);
        if (replayed?.status === 'success') return { status: 'cancelled' };
        if (replayed?.status === 'failed_permanent')
          return this.cancelRejection(replayed.error);
        return {
          status: 'pending',
          errorMessage:
            replayed?.status === 'still_pending'
              ? failureMessage(replayed.error)
              : 'Awaiting fiscal retry window',
        };
      }
      const result = await this.gov(payload.environment, 'sefin', () =>
        client.cancelar({
          chaveAcesso: payload.accessKey,
          autor: { CNPJ: payload.emitenteCnpj },
          cMotivo: CANCELLATION_REASON[payload.reason],
          xMotivo: payload.description,
          // The library defaults the event's tpAmb to 2: a production note's event must say 1 (E0803).
          tpAmb: this.tpAmbFor(payload.environment),
          retryStore: store,
        }),
      );
      if (result.status !== 'ok')
        await this.noteReplayError(payload.environment, result);
      return result.status === 'ok'
        ? { status: 'cancelled' }
        : { status: 'pending', errorMessage: failureMessage(result.error) };
    } catch (error) {
      if (
        error instanceof ReceitaRejectionError ||
        error instanceof ValidationError
      )
        return this.cancelRejection(error);
      throw error;
    } finally {
      await client.close();
    }
  }

  private cancelRejection(error: Error): FiscalCancelResult {
    return {
      status: 'rejected',
      errorCode:
        error instanceof ReceitaRejectionError
          ? error.codigo
          : 'INVALID_FISCAL_INPUT',
      errorMessage: error.message,
    };
  }

  /**
   * Signs the DPS WITHOUT transmitting it and returns the pending emission to
   * persist before the first POST. A `preparedDps` (RTC layout, built by the
   * DpsBuilder) goes through `emitirDpsPronta`; the legacy payload keeps the
   * `emitir` dry-run. Both reach `replayPendingEvents` through the same
   * RetryStore, so timeout/429 handling and idempotency are identical.
   */
  private async prepareEmission(
    client: NfseClient,
    payload: IIssuePayload,
  ): Promise<PendingEvent> {
    const prepared = payload.preparedDps;
    let signed: DpsDryRunResult;
    let idDps: string;
    if (prepared) {
      signed = await client.emitirDpsPronta(prepared, { dryRun: true });
      idDps = prepared.infDPS.Id;
    } else {
      signed = await client.emitir({
        ...issueParams(payload, this.sefinFor(payload.environment)),
        nDPS: String(payload.number),
        dryRun: true,
      });
      idDps = buildDpsId({
        cLocEmi: payload.emitente.codMunicipio,
        tipoInsc: 'CNPJ',
        inscricaoFederal: payload.emitente.cnpj,
        serie: payload.serie,
        nDPS: String(payload.number),
      });
    }
    if (!('dryRun' in signed) || !signed.dryRun)
      throw new Error('Expected signed DPS preview');
    const now = new Date();
    return {
      kind: 'emission',
      id: pendingEmissionId(idDps),
      idDps,
      xmlAssinado: signed.xmlDpsAssinado,
      emitenteCnpj: payload.emitente.cnpj,
      serie: payload.serie,
      nDPS: String(payload.number),
      firstAttemptAt: now,
      lastAttemptAt: now,
      lastError: {
        message: 'Prepared before fiscal submission',
        errorName: 'Prepared',
        transient: true,
      },
    };
  }
  async issue(payload: IIssuePayload): Promise<FiscalIssueResult> {
    if (!payload.invoiceId || !payload.tenantId || !payload.number)
      throw new Error('Persistent invoice/DPS identity is required');
    payload = { ...payload, issuedAt: payload.issuedAt ?? new Date() };
    const store = this.store(payload);
    const client = this.client(
      payload,
      store,
      new Date(payload.preparedDps?.infDPS.dhEmi ?? payload.issuedAt!),
      await this.routeFor(payload),
    );
    try {
      let [pending] = await store.list();
      if (pending?.kind === 'emission') {
        const { idDps } = pending;
        try {
          const status = await this.dpsStatus(
            client,
            idDps,
            payload.environment,
          );
          return this.result(
            await this.gov(payload.environment, 'sefin', () =>
              client.fetchByChave(status.chaveAcesso),
            ),
          );
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
      }
      if (!pending) {
        pending = await this.prepareEmission(client, payload);
        await store.save(pending);
      }
      const [replayed] = await this.gov(payload.environment, 'sefin', () =>
        client.replayPendingEvents(store),
      );
      await this.noteReplayError(payload.environment, replayed);
      if (replayed?.status === 'success_emission')
        return this.result(replayed.emission);
      if (replayed?.status === 'failed_permanent')
        return {
          success: false,
          requiresReconciliation: false,
          errorCode: 'FISCAL_REJECTED',
          errorMessage: explainRejection(replayed.error.message),
        };
      return {
        success: false,
        requiresReconciliation: true,
        errorMessage:
          replayed?.status === 'still_pending'
            ? failureMessage(replayed.error)
            : 'Awaiting fiscal retry window',
      };
    } catch (error) {
      if (
        error instanceof ReceitaRejectionError ||
        error instanceof ValidationError
      )
        return {
          success: false,
          requiresReconciliation: false,
          errorCode:
            error instanceof ReceitaRejectionError
              ? rejectionCode(error.codigo)
              : 'INVALID_FISCAL_INPUT',
          errorMessage: explainRejection(error.message),
        };
      throw error;
    } finally {
      await client.close();
    }
  }
  /**
   * One page of the portal's per-CNPJ feed (`fetchByNsu`), read with the company's certificate.
   * `test` reads the Produção Restrita; `live` reads production unless homologation-only is set.
   */
  async fetchPortalDocuments(
    credentials: Pick<IIssuePayload, 'pfxBuffer' | 'p12Password'>,
    environment: 'test' | 'live',
    lastNsu: number,
  ): Promise<NsuQueryResult> {
    const client = this.client(
      { ...credentials, environment },
      undefined,
      undefined,
      await this.routeFor({ ...credentials, environment }),
    );
    try {
      return await this.gov(environment, 'adn', () =>
        client.fetchByNsu({ ultimoNsu: lastNsu }),
      );
    } finally {
      await client.close();
    }
  }

  async queryByAccessKey(
    key: string,
    environment: 'test' | 'live',
    credentials?: IIssuePayload,
  ): Promise<FiscalQueryResult> {
    if (!credentials) throw new Error('Certificate credentials are required');
    const client = this.client(
      { ...credentials, environment },
      undefined,
      undefined,
      await this.routeFor({ ...credentials, environment }),
    );
    try {
      return {
        ...this.result(
          await this.gov(environment, 'sefin', () => client.fetchByChave(key)),
        ),
        status: 'authorized',
      };
    } catch (error) {
      if (error instanceof NotFoundError) return { status: 'not_found' };
      throw error;
    } finally {
      await client.close();
    }
  }
  /**
   * The DPS lookup (`GET /dps/{id}`). The Sefin of the Produção Restrita (1.6.0) refuses the id with
   * the "DPS" prefix (400 E2400 "O ID da DPS deve conter 42 números") and wants only the 42 digits,
   * while the production one may still take the prefix. The form that works is remembered per
   * environment; when the portal answers E2400 the other form is asked once. Nothing is guessed:
   * a 404 still means "no note" and any other failure is raised as before.
   */
  private async dpsStatus(
    client: NfseClient,
    idDps: string,
    environment: 'test' | 'live',
  ) {
    const sefin = this.sefinFor(environment);
    const digitsFirst = this.dpsIdWithoutPrefix.has(sefin);
    const ask = (digits: boolean) =>
      this.gov(environment, 'sefin', () =>
        digits
          ? this.fetchDpsStatusDigits(client, idDps)
          : client.fetchDpsStatus(idDps),
      );
    try {
      return await ask(digitsFirst);
    } catch (error) {
      if (!isMalformedDpsId(error)) throw error;
    }
    const status = await ask(!digitsFirst);
    if (digitsFirst) this.dpsIdWithoutPrefix.delete(sefin);
    else this.dpsIdWithoutPrefix.add(sefin);
    return status;
  }

  /** Same lookup with the 42 digits only (the lib's own client always sends the "DPS" prefix). */
  private async fetchDpsStatusDigits(client: NfseClient, idDps: string) {
    const { sefin } = await (
      client as unknown as {
        ensureState(): Promise<{ sefin: { get<T>(path: string): Promise<T> } }>;
      }
    ).ensureState();
    return fetchDpsStatus(
      {
        get: <T>(path: string) =>
          sefin.get<T>(path.replace('/dps/DPS', '/dps/')),
      } as never,
      idDps,
    );
  }

  async queryByDps(
    idDps: string,
    credentials: IIssuePayload,
  ): Promise<FiscalQueryResult> {
    const client = this.client(
      credentials,
      undefined,
      undefined,
      await this.routeFor(credentials),
    );
    try {
      const status = await this.dpsStatus(
        client,
        idDps,
        credentials.environment,
      );
      const note = await this.gov(credentials.environment, 'sefin', () =>
        client.fetchByChave(status.chaveAcesso),
      );
      this.warnOnForeignEnvironment(
        credentials.environment,
        idDps,
        status,
        note,
      );
      return { ...this.result(note), status: 'authorized' };
    } catch (error) {
      if (error instanceof NotFoundError) return { status: 'not_found' };
      throw error;
    } finally {
      await client.close();
    }
  }
  /**
   * The portal says which environment a note belongs to. When it disagrees with the one we asked
   * (endpoint), log it with both sides so the cause can be traced; the workflow also refuses the note.
   */
  private warnOnForeignEnvironment(
    environment: 'test' | 'live',
    idDps: string,
    status: { tipoAmbiente: TipoAmbiente },
    note: { tipoAmbiente: TipoAmbiente; chaveAcesso: string },
  ): void {
    const asked =
      this.ambienteFor(environment) === Ambiente.Producao
        ? TipoAmbiente.Producao
        : TipoAmbiente.Homologacao;
    if (status.tipoAmbiente === asked && note.tipoAmbiente === asked) return;
    this.logger.warn(
      {
        idDps,
        invoiceEnvironment: environment,
        askedAmbiente: this.ambienteFor(environment),
        dpsStatusTipoAmbiente: status.tipoAmbiente,
        noteTipoAmbiente: note.tipoAmbiente,
        accessKey: note.chaveAcesso,
      },
      'The portal answered with a note of another environment than the one asked',
    );
  }
  async retrievePdf(
    key: string,
    environment: 'test' | 'live',
    credentials?: IIssuePayload,
  ): Promise<Buffer> {
    const result = await this.queryByAccessKey(key, environment, credentials);
    if (!result.xmlAuthorized) throw new Error('Invoice not found');
    return renderInvoicePdf(parseNfseXml(result.xmlAuthorized), {
      ambiente: this.ambienteFor(environment),
    });
  }
}
