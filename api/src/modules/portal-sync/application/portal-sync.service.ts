import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { StatusDistribuicao, type DistributedDocument } from 'open-nfse';
import { isPortalOutage } from '@/modules/invoice/application/fiscal-portal-breaker';
import { OpenNfseProvider } from '@/infra/external/nfse/open-nfse.provider';
import { NfseProviderFactory } from '@/infra/external/nfse/nfse-provider.factory';
import { ApplicationCertificateDecryptor } from '@/modules/certificate/application/certificate-decryptor';
import {
  FiscalPortalBreaker,
  PortalUnavailableError,
} from '@/modules/invoice/application/fiscal-portal-breaker';
import { CertificateNotFoundError } from '@/modules/certificate/domain/errors';
import {
  IPortalSyncRepository,
  type PortalSyncCursor,
  type StoredPortalDocument,
  type SyncTarget,
} from '../domain/portal-sync.repository';
import { PortalEventProcessor } from './portal-event.processor';

const HOUR_MS = 3_600_000;
/** Pages read for one company in one run; the rest waits for the next run. */
const MAX_PAGES_PER_RUN = 20;
/** Tries for a document that could not be processed, before it is left stored and untouched. */
const MAX_PROCESS_ATTEMPTS = 5;
const RETRY_BATCH = 100;
const MAX_FAILURE_BACKOFF_MS = 12 * HOUR_MS;

/** Hours until the next read: a company with nothing new for a while is read less often. */
function idleDelayMs(idleRuns: number): number {
  if (idleRuns >= 12) return 6 * HOUR_MS;
  if (idleRuns >= 3) return 3 * HOUR_MS;
  return HOUR_MS;
}

/** Where in the hour a company starts, so the whole base is not read in the same minute. */
function firstRunDelayMs(companyId: string): number {
  const slot = createHash('sha256').update(companyId).digest().readUInt16BE(0);
  return (slot % 55) * 60_000;
}

export interface PortalSyncResult {
  status: 'skipped' | 'scheduled' | 'synced' | 'failed';
}

/**
 * Reads the national portal's feed of one company and environment: every document is stored before
 * the cursor moves past it, then handed to the event processor. A document that fails to process
 * never holds the cursor back, and nothing here touches emission.
 */
@Injectable()
export class PortalSyncService {
  private readonly logger = new Logger(PortalSyncService.name);

  constructor(
    private readonly repository: IPortalSyncRepository,
    private readonly provider: OpenNfseProvider,
    private readonly providers: NfseProviderFactory,
    private readonly certificates: ApplicationCertificateDecryptor,
    private readonly breaker: FiscalPortalBreaker,
    private readonly processor: PortalEventProcessor,
  ) {}

  async sync(
    tenantId: string,
    target: SyncTarget,
    now: Date = new Date(),
  ): Promise<PortalSyncResult> {
    // The simulator has no portal to read.
    if (this.providers.isSimulated(target.environment))
      return { status: 'skipped' };
    const cursor = await this.repository.findCursor(tenantId, target);
    if (!cursor) {
      await this.repository.createCursor(
        tenantId,
        target,
        new Date(now.getTime() + firstRunDelayMs(target.companyId)),
      );
      return { status: 'scheduled' };
    }
    if (cursor.nextRunAt > now) return { status: 'skipped' };

    try {
      await this.breaker.assertAvailable(target.environment);
    } catch (error: unknown) {
      if (error instanceof PortalUnavailableError) return { status: 'skipped' };
      throw error;
    }
    try {
      let credentials: { pfxBuffer: Buffer; password: string };
      try {
        credentials = await this.certificates.decryptCredentials(
          target.companyId,
          tenantId,
          target.environment,
        );
      } catch (error: unknown) {
        // No certificate that can sign (removed or expired since the list was made): not an error.
        if (
          error instanceof CertificateNotFoundError ||
          (error instanceof Error && error.message === 'Certificate expired')
        )
          return { status: 'skipped' };
        throw error;
      }
      const attempted = new Set<string>();
      await this.processPending(tenantId, target, cursor, attempted);
      const caughtUp = await this.readNewDocuments(
        tenantId,
        target,
        cursor,
        credentials,
        attempted,
      );
      await this.breaker.recordSuccess(target.environment);
      await this.finishRun(tenantId, target, cursor, caughtUp, now);
      return { status: 'synced' };
    } catch (error: unknown) {
      await this.failRun(tenantId, target, cursor, error, now);
      return { status: 'failed' };
    }
  }

  /** Reads pages until the portal has nothing newer (true) or the run's page budget ends (false). */
  private async readNewDocuments(
    tenantId: string,
    target: SyncTarget,
    cursor: PortalSyncCursor,
    credentials: { pfxBuffer: Buffer; password: string },
    attempted: Set<string>,
  ): Promise<boolean> {
    let lastNsu = cursor.lastNsu;
    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const result = await this.provider.fetchPortalDocuments(
        { pfxBuffer: credentials.pfxBuffer, p12Password: credentials.password },
        target.environment,
        lastNsu,
      );
      if (result.status === StatusDistribuicao.Rejeicao)
        throw new Error(
          `Portal rejected the read: ${result.erros.map((e) => `${e.codigo} ${e.descricao}`).join('; ') || 'no detail'}`,
        );
      const documents = result.documentos
        .filter((document) => document.nsu > 0)
        .sort((a, b) => a.nsu - b.nsu);
      // Stored first: if this throws, the cursor stays and the next run reads the page again.
      for (const document of documents)
        await this.repository.saveDocument(
          tenantId,
          target,
          toNewDocument(document),
        );
      const advanced = result.ultimoNsu > lastNsu;
      if (advanced) {
        lastNsu = result.ultimoNsu;
        await this.repository.updateCursor(tenantId, target, { lastNsu });
      }
      await this.processPending(tenantId, target, cursor, attempted);
      if (result.status === StatusDistribuicao.NenhumDocumento || !advanced)
        return true;
    }
    return false;
  }

  /** Handles stored documents that were not processed yet, oldest first; failures stay for later. */
  private async processPending(
    tenantId: string,
    target: SyncTarget,
    cursor: Pick<PortalSyncCursor, 'firstRoundDoneAt'>,
    attempted: Set<string>,
  ): Promise<void> {
    for (;;) {
      // A document gets one try per run, however many pages the run reads.
      const pending = (
        await this.repository.listUnprocessed(
          tenantId,
          target,
          MAX_PROCESS_ATTEMPTS,
          RETRY_BATCH,
        )
      ).filter((document) => !attempted.has(document.id));
      if (pending.length === 0) return;
      for (const document of pending) {
        attempted.add(document.id);
        await this.processOne(tenantId, target, cursor, document);
      }
    }
  }

  private async processOne(
    tenantId: string,
    target: SyncTarget,
    cursor: Pick<PortalSyncCursor, 'firstRoundDoneAt'>,
    document: StoredPortalDocument,
  ): Promise<void> {
    try {
      await this.processor.process(document, {
        tenantId,
        companyId: target.companyId,
        environment: target.environment,
        silent: isBeforeFirstRound(document, cursor),
      });
      await this.repository.markProcessed(tenantId, document.id);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        { companyId: target.companyId, nsu: document.nsu, err: message },
        'Portal document not processed',
      );
      await this.repository.markFailed(tenantId, document.id, message);
    }
  }

  private async finishRun(
    tenantId: string,
    target: SyncTarget,
    cursor: PortalSyncCursor,
    caughtUp: boolean,
    now: Date,
  ): Promise<void> {
    const latest =
      (await this.repository.findCursor(tenantId, target)) ?? cursor;
    const idleRuns =
      latest.lastNsu === cursor.lastNsu ? cursor.idleRuns + 1 : 0;
    await this.repository.updateCursor(tenantId, target, {
      lastRunAt: now,
      // More to read: come back on the next tick instead of waiting an hour.
      nextRunAt: caughtUp
        ? new Date(now.getTime() + idleDelayMs(idleRuns))
        : now,
      idleRuns,
      failures: 0,
      lastError: null,
      ...(caughtUp && !cursor.firstRoundDoneAt
        ? { firstRoundDoneAt: now }
        : {}),
    });
  }

  private async failRun(
    tenantId: string,
    target: SyncTarget,
    cursor: PortalSyncCursor,
    error: unknown,
    now: Date,
  ): Promise<void> {
    if (isPortalOutage(error))
      await this.breaker.recordFailure(target.environment);
    const failures = cursor.failures + 1;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      { companyId: target.companyId, failures, err: message },
      'Portal read failed',
    );
    await this.repository.updateCursor(tenantId, target, {
      lastRunAt: now,
      failures,
      lastError: message.slice(0, 500),
      nextRunAt: new Date(
        now.getTime() +
          Math.min(HOUR_MS * 2 ** (failures - 1), MAX_FAILURE_BACKOFF_MS),
      ),
    });
  }
}

function toNewDocument(document: DistributedDocument) {
  return {
    nsu: document.nsu,
    accessKey: document.chaveAcesso,
    documentType: document.tipoDocumento,
    eventType: document.tipoEvento,
    xml: document.xmlDocumento,
    generatedAt: document.dataHoraGeracao,
  };
}

/** Before the first complete read ended, or generated no later than it: history, not news. */
function isBeforeFirstRound(
  document: Pick<StoredPortalDocument, 'generatedAt'>,
  cursor: Pick<PortalSyncCursor, 'firstRoundDoneAt'>,
): boolean {
  return (
    cursor.firstRoundDoneAt === null ||
    document.generatedAt <= cursor.firstRoundDoneAt
  );
}
