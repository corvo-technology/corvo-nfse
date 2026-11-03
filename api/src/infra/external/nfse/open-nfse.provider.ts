import {
  resolveDpsLayout,
  XML_LAYOUT,
  type ConfiguredDpsLayout,
  type DpsLayoutPolicy,
} from '@/modules/invoice/domain/fiscal/dps/dps-layout';
import { Injectable, Logger } from '@nestjs/common';
import { renderInvoicePdf } from '@/modules/invoice/infra/danfse/danfse';
import { ConfigService } from '@nestjs/config';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  NfseClient,
  Ambiente,
  buildDpsId,
  pendingEmissionId,
  ReceitaRejectionError,
  ValidationError,
  NotFoundError,
  JustificativaCancelamento,
  parseNfseXml,
  type PendingEvent,
  type RetryStore,
  type NfseEmitResult,
  type DpsDryRunResult,
  type NfseQueryResult,
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
import { explainRejection } from './rejection-guidance';

const CANCELLATION_REASON: Record<
  FiscalCancellationReason,
  JustificativaCancelamento
> = {
  issue_error: JustificativaCancelamento.ErroEmissao,
  service_not_provided: JustificativaCancelamento.ServicoNaoPrestado,
  other: JustificativaCancelamento.Outros,
};

@Injectable()
export class OpenNfseProvider implements FiscalProvider {
  private readonly logger = new Logger(OpenNfseProvider.name);
  private readonly sefin: SefinEnvironment;
  private readonly configuredLayout: ConfiguredDpsLayout;
  private readonly layoutPolicy: DpsLayoutPolicy;

  constructor(
    @InjectDataSource() private readonly database: DataSource,
    config: ConfigService,
  ) {
    this.sefin =
      config.get<SefinEnvironment>('NFSE_SEFIN_ENVIRONMENT') === 'restricted'
        ? 'restricted'
        : 'production';
    this.configuredLayout =
      config.get<ConfiguredDpsLayout>('rtc.dpsLayout') ??
      config.get<ConfiguredDpsLayout>('FISCAL_DPS_LAYOUT') ??
      'rtc-v1.01';
    this.layoutPolicy = {
      cutoverAt:
        config.get<string>('rtc.nt009CutoverAt') ??
        config.get<string>('FISCAL_NT009_CUTOVER_AT'),
      productionEnabled:
        config.get<boolean>('rtc.nt009ProductionEnabled') ??
        String(config.get('FISCAL_NT009_PRODUCTION_ENABLED')) === 'true',
    };
    if (this.configuredLayout === 'nt009-r1' && this.sefin !== 'restricted') {
      throw new Error(
        'FISCAL_DPS_LAYOUT=nt009-r1 requires NFSE_SEFIN_ENVIRONMENT=restricted',
      );
    }
    if (this.sefin === 'restricted') {
      this.logger.warn(
        'NFSE_SEFIN_ENVIRONMENT=restricted: live invoices go to the Sefin Produção Restrita (homologation), not to production.',
      );
    }
  }

  private get ambiente(): Ambiente {
    return this.sefin === 'restricted'
      ? Ambiente.ProducaoRestrita
      : Ambiente.Producao;
  }

  private store(
    payload: Pick<IIssuePayload, 'invoiceId' | 'tenantId'>,
  ): RetryStore {
    const tenantId = payload.tenantId!;
    requireTenantId(tenantId);
    const repo = this.database.getRepository(InvoiceOrmEntity);
    const identity = {
      id: payload.invoiceId!,
      tenantId: payload.tenantId!,
      environment: 'live',
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
  private client(
    payload: Pick<IIssuePayload, 'environment' | 'pfxBuffer' | 'p12Password'>,
    retryStore?: RetryStore,
    at: Date = new Date(),
  ): NfseClient {
    if (payload.environment !== 'live')
      throw new Error('Real fiscal provider requires live');
    return new NfseClient({
      ambiente: this.ambiente,
      certificado: { pfx: payload.pfxBuffer, password: payload.p12Password },
      retryStore,
      dpsLayout:
        XML_LAYOUT[
          resolveDpsLayout({
            ...this.layoutPolicy,
            configured: this.configuredLayout,
            sefinEnvironment: this.sefin,
            at,
          })
        ],
    });
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
    const client = this.client(payload, store);
    try {
      const [pending] = await store.list();
      if (pending?.kind === 'cancelamento_simples') {
        const [replayed] = await client.replayPendingEvents(store);
        if (replayed?.status === 'success') return { status: 'cancelled' };
        if (replayed?.status === 'failed_permanent')
          return this.cancelRejection(replayed.error);
        return {
          status: 'pending',
          errorMessage:
            replayed?.status === 'still_pending'
              ? replayed.error.message
              : 'Awaiting fiscal retry window',
        };
      }
      const result = await client.cancelar({
        chaveAcesso: payload.accessKey,
        autor: { CNPJ: payload.emitenteCnpj },
        cMotivo: CANCELLATION_REASON[payload.reason],
        xMotivo: payload.description,
        retryStore: store,
      });
      return result.status === 'ok'
        ? { status: 'cancelled' }
        : { status: 'pending', errorMessage: result.error.message };
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
        ...issueParams(payload, this.sefin),
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
    );
    try {
      let [pending] = await store.list();
      if (pending?.kind === 'emission') {
        try {
          const status = await client.fetchDpsStatus(pending.idDps);
          return this.result(await client.fetchByChave(status.chaveAcesso));
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
      }
      if (!pending) {
        pending = await this.prepareEmission(client, payload);
        await store.save(pending);
      }
      const [replayed] = await client.replayPendingEvents(store);
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
            ? replayed.error.message
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
              ? error.codigo
              : 'INVALID_FISCAL_INPUT',
          errorMessage: explainRejection(error.message),
        };
      throw error;
    } finally {
      await client.close();
    }
  }
  async queryByAccessKey(
    key: string,
    _environment: 'test' | 'live',
    credentials?: IIssuePayload,
  ): Promise<FiscalQueryResult> {
    if (!credentials) throw new Error('Certificate credentials are required');
    const client = this.client(credentials);
    try {
      return {
        ...this.result(await client.fetchByChave(key)),
        status: 'authorized',
      };
    } catch (error) {
      if (error instanceof NotFoundError) return { status: 'not_found' };
      throw error;
    } finally {
      await client.close();
    }
  }
  async retrievePdf(
    key: string,
    environment: 'test' | 'live',
    credentials?: IIssuePayload,
  ): Promise<Buffer> {
    const result = await this.queryByAccessKey(key, environment, credentials);
    if (!result.xmlAuthorized) throw new Error('Invoice not found');
    return renderInvoicePdf(parseNfseXml(result.xmlAuthorized), {
      ambiente: this.ambiente,
    });
  }
}
