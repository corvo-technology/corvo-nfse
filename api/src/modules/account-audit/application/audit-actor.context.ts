import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditActorRef } from '../domain/account-audit';

const storage = new AsyncLocalStorage<AuditActorRef>();

export function runWithAuditActor<T>(actor: AuditActorRef, work: () => T): T {
  return storage.run(actor, work);
}

export function currentAuditActor(): AuditActorRef | undefined {
  return storage.getStore();
}
