import { idPath, query, request, toPage, unwrap, type Page, type PageParams } from "./api";

type Envelope<T> = { data: T };
type ListBody<T> = { data: T[]; pagination?: { limit?: number; hasMore?: boolean; nextCursor?: string | null } };

/** Types mirror api/src/modules/platform-admin/platform-admin.contract.ts (HTTP contract). */
export interface PlatformWindow { authorized: number; rejected: number; rejectionRate: number | null }
export interface PlatformWindows { today: PlatformWindow; d7: PlatformWindow; d30: PlatformWindow }
export interface PlatformRevenue { subscriptionCents: number; avulsoCents: number; totalCents: number }
export interface PlatformOverview {
  users: { total: number; new7d: number; new30d: number };
  invoices: { live: PlatformWindows; test: PlatformWindows };
  revenue: { d7: PlatformRevenue; d30: PlatformRevenue; stripeRecordedSince: string | null };
  adminGrants: { units7d: number; units30d: number };
}
export interface PlatformUserRow {
  id: string; email: string; name: string;
  /** Workspace the row's plan and balance come from; null when the user has none. */
  tenantId: string | null;
  createdAt: string; planSlug: string | null;
  liveInvoicesThisMonth: number; avulsoBalance: number; companiesCount: number; lastActivityAt: string | null;
}
export interface PlatformWorkspace {
  tenantId: string; role: string; isOwn: boolean; plan: { slug: string; name: string } | null;
  usage: { included: number; authorized: number; reserved: number; periodEnd: string } | null;
  avulsoBalance: number;
  /** When NF-e was released for this workspace; null while it is off. */
  nfeEnabledAt: string | null;
  /** When NFC-e was released for this workspace; null while it is off. */
  nfceEnabledAt?: string | null;
  companies: { id: string; taxId: string; legalName: string; municipalityCode: string; environment: string; certificateValidUntil: string | null }[];
  recentInvoices: { id: string; status: string; amount: number; environment: string; lastErrorCode: string | null; createdAt: string }[];
  credits: { id: string; type: string; source: string | null; amount: number; description: string | null; createdAt: string }[];
  payments: { id: string; kind: string; provider: string; amountCents: number; status: string; paidAt: string | null }[];
  apiKeys: { id: string; name: string; keyPrefix: string; environment: string; lastUsedAt: string | null }[];
  mcpConnections: { id: string; clientName: string; lastUsedAt: string | null }[];
}
export interface PlatformUserDetail {
  user: { id: string; email: string; name: string; emailVerifiedAt: string | null; createdAt: string; lastLoginAt: string | null };
  workspaces: PlatformWorkspace[];
}
export interface PlatformAttention {
  staleInvoices: { invoiceId: string; tenantId: string; userId: string; status: string; updatedAt: string }[];
  expiringCertificates: { companyId: string; tenantId: string; userId: string; taxId: string; validUntil: string }[];
  failingWebhooks: { tenantId: string; userId: string; failedCount24h: number; lastFailureAt: string }[];
  failedPayments: { tenantId: string; userId: string; source: "intent" | "subscription"; status: string; at: string }[];
}
export interface PlatformAuditEvent {
  id: string; actorEmail: string; action: "credit_grant" | "user_viewed" | "nfe_access_changed" | "nfce_access_set" | "svc_forced_exit"; targetTenantId: string | null; targetUserId: string | null;
  reason: string | null; payload: Record<string, unknown>; success: boolean; createdAt: string;
}
/** A UF whose NF-e goes through the SVC right now. Mirrors `PlatformSvcState` of the API contract. */
export interface PlatformSvcState { uf: string; tpAmb: 1 | 2; authority: "SVCAN" | "SVCRS"; enteredAt: string | null; dhCont: string | null }
export interface NfeAccessResult { tenantId: string; enabled: boolean; enabledAt: string | null }
export interface CreditGrantResult { tenantId: string; amount: number; balance: number; replayed: boolean }
export interface CreditGrantBody { amount: number; reason: string; notifyUser: boolean }

export const platformAdmin = {
  overview: async (signal?: AbortSignal) => unwrap(await request<Envelope<PlatformOverview>>("/platform/overview", { signal })),
  users: async (params: PageParams & { search?: string } = {}, signal?: AbortSignal): Promise<Page<PlatformUserRow>> =>
    toPage(await request<ListBody<PlatformUserRow>>(`/platform/users${query(params)}`, { signal })),
  user: async (id: string, signal?: AbortSignal) => unwrap(await request<Envelope<PlatformUserDetail>>(`/platform/users/${idPath(id)}`, { signal })),
  attention: async (signal?: AbortSignal) => unwrap(await request<Envelope<PlatformAttention>>("/platform/attention", { signal })),
  audit: async (params: PageParams = {}, signal?: AbortSignal): Promise<Page<PlatformAuditEvent>> =>
    toPage(await request<ListBody<PlatformAuditEvent>>(`/platform/audit${query(params)}`, { signal })),
  grantCredits: async (tenantId: string, body: CreditGrantBody, idempotencyKey: string) =>
    unwrap(await request<Envelope<CreditGrantResult>>(`/platform/tenants/${idPath(tenantId)}/credit-grants`, {
      method: "POST", body: JSON.stringify(body), headers: { "idempotency-key": idempotencyKey },
    })),
  /** Turns NF-e on or off for a workspace. Safe to repeat: the result is the same state. */
  setNfeAccess: async (tenantId: string, body: { enabled: boolean; reason: string }) =>
    unwrap(await request<Envelope<NfeAccessResult>>(`/platform/tenants/${idPath(tenantId)}/nfe-access`, { method: "PUT", body: JSON.stringify(body) })),
  /** The UFs whose NF-e is in the SVC (contingency) right now. */
  svcStates: async (signal?: AbortSignal) => unwrap(await request<Envelope<PlatformSvcState[]>>("/platform/contingency", { signal })),
  /** Takes one UF out of the SVC by hand. The reason is kept in the audit trail. */
  exitSvc: async (uf: string, tpAmb: 1 | 2, body: { reason: string }) =>
    unwrap(await request<Envelope<{ uf: string; tpAmb: 1 | 2; mode: "none" }>>(`/platform/contingency/${idPath(uf)}/${tpAmb}/exit`, { method: "POST", body: JSON.stringify(body) })),
  /** Turns NFC-e on or off for a workspace. */
  setNfceAccess: async (tenantId: string, body: { enabled: boolean; reason: string }) =>
    unwrap(await request<Envelope<NfeAccessResult>>(`/platform/tenants/${idPath(tenantId)}/nfce-access`, { method: "PUT", body: JSON.stringify(body) })),
};

/** Currency from integer cents, in the user's locale. */
export function formatBrl(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale === "pt" ? "pt-BR" : locale, { style: "currency", currency: "BRL" }).format(cents / 100);
}
