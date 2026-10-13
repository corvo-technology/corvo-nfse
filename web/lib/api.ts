import type { ApiKey, ApiKeyCreated, CreditBalance, CreditTransaction, PlanSlug, Company, Certificate, Invoice, InvoiceStatus, InvoiceEvent, BillingPlan, BillingUsage, CompanyFormInput, UpdateCompanyInput, CreateInvoiceInput, PlanQuote, WebhookEndpoint, WebhookDelivery, WebhookDeliveriesQuery, WebhookEvent, DeliveryStats } from "./types";
export type { ApiKey, ApiKeyCreated, WebhookEndpoint, WebhookDelivery, WebhookEvent, DeliveryStats } from "./types";

// Dashboard credentials are always the browser's HttpOnly cookie.
const configuredBase = process.env.NEXT_PUBLIC_API_URL ?? "/api/proxy/v1";
const BASE = configuredBase.replace(/\/$/, "").replace(/(?:\/v1)?$/, "/v1");
type Envelope<T> = { data: T };
type ListBody<T> = { data: T[]; pagination?: { limit?: number; hasMore?: boolean; nextCursor?: string | null } };
export interface PageParams { limit?: number; cursor?: string }
export interface Page<T> { items: T[]; hasMore: boolean; nextCursor: string | null }
export interface ApiErrorDetail { field: string; code: string; message: string }
export function unwrap<T>(body: { data: T } | null): T {
  if (body && typeof body === "object" && "data" in body && (body as { data?: T }).data !== undefined) return (body as { data: T }).data;
  throw new ApiError(502, "Invalid response payload.");
}
/** Follows nextCursor until exhausted; for small collections (keys, members, endpoints). */
export async function collectAll<T>(fetchPage: (cursor?: string) => Promise<Page<T>>, maxPages = 20): Promise<T[]> {
  const items: T[] = []; let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) { const page = await fetchPage(cursor); items.push(...page.items); if (!page.hasMore || !page.nextCursor) break; cursor = page.nextCursor; }
  return items;
}
export function toPage<T>(body: { data: T[]; pagination?: { limit?: number; hasMore?: boolean; nextCursor?: string | null } } | null): Page<T> {
  const items = Array.isArray(body?.data) ? body.data : [];
  const pagination = body?.pagination;
  return { items, hasMore: pagination?.hasMore === true && typeof pagination?.nextCursor === "string", nextCursor: typeof pagination?.nextCursor === "string" ? pagination.nextCursor : null };
}
export interface AvailableTenant { tenantId: string; membershipId: string; role: string; establishmentName: string }
export interface AuthContext { authUserId: string; activeTenantId: string; role: string; permissions: string[]; availableTenants: AvailableTenant[] }
export interface SessionPayload { status: "authenticated"; context: AuthContext; activeTenantId: string; availableTenants: AvailableTenant[]; permissions: string[]; expiresAt: string; csrfToken: string }
export interface MagicLinkChallenge { challengeId: string; expiresAt: string; resendAvailableAt: string }
export interface MagicLinkVerified { expiresAt: string; isNewUser: boolean; csrfToken: string }

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public retryAfterSeconds?: number, public details?: ApiErrorDetail[], public requestId?: string) { super(message); this.name = "ApiError"; }
}
export type FiscalEnvironment = "test" | "live";
const FISCAL_ENV_KEY = "corvo_fiscal_environment";
export function getFiscalEnvironment(): FiscalEnvironment {
  if (typeof window === "undefined") return "test";
  return (localStorage.getItem(FISCAL_ENV_KEY) as FiscalEnvironment) ?? "test";
}
export function setFiscalEnvironment(env: FiscalEnvironment): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(FISCAL_ENV_KEY, env);
  // Notify other tabs
  try { window.dispatchEvent(new StorageEvent("storage", { key: FISCAL_ENV_KEY, newValue: env })); } catch {}
}
let csrfToken: string | null = null;
let csrfGeneration = 0;
let csrfRefresh: Promise<void> | null = null;
const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(listener: () => void) { unauthorizedListeners.add(listener); return () => { unauthorizedListeners.delete(listener); }; }
export function setCsrfToken(token: string | null) { csrfToken = token || null; csrfGeneration++; csrfRefresh = null; }
export function getCsrfToken() { return csrfToken; }
const publicMutations = new Set(["/auth/magic-link/request", "/auth/magic-link/verify"]);
function invalidateSession() { setCsrfToken(null); for (const listener of unauthorizedListeners) listener(); }
async function ensureCsrf() {
  if (csrfToken) return;
  if (!csrfRefresh) {
    const generation = csrfGeneration;
    const refresh = request<Envelope<SessionPayload>>("/auth/session").then(({ data }) => {
      if (generation !== csrfGeneration) throw new ApiError(401, "Session changed. Please try again.");
      if (!data?.csrfToken) throw new ApiError(401, "Session unavailable.");
      csrfToken = data.csrfToken;
    });
    csrfRefresh = refresh;
    void refresh.finally(() => { if (csrfRefresh === refresh) csrfRefresh = null; }).catch(() => {});
  }
  return csrfRefresh;
}
function retryAfter(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (!raw) return;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : Math.max(0, Math.ceil((Date.parse(raw) - Date.now()) / 1000));
}
async function responseError(response: Response, publicRequest: boolean, generation: number): Promise<never> {
  const body = await response.json().catch(() => null);
  if (generation === csrfGeneration) {
    if (response.status === 401 && !publicRequest) invalidateSession();
    if (response.status === 403 && typeof body?.message === "string" && /CSRF token/i.test(body.message)) setCsrfToken(null);
  }
  const message = typeof body?.message === "string" ? body.message : `Request failed (${response.status})`;
  const details = Array.isArray(body?.details) ? (body.details as ApiErrorDetail[]).filter((d) => d && typeof d.field === "string") : undefined;
  throw new ApiError(response.status, message, typeof body?.code === "string" ? body.code : undefined, retryAfter(response), details, typeof body?.requestId === "string" ? body.requestId : undefined);
}
export async function request<T>(path: string, options: RequestInit = {}, binary = false): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/v1/")) throw new Error("Invalid API path");
  const method = (options.method ?? "GET").toUpperCase();
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const publicRequest = publicMutations.has(path);
  if (mutation && !publicRequest) await ensureCsrf();
  const headers = new Headers(options.headers);
  headers.delete("Authorization"); headers.delete("x-api-key");
  headers.set("Accept", binary ? "application/pdf, application/xml" : "application/json");
  if (options.body instanceof FormData) headers.delete("Content-Type");
  else if (options.body) headers.set("Content-Type", "application/json");
  if (mutation && !publicRequest && csrfToken) headers.set("x-csrf-token", csrfToken);
  else headers.delete("x-csrf-token");
  headers.set("X-Corvo-Environment", getFiscalEnvironment());
  let response: Response;
  const generation = csrfGeneration;
  try { response = await fetch(`${BASE}${path}`, { ...options, method, headers, credentials: "include", cache: "no-store" }); }
  catch (error) { if (error instanceof Error && error.name === "AbortError") throw error; throw new ApiError(0, "Could not connect to the server."); }
  if (!response.ok) return responseError(response, publicRequest, generation);
  if (response.status === 204) return null as T;
  return (binary ? response.blob() : response.json()) as Promise<T>;
}
const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });
const idPath = (id: string) => encodeURIComponent(id);
function query(params: object): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") qs.set(key, String(value));
  return qs.size ? `?${qs}` : "";
}
export const auth = {
  session: async (signal?: AbortSignal) => {
    const { data } = await request<Envelope<SessionPayload>>("/auth/session", { signal });
    if (data?.status !== "authenticated" || !data.context?.authUserId || !data.csrfToken || !Array.isArray(data.permissions)) throw new ApiError(502, "Invalid session response.");
    return data;
  },
  logout: () => request<null>("/auth/session/logout", { method: "POST" }),
  switchTenant: async (tenantId: string) => (await request<Envelope<Omit<SessionPayload, "status">>>("/auth/session/tenant", json({ tenantId }))).data,
  me: async () => (await request<Envelope<AuthContext>>("/auth/me")).data,
  magicLinkRequest: async (email: string) => (await request<Envelope<MagicLinkChallenge>>("/auth/magic-link/request", json({ email }))).data,
  magicLinkVerify: async (email: string, challengeId: string, code: string) => (await request<Envelope<MagicLinkVerified>>("/auth/magic-link/verify", json({ email, challengeId, code }))).data,
};
export const apiKeys = {
  list: async (params: PageParams = {}) => toPage(await request<ListBody<ApiKey>>(`/auth/api-keys${query(params)}`)),
  create: async (data: { name: string; environment: string; scope: string; expiresAt?: string }) => unwrap(await request<Envelope<ApiKeyCreated>>("/auth/api-keys", json(data))),
  delete: async (id: string) => unwrap(await request<Envelope<{ deleted: boolean }>>(`/auth/api-keys/${idPath(id)}`, { method: "DELETE" })),
};
// Avulso credit purchases are gone (preview/confirm return 410): balance and history only.
export const credits = {
  balance: async () => unwrap(await request<Envelope<CreditBalance>>("/credits")),
  history: async (params: PageParams = {}, signal?: AbortSignal) => toPage(await request<ListBody<CreditTransaction>>(`/credits/history${query(params)}`, { signal })),
};
export const plans = { list: async (cycle: "monthly" | "annual" = "monthly", params: PageParams = {}) => toPage(await request<ListBody<PlanQuote>>(`/plans${query({ cycle, ...params })}`)) };
export interface CompanyWire extends Omit<Company, "address"> {
  addressStreet?: string; addressNumber?: string; addressComplement?: string; addressDistrict?: string; addressCity?: string; addressState?: string; addressZip?: string;
}
export function adaptCompany(wire: CompanyWire): Company {
  return { ...wire, address: { street: wire.addressStreet, number: wire.addressNumber, complement: wire.addressComplement, district: wire.addressDistrict, city: wire.addressCity, state: wire.addressState, zip: wire.addressZip } };
}
export const companies = {
  list: async (params: PageParams = {}, signal?: AbortSignal): Promise<Page<Company>> => { const page = toPage(await request<ListBody<CompanyWire>>(`/companies${query(params)}`, { signal })); return { ...page, items: page.items.map(adaptCompany) }; },
  get: async (id: string, signal?: AbortSignal) => adaptCompany(unwrap(await request<Envelope<CompanyWire>>(`/companies/${idPath(id)}`, { signal }))),
  create: async (data: CompanyFormInput) => adaptCompany(unwrap(await request<Envelope<CompanyWire>>("/companies", json(data)))),
  update: async (id: string, data: UpdateCompanyInput) => adaptCompany(unwrap(await request<Envelope<CompanyWire>>(`/companies/${idPath(id)}`, json(data, "PATCH")))),
  delete: async (id: string) => (await request<Envelope<null>>(`/companies/${idPath(id)}`, { method: "DELETE" })).data,
};
export const certificates = {
  list: async (companyId: string, params: PageParams = {}, signal?: AbortSignal) => toPage(await request<ListBody<Certificate>>(`/companies/${idPath(companyId)}/certificates${query(params)}`, { signal })),
  create: async (companyId: string, formData: FormData) => unwrap(await request<Envelope<Certificate>>(`/companies/${idPath(companyId)}/certificates`, { method: "POST", body: formData })),
  delete: (companyId: string, certId: string) => request<null>(`/companies/${idPath(companyId)}/certificates/${idPath(certId)}`, { method: "DELETE" }),
};
export type InvoiceWire = Omit<Invoice, "customerName" | "customerTaxId" | "serviceDescription">;
export function adaptInvoice({ props }: { props: InvoiceWire }): Invoice {
  return { ...props, customerName: props.customerSnapshot.name, customerTaxId: props.customerSnapshot.taxId, serviceDescription: props.serviceSnapshot.description };
}
export interface InvoiceQuery extends PageParams { companyId?: string; status?: InvoiceStatus; from?: string; to?: string; externalId?: string }
type InvoiceBody = { props: InvoiceWire };
type EventWire = { props: { id: string; invoiceId: string; fromStatus: InvoiceStatus | null; toStatus: InvoiceStatus; createdAt: string; reason: string | null } };
export const invoices = {
  list: async (params: InvoiceQuery = {}, signal?: AbortSignal): Promise<Page<Invoice>> => { const page = toPage(await request<ListBody<InvoiceBody>>(`/invoices${query(params)}`, { signal })); return { ...page, items: page.items.map(adaptInvoice) }; },
  get: async (id: string, signal?: AbortSignal) => adaptInvoice(unwrap(await request<Envelope<InvoiceBody>>(`/invoices/${idPath(id)}`, { signal }))),
  create: async (data: CreateInvoiceInput, idempotencyKey: string) => adaptInvoice(unwrap(await request<Envelope<InvoiceBody>>("/invoices", { ...json(data), headers: { "idempotency-key": idempotencyKey } }))),
  xml: (id: string) => request<Blob>(`/invoices/${idPath(id)}/xml`, {}, true),
  pdf: (id: string) => request<Blob>(`/invoices/${idPath(id)}/pdf`, {}, true),
  events: async (id: string, params: PageParams = {}, signal?: AbortSignal): Promise<Page<InvoiceEvent>> => { const page = toPage(await request<ListBody<EventWire>>(`/invoices/${idPath(id)}/events${query(params)}`, { signal })); return { ...page, items: page.items.map(({ props }) => ({ id: props.id, invoiceId: props.invoiceId, from: props.fromStatus, to: props.toStatus, at: props.createdAt, reason: props.reason } satisfies InvoiceEvent)) }; },
  downloadUrl: async (id: string, format: "pdf" | "xml") => (await request<Envelope<{ downloadUrl: string; expiresAt: string; fileName: string; mimeType: string }>>(`/invoices/${idPath(id)}/download-url`, json({ format }))).data,
  email: async (id: string, idempotencyKey: string) => (await request<Envelope<{ emailId: string; status: string }>>(`/invoices/${idPath(id)}/email`, { ...json({}), headers: { "idempotency-key": idempotencyKey } })).data,
};
interface BillingWire { plan: { slug: string; name: string; monthly_price_cents: number }; subscription?: { status: string; paid_until: string | null; cancel_at_period_end: boolean; scheduled_plan: string | null; blocked: boolean }; usage: { overage_units?: number; overage_amount_cents?: number; credits_used: number; credits_reserved: number; credits_remaining: number; monthly_allowance: number; daily_usage: number; daily_limit: number | null; active_companies: number; max_active_companies: number; period_start?: string; period_end?: string } }
export function adaptBilling(wire: BillingWire): BillingPlan {
  const u = wire.usage;
  return { slug: wire.plan.slug, name: wire.plan.name, monthlyPriceCents: wire.plan.monthly_price_cents, subscription: { status: wire.subscription?.status ?? "none", paidUntil: wire.subscription?.paid_until ?? null, cancelAtPeriodEnd: wire.subscription?.cancel_at_period_end ?? false, scheduledPlan: wire.subscription?.scheduled_plan ?? null, blocked: wire.subscription?.blocked ?? false }, usage: { creditsUsed: u.credits_used, creditsReserved: u.credits_reserved, creditsRemaining: u.credits_remaining, monthlyAllowance: u.monthly_allowance, dailyUsage: u.daily_usage, dailyLimit: u.daily_limit, activeCompanies: u.active_companies, maxActiveCompanies: u.max_active_companies, periodStart: u.period_start ?? "", periodEnd: u.period_end ?? "", overageUnits: u.overage_units ?? 0, overageAmountCents: u.overage_amount_cents ?? 0 } };
}
export const billing = {
  plan: async (signal?: AbortSignal) => adaptBilling(unwrap(await request<Envelope<BillingWire>>("/billing/plan", { signal }))),
  usage: async () => unwrap(await request<Envelope<BillingUsage>>("/billing/usage")),
  plans: plans.list,
  checkout: async (planSlug: CheckoutPlan, idempotencyKey: string) => { const d = unwrap(await request<Envelope<{ session_id: string; url: string }>>("/billing/checkout", { ...json({ plan_slug: planSlug }), headers: { "idempotency-key": idempotencyKey } })); return { sessionId: d.session_id, url: d.url }; },
  checkoutStatus: async (sessionId: string) => { const d = unwrap(await request<Envelope<{ session_id: string; status: string; payment_status: string; activated: boolean }>>(`/billing/checkout/${idPath(sessionId)}`)); return { sessionId: d.session_id, status: d.status, paymentStatus: d.payment_status, activated: d.activated }; },
  portal: async () => unwrap(await request<Envelope<{ url: string }>>("/billing/portal", { method: "POST" })),
  changePlan: async (planSlug: PlanSlug, direction: "upgrade" | "downgrade") => { const d = unwrap(await request<Envelope<{ scheduled_plan: string | null; effective_at: string | null }>>(`/billing/${direction}`, json({ plan_slug: planSlug }))); return { scheduledPlan: d.scheduled_plan, effectiveAt: d.effective_at }; },
};
export type CheckoutPlan = "developer" | "growth" | "scale" | "volume";
export const webhooks = {
  list: async (params: PageParams = {}) => toPage(await request<ListBody<WebhookEndpoint>>(`/webhooks${query(params)}`)),
  create: async (data: { url: string; events: WebhookEvent[] }) => unwrap(await request<Envelope<WebhookEndpoint>>("/webhooks", json(data))),
  delete: async (id: string) => unwrap(await request<Envelope<{ deleted: boolean }>>(`/webhooks/${idPath(id)}`, { method: "DELETE" })),
  test: async (id: string) => unwrap(await request<Envelope<{ sent: boolean }>>(`/webhooks/${idPath(id)}/test`, { method: "POST" })),
  deliveries: async (params: WebhookDeliveriesQuery = {}) => toPage(await request<ListBody<WebhookDelivery>>(`/webhooks/deliveries${query(params)}`)),
  deliveryStats: async (hours = 24, environment = "live") => unwrap(await request<Envelope<DeliveryStats>>(`/webhooks/deliveries/stats${query({ hours, environment })}`)),
  retryDelivery: async (id: string) => unwrap(await request<Envelope<{ retried: boolean }>>(`/webhooks/deliveries/${idPath(id)}/retry`, { method: "POST" })),
};
export interface Member { id: string; email: string; name: string; role: string; createdAt: string }
export interface InviteResult { userId: string; email: string; role: string }
export const members = {
  list: async (params: PageParams = {}) => toPage(await request<ListBody<Member>>(`/auth/members${query(params)}`)),
  invite: async (data: { name: string; email: string; role: string }) => unwrap(await request<Envelope<InviteResult>>("/auth/invite", json(data))),
  remove: async (id: string) => unwrap(await request<Envelope<{ deleted: boolean }>>(`/auth/members/${idPath(id)}`, { method: "DELETE" })),
};
