import {
  SYSTEM_ACTOR,
  AccountAuditRecorder,
  type AccountAuditInput,
  type AuditActorRef,
  type AuditMetadata,
} from '../domain/account-audit';
import { sanitizeAuditMetadata } from '../domain/sanitize-audit-metadata';
import { currentAuditActor } from '../application/audit-actor.context';

/** In-memory recorder for unit tests of the services that audit their actions. */
export class FakeAccountAudit extends AccountAuditRecorder {
  readonly events: Array<
    AccountAuditInput & { actor: AuditActorRef; metadata: AuditMetadata }
  > = [];

  record(input: AccountAuditInput): Promise<void> {
    this.events.push({
      ...input,
      actor: input.actor ?? currentAuditActor() ?? SYSTEM_ACTOR,
      metadata: sanitizeAuditMetadata(input.metadata),
    });
    return Promise.resolve();
  }
}
