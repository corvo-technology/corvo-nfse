import { AuthAuditEvent } from './auth-audit-event';

export abstract class IAuthAuditEventRepository {
  abstract save(event: AuthAuditEvent): Promise<AuthAuditEvent>;
}
