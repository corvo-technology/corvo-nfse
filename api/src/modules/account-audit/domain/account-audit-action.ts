/**
 * Stable action codes of the account audit trail. The list is frozen once the
 * audit foundation ships: every later task records only codes from here.
 */
export const ACCOUNT_AUDIT_ACTIONS = [
  'company.created',
  'company.updated',
  'company.deleted',
  'certificate.uploaded',
  'certificate.replaced',
  'certificate.revoked',
  'invoice.issued',
  'invoice.cancelled',
  'invoice.substituted',
  'invoice.email_resent',
  'invoice.batch_issued',
  'invoice.review_retried',
  'invoice.review_discarded',
  'import.emitted',
  'schedule.created',
  'schedule.paused',
  'schedule.resumed',
  'schedule.cancelled',
  'billing.charge_created',
  'billing.payment_confirmed',
  'billing.plan_changed',
  'member.invited',
  'member.removed',
  'member.role_changed',
  'invitation.accepted',
  'api_key.created',
  'api_key.revoked',
  'agent.connected',
  'agent.disconnected',
  'accountant.package_sent',
  'accountant.email_changed',
] as const;

export type AccountAuditAction = (typeof ACCOUNT_AUDIT_ACTIONS)[number];
