import { AccountAuditService } from '../application/account-audit.service';

/**
 * The real recorder over a repository whose insert always fails: proves that a
 * service keeps its action when the audit trail cannot be written.
 * Spy on `captureRuntimeException` in the spec to keep Sentry quiet.
 */
export function failingAccountAudit(): AccountAuditService {
  return new AccountAuditService(
    {
      insert: jest.fn().mockRejectedValue(new Error('insert failed')),
    } as never,
    { resolve: jest.fn().mockResolvedValue({ label: 'x', onBehalfOf: null }) },
    'api',
  );
}
