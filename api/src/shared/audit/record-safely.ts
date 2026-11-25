import type {
  AccountAuditInput,
  AccountAuditRecorder,
} from '@/modules/account-audit/domain/account-audit';

/** Records an audit event; whatever happens, the audited action carries on. */
export async function recordSafely(
  audit: AccountAuditRecorder,
  input: AccountAuditInput,
): Promise<void> {
  try {
    await audit.record(input);
  } catch {
    // Auditing must never break the action it describes.
  }
}
