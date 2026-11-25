import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  captureRuntimeException,
  type SentryRuntime,
} from '@/infra/observability/sentry-reporter';
import {
  AccountAuditRecorder,
  SYSTEM_ACTOR,
  type AccountAuditInput,
} from '../domain/account-audit';
import { sanitizeAuditMetadata } from '../domain/sanitize-audit-metadata';
import {
  AuditActorLabeler,
  IAccountAuditRepository,
} from '../domain/account-audit.repository';
import { currentAuditActor } from './audit-actor.context';

export const ACCOUNT_AUDIT_RUNTIME = Symbol('ACCOUNT_AUDIT_RUNTIME');
const MAX_LABEL = 200;

@Injectable()
export class AccountAuditService extends AccountAuditRecorder {
  private readonly logger = new Logger(AccountAuditService.name);

  constructor(
    private readonly repository: IAccountAuditRepository,
    private readonly labels: AuditActorLabeler,
    @Inject(ACCOUNT_AUDIT_RUNTIME) private readonly runtime: SentryRuntime,
  ) {
    super();
  }

  /** Never throws. Call it after the action's own write, outside its transaction. */
  async record(input: AccountAuditInput): Promise<void> {
    try {
      const actor = input.actor ?? currentAuditActor() ?? SYSTEM_ACTOR;
      const resolved = await this.labels.resolve(actor, input.tenantId);
      await this.repository.insert({
        tenantId: input.tenantId,
        environment: input.environment ?? null,
        action: input.action,
        actorType: actor.type,
        actorId: actor.id,
        actorLabel: resolved.label.slice(0, MAX_LABEL),
        actorOnBehalfOfLabel: resolved.onBehalfOf?.slice(0, MAX_LABEL) ?? null,
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        targetLabel: input.target?.label?.slice(0, MAX_LABEL) ?? null,
        metadata: sanitizeAuditMetadata(input.metadata),
        ipHash: actor.ipHash ?? null,
      });
    } catch (error) {
      // Never log the input: it may carry business data. Name only.
      this.logger.error(
        `Failed to record audit event ${input.action}: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      captureRuntimeException(error, this.runtime, 'account-audit.record');
    }
  }
}
