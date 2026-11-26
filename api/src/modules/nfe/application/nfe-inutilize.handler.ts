import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { SignedNfe } from '@/infra/external/nfe/sefaz/signed-nfe';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
import { FiscalWebhookPublisher } from '@/modules/fiscal-core/application/fiscal-webhook.publisher';
import { reconciliationDelayMs } from '@/modules/fiscal-core/domain/reconciliation-schedule';
import {
  FiscalPortalBreaker,
  PortalUnavailableError,
} from '@/modules/invoice/application/fiscal-portal-breaker';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import { OutboxService } from '@/modules/invoice/application/outbox.service';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type {
  NewOutboxMessage,
  OutboxMessage,
} from '@/modules/invoice/domain/outbox-message';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfeInutilization } from '../domain/nfe-event';
import {
  NFE_INUTILIZE,
  type NfeInutilizeMessagePayload,
} from '../domain/nfe-message-types';
import {
  TypeormNfeInutilizations,
  type InutilizationResult,
} from '../infra/typeorm-nfe-inutilizations';
import { certificateProblemOf, NfeEventContext } from './nfe-event-context';
import { inutilizeMessage } from './nfe-messages';
import { NfeSefazAccess } from './nfe-sefaz-access';

/** After this many tries without an answer the request stays `pending` and is left to support. */
export const MAX_INUTILIZATION_ATTEMPTS = 6;
const PAUSED_DELAY_MS = 60_000;

/**
 * cStat the SEFAZ answers to an inutilization it already has: 563 (a request for the same range)
 * and 206 (number already voided). The number is void either way, so a repeated send after a
 * timeout ends `homologada`, with the SEFAZ's own words. [verificar no spike]
 */
const ALREADY_VOIDED = new Set(['563', '206']);

/**
 * `nfe.inutilize`: sends the stored request. A timeout (or a paused authority) sends the SAME
 * signed request again later; the SEFAZ answers 563/206 to a repeated one and that is taken as
 * done. Approved ends `homologada` (webhook `nfe.inutilization.completed`), refused ends `rejected`
 * (`nfe.inutilization.rejected`, with the reason as the SEFAZ wrote it).
 */
@Injectable()
export class NfeInutilizeHandler implements OutboxHandler, OnModuleInit {
  readonly type = NFE_INUTILIZE;
  private readonly logger = new Logger(NfeInutilizeHandler.name);

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly gateways: FiscalDocumentRegistry,
    private readonly inutilizations: TypeormNfeInutilizations,
    private readonly context: NfeEventContext,
    private readonly access: NfeSefazAccess,
    private readonly breaker: FiscalPortalBreaker,
    private readonly webhooks: FiscalWebhookPublisher,
    private readonly outbox: OutboxService,
    private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { inutilizationId, tenantId, attempt } =
      message.payload as unknown as NfeInutilizeMessagePayload;
    await this.process(inutilizationId, tenantId, message.environment, attempt);
  }

  async process(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    attempt = 0,
  ): Promise<void> {
    this.context.assertEnvironment(environment);
    const inut = await this.inutilizations.find(id, tenantId);
    if (!inut || inut.status !== 'pending' || !inut.requestXml) return;

    const issuer = await this.context.issuer(
      inut.companyId,
      tenantId,
      environment,
    );
    let certificate;
    try {
      certificate = await this.access.certificate(
        inut.companyId,
        tenantId,
        environment,
      );
    } catch (error) {
      const problem = certificateProblemOf(error);
      return this.finish(inut, 'rejected', {
        cStat: problem.code,
        xMotivo: problem.message,
      });
    }

    const authority = this.access.breakerAuthority(issuer.uf, environment);
    try {
      await this.breaker.assertAvailable(environment, authority);
    } catch (error) {
      if (error instanceof PortalUnavailableError)
        return this.again(inut, attempt, error.retryAt);
      throw error;
    }

    const gateway = this.gateways.get<SignedNfe>('nfe');
    if (!gateway.inutilize) throw new Error('The gateway cannot inutilize');
    const outcome = await gateway.inutilize.inutilize(
      {
        uf: issuer.uf,
        year: Number(inut.createdAt.getUTCFullYear()),
        series: inut.series,
        startNumber: inut.start,
        endNumber: inut.end,
        justification: inut.justification,
        signedXml: inut.requestXml,
      },
      this.access.context(issuer.uf, environment, certificate),
    );

    switch (outcome.kind) {
      case 'ok':
        await this.breaker.recordSuccess(environment, authority);
        return this.finish(inut, 'homologada', {
          protocol: outcome.value.protocol,
          procXml: outcome.value.procXml ?? null,
          cStat: outcome.value.cStat,
          xMotivo: outcome.value.xMotivo ?? null,
        });
      case 'rejected':
      case 'denied':
        await this.breaker.recordSuccess(environment, authority);
        return this.finish(
          inut,
          ALREADY_VOIDED.has(outcome.code) ? 'homologada' : 'rejected',
          { cStat: outcome.code, xMotivo: outcome.message },
        );
      case 'uncertain':
        await this.breaker.recordFailure(environment, authority);
        return this.again(
          inut,
          attempt,
          new Date(Date.now() + reconciliationDelayMs(attempt + 1)),
        );
      case 'unavailable':
        await this.breaker.recordFailure(environment, authority);
        return this.again(
          inut,
          attempt,
          new Date(Date.now() + (outcome.retryAfterMs ?? PAUSED_DELAY_MS)),
        );
    }
  }

  /** The SAME request goes out again at `at`, up to the limit of tries. */
  private async again(
    inut: NfeInutilization,
    attempt: number,
    at: Date,
  ): Promise<void> {
    if (attempt + 1 >= MAX_INUTILIZATION_ATTEMPTS) {
      this.logger.warn(
        { inutilizationId: inut.id },
        'The SEFAZ did not answer the inutilization after the automatic tries',
      );
      return;
    }
    const message: NewOutboxMessage = inutilizeMessage(inut, attempt + 1, at);
    await runWithTenant(inut.tenantId, () =>
      this.unitOfWork.execute(() => this.outbox.enqueue(message)),
    );
  }

  private async finish(
    inut: NfeInutilization,
    to: 'homologada' | 'rejected',
    result: InutilizationResult,
  ): Promise<void> {
    const applied = await this.inutilizations.settle(
      inut.id,
      inut.tenantId,
      to,
      result,
    );
    if (!applied) return;
    await this.webhooks.publish(
      {
        type: 'nfe',
        id: inut.id,
        tenantId: inut.tenantId,
        environment: inut.environment,
        companyId: inut.companyId,
      },
      to === 'homologada'
        ? 'nfe.inutilization.completed'
        : 'nfe.inutilization.rejected',
      {
        inutilizationId: inut.id,
        status: to,
        series: inut.series,
        start: inut.start,
        end: inut.end,
        protocol: result.protocol ?? null,
        cStat: result.cStat ?? null,
        xMotivo: result.xMotivo ?? null,
      },
    );
  }
}
