import { SensitiveAuthAuditEvent } from './sensitive-auth-audit';

export abstract class ISensitiveAuthAuditRepository {
  abstract save(
    event: SensitiveAuthAuditEvent,
  ): Promise<SensitiveAuthAuditEvent>;
}
