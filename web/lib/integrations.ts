import { integrations as defaultApi, type IntegrationConnection, type IntegrationSale } from "@/lib/api";

type Tone = "accent" | "warn" | "danger" | "gray";

export function connectionStatus(connection: Pick<IntegrationConnection, "state">): { key: "active" | "paused" | "reconnect" | "draft" | "disconnected"; tone: Tone } {
  switch (connection.state) {
    case "active": return { key: "active", tone: "accent" };
    case "paused": return { key: "paused", tone: "warn" };
    case "reauth_required": return { key: "reconnect", tone: "danger" };
    case "draft": return { key: "draft", tone: "gray" };
    default: return { key: "disconnected", tone: "gray" };
  }
}

export interface SaleStatus {
  key: "issued" | "cancelRequested" | "cancelFailed" | "refundedAfterInvoice" | "waitingCustomer" | "needsAttention" | "notIssuedRefund" | "blocked" | "processing" | "ignored";
  tone: Tone;
  /** The client can supply the missing CPF/CNPJ. */
  canFixCustomer: boolean;
  /** The sale waits for the client: the sale page lets them complete the data and issue. */
  canResolve: boolean;
  /** Trying again can help (the cause was fixed outside the sale). */
  canRetry: boolean;
}

const status = (key: SaleStatus["key"], tone: Tone, flags: Partial<Pick<SaleStatus, "canFixCustomer" | "canRetry" | "canResolve">> = {}): SaleStatus => ({ key, tone, canFixCustomer: false, canRetry: false, canResolve: false, ...flags });

export function saleStatus(sale: Pick<IntegrationSale, "fiscalStatus" | "blockReason" | "commercialState" | "invoiceId">): SaleStatus {
  if (sale.invoiceId && sale.blockReason === "cancel_requested") return status("cancelRequested", "warn");
  if (sale.invoiceId && sale.blockReason === "cancel_failed") return status("cancelFailed", "danger", { canRetry: true });
  if (sale.invoiceId) return sale.blockReason === "refund_after_invoice" ? status("refundedAfterInvoice", "warn") : status("issued", "accent");
  if (sale.fiscalStatus === "needs_attention")
    return sale.blockReason === "customer_tax_id_missing" ? status("waitingCustomer", "warn", { canFixCustomer: true, canResolve: true, canRetry: true }) : status("needsAttention", "danger", { canRetry: true, canResolve: true });
  if (sale.fiscalStatus === "blocked") {
    if (sale.blockReason === "ignored_by_user") return status("ignored", "gray");
    if (sale.commercialState === "refunded" || sale.commercialState === "disputed") return status("notIssuedRefund", "gray");
    return status("blocked", "gray", { canRetry: sale.blockReason === "connection_inactive" });
  }
  return status("processing", "gray");
}

/** Sales that wait for the client to do something. */
export const pendingCount = (sales: IntegrationSale[]): number => sales.filter((sale) => saleStatus(sale).key === "waitingCustomer" || saleStatus(sale).key === "needsAttention" || saleStatus(sale).key === "cancelFailed").length;

export type ConnectStep = "create" | "validate" | "rules" | "activate";
export class ConnectError extends Error {
  constructor(message: string, readonly step: ConnectStep, /** The error the API (or the network) raised, for the screen to translate. */ readonly original?: unknown) { super(message); }
}

export interface ConnectInput { provider: string; companyId: string; environment: "test" | "live"; credentials: Record<string, string>; sendEmail: boolean;
  /** The platform issues a secret only after our address is registered: leave the connection ready but not active, the client activates it after pasting the secret. */
  awaitSecret?: boolean }
type ConnectApi = Pick<typeof defaultApi, "create" | "validate" | "putRules" | "activate" | "disconnect">;

/**
 * Creates, checks, configures and turns on a connection in one go. If anything
 * after the creation fails the new connection is closed, so a failed attempt
 * leaves nothing half-configured behind.
 */
export async function connectProvider(input: ConnectInput, api: ConnectApi = defaultApi): Promise<{ connection: IntegrationConnection; webhookUrl: string; secrets: Record<string, string> }> {
  let created: IntegrationConnection;
  try {
    created = await api.create({ provider: input.provider, companyId: input.companyId, environment: input.environment, credentials: input.credentials, activeFrom: new Date().toISOString() });
  } catch (error) {
    throw new ConnectError(messageOf(error), "create", error);
  }
  let step: ConnectStep = "validate";
  try {
    await api.validate(created.id);
    step = "rules";
    // No fixed description: each invoice describes what that sale was, using what the platform sent.
    await api.putRules(created.id, [{ service: {}, sendEmail: input.sendEmail }]);
    // Waiting for the secret: the connection stays a draft, with the address already usable.
    if (input.awaitSecret) return { connection: created, webhookUrl: created.webhookUrl, secrets: created.secrets ?? {} };
    step = "activate";
    const active = await api.activate(created.id);
    // The create response is the only one that carries secrets that belong in the URL.
    return { connection: active, webhookUrl: created.webhookUrl, secrets: created.secrets ?? {} };
  } catch (error) {
    await api.disconnect(created.id).catch(() => undefined);
    throw new ConnectError(messageOf(error), step, error);
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Every reason the API can give for a sale that was not issued; each has a title and what to do in the messages. */
export const BLOCK_REASONS = [
  "connection_inactive", "before_active_from", "refunded", "disputed", "not_paid", "unsupported_currency", "invalid_amount", "seller_not_issuer", "no_rule", "ambiguous_rule",
  "customer_tax_id_missing", "refund_after_invoice", "cancel_requested", "cancel_failed", "quota_exceeded", "company_not_ready", "invoice_rejected", "ignored_by_user",
] as const;
export type BlockReasonCode = (typeof BLOCK_REASONS)[number];
export const isBlockReason = (value: string | null | undefined): value is BlockReasonCode => BLOCK_REASONS.includes(value as BlockReasonCode);

/** Known technical messages (from the platform or the invoice rules) and the text key that explains them. */
const KNOWN_ERRORS: Array<[RegExp, string]> = [
  [/customer\.email.*required/i, "emailRequired"],
  [/has no correlationID/i, "noCorrelationId"],
  [/refund names no/i, "refundNoOriginal"],
  [/not an integer number of cents/i, "badAmount"],
  [/not an object/i, "notReadable"],
  [/^refund_sale_not_found$/, "refundNotFound"],
];

/**
 * What to show for an error text: a block reason code, a known technical message (its key under
 * `Integrations.errors`) or an unknown one (shown as is, under a generic explanation).
 */
export function explainError(raw: string | null | undefined): { kind: "reason"; code: BlockReasonCode } | { kind: "known"; key: string } | { kind: "unknown"; raw: string } | null {
  if (!raw) return null;
  if (isBlockReason(raw)) return { kind: "reason", code: raw };
  const known = KNOWN_ERRORS.find(([pattern]) => pattern.test(raw));
  return known ? { kind: "known", key: known[1] } : { kind: "unknown", raw };
}
