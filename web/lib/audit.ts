/**
 * Account audit trail on the dashboard. The action codes mirror the API's
 * ACCOUNT_AUDIT_ACTIONS; tests/audit-messages.test.ts keeps both lists (and the
 * pt/en labels) in step.
 */
export const AUDIT_ACTIONS = [
  "company.created",
  "company.updated",
  "company.deleted",
  "certificate.uploaded",
  "certificate.replaced",
  "certificate.revoked",
  "invoice.issued",
  "invoice.cancelled",
  "invoice.substituted",
  "invoice.email_resent",
  "invoice.batch_issued",
  "invoice.review_retried",
  "invoice.review_discarded",
  "import.emitted",
  "schedule.created",
  "schedule.paused",
  "schedule.resumed",
  "schedule.cancelled",
  "billing.charge_created",
  "billing.payment_confirmed",
  "billing.plan_changed",
  "member.invited",
  "member.removed",
  "member.role_changed",
  "invitation.accepted",
  "api_key.created",
  "api_key.revoked",
  "agent.connected",
  "agent.disconnected",
  "accountant.package_sent",
  "accountant.email_changed",
  "integration.sale_resolved",
  "integration.sale_ignored",
] as const;

export type AuditActorFilter = "all" | "user" | "agent" | "api_key" | "system";

export type AuditEvent = {
  id: string;
  occurredAt: string;
  environment: "test" | "live" | null;
  actor: { type: "user" | "agent" | "api_key" | "system"; label: string; onBehalfOf: string | null };
  action: string;
  target: { type: string | null; id: string | null; label: string | null };
  metadata: Record<string, string | number | boolean | null>;
};

type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

/** What the "Item" column shows: the charge for billing events, otherwise the target's name. */
export function auditItemText(event: AuditEvent, t: Translate): string {
  if (event.action.startsWith("billing.")) {
    const { method, units } = event.metadata;
    if ((method === "pix" || method === "card") && typeof units === "number") {
      return `${t(`charge.${method}`)} · ${t("credits", { count: units })}`;
    }
  }
  return event.target.label || "—";
}
