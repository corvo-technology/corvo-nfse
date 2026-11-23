import type { ForeignCustomer, SavedCustomer, ImportJob, ImportRow, ImportStart, ImportStatus, InvoiceSchedule, ScheduleFrequency, ScheduleRun, PaymentRecord, PixSubscription, ApiKey, ApiKeyCreated, CreditBalance, CreditTransaction, PlanSlug, Company, Certificate, Invoice, InvoiceStatus, CancellationReasonCode, InvoiceEvent, BillingPlan, BillingUsage, CreateCompanyInput, CompanyFormInput, InvoiceCalculation, CompanyFiscalProfile, FiscalProfileInput, CompanyServiceTaxProfile, ServiceTaxProfileInput, UpdateCompanyInput, CreateInvoiceInput, PlanQuote, WebhookEndpoint, WebhookDelivery, WebhookDeliveriesQuery, WebhookEvent, DeliveryStats } from "./types";
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
export interface Profile { name: string; email: string }
export interface SessionPayload { status: "authenticated"; context: AuthContext; profile?: Profile; activeTenantId: string; availableTenants: AvailableTenant[]; permissions: string[]; isPlatformAdmin?: boolean; expiresAt: string; csrfToken: string }
export interface MagicLinkChallenge { challengeId: string; expiresAt: string; resendAvailableAt: string }
export type OAuthProvider = "google" | "github";
export type OAuthProviders = Record<OAuthProvider, boolean>;

export interface MagicLinkVerified { expiresAt: string; isNewUser: boolean; csrfToken: string }

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public retryAfterSeconds?: number, public details?: ApiErrorDetail[], public requestId?: string) { super(message); this.name = "ApiError"; }
}
/** The API refused a new company because the account is at its limit (no plan allows one). */
export function isCompanyLimitError(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 422 && /company[ _]limit[ _]exceeded/i.test(cause.message);
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
  headers.set("Accept", binary ? "application/pdf, application/xml, text/csv, application/zip" : "application/json");
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
  /** The signed-in person's own name. */
  updateProfile: async (name: string) => unwrap(await request<Envelope<{ name: string }>>("/auth/profile", json({ name }, "PATCH"))),
  /** Which social sign-in providers the server has configured. */
  oauthProviders: async () => (await request<Envelope<OAuthProviders>>("/auth/oauth/providers")).data,
  /** Where the browser goes to start a social sign-in (the API redirects to the provider). */
  oauthStartUrl: (provider: OAuthProvider, next?: string) => `${BASE}/auth/oauth/${provider}/authorize${next ? `?next=${encodeURIComponent(next)}` : ""}`,
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
export interface DpsSequence { series: string; lastNumber: number }
export const companies = {
  fiscalProfiles: async (id: string, signal?: AbortSignal) => unwrap(await request<Envelope<CompanyFiscalProfile[]>>(`/companies/${idPath(id)}/fiscal-profile`, { signal })),
  saveFiscalProfile: async (id: string, input: FiscalProfileInput) => unwrap(await request<Envelope<CompanyFiscalProfile>>(`/companies/${idPath(id)}/fiscal-profile`, json(input, "PUT"))),
  approveFiscalProfile: async (id: string, profileId: string) => unwrap(await request<Envelope<CompanyFiscalProfile>>(`/companies/${idPath(id)}/fiscal-profile/${idPath(profileId)}/approve`, json({}))),
  serviceTaxProfiles: async (id: string, date: string, signal?: AbortSignal) => unwrap(await request<Envelope<CompanyServiceTaxProfile[]>>(`/companies/${idPath(id)}/service-tax-profiles${query({ date })}`, { signal })),
  createServiceTaxProfile: async (id: string, input: ServiceTaxProfileInput) => unwrap(await request<Envelope<CompanyServiceTaxProfile>>(`/companies/${idPath(id)}/service-tax-profiles`, json(input))),
  updateServiceTaxProfile: async (id: string, serviceId: string, input: Partial<ServiceTaxProfileInput>) => unwrap(await request<Envelope<CompanyServiceTaxProfile>>(`/companies/${idPath(id)}/service-tax-profiles/${idPath(serviceId)}`, json(input, "PATCH"))),
  approveServiceTaxProfile: async (id: string, serviceId: string) => unwrap(await request<Envelope<CompanyServiceTaxProfile>>(`/companies/${idPath(id)}/service-tax-profiles/${idPath(serviceId)}/approve`, json({}))),

  dpsSequence: async (id: string, signal?: AbortSignal) => unwrap(await request<Envelope<DpsSequence>>(`/companies/${idPath(id)}/dps-sequence`, { signal })),
  setDpsSequence: async (id: string, lastNumber: number) => unwrap(await request<Envelope<DpsSequence>>(`/companies/${idPath(id)}/dps-sequence`, json({ lastNumber }, "PUT"))),
  list: async (params: PageParams = {}, signal?: AbortSignal): Promise<Page<Company>> => { const page = toPage(await request<ListBody<CompanyWire>>(`/companies${query(params)}`, { signal })); return { ...page, items: page.items.map(adaptCompany) }; },
  get: async (id: string, signal?: AbortSignal) => adaptCompany(unwrap(await request<Envelope<CompanyWire>>(`/companies/${idPath(id)}`, { signal }))),
  create: async (data: CompanyFormInput & Pick<CreateCompanyInput, "taxId" | "taxRegime">) => adaptCompany(unwrap(await request<Envelope<CompanyWire>>("/companies", json(data)))),
  update: async (id: string, data: UpdateCompanyInput) => adaptCompany(unwrap(await request<Envelope<CompanyWire>>(`/companies/${idPath(id)}`, json(data, "PATCH")))),
  delete: async (id: string) => (await request<Envelope<null>>(`/companies/${idPath(id)}`, { method: "DELETE" })).data,
};
export const certificates = {
  list: async (companyId: string, params: PageParams = {}, signal?: AbortSignal) => toPage(await request<ListBody<Certificate>>(`/companies/${idPath(companyId)}/certificates${query(params)}`, { signal })),
  create: async (companyId: string, formData: FormData) => unwrap(await request<Envelope<Certificate>>(`/companies/${idPath(companyId)}/certificates`, { method: "POST", body: formData })),
  delete: (companyId: string, certId: string) => request<null>(`/companies/${idPath(companyId)}/certificates/${idPath(certId)}`, { method: "DELETE" }),
};
export type InvoiceWire = Omit<Invoice, "customerName" | "customerTaxId" | "serviceDescription">;
export function adaptInvoice(props: InvoiceWire): Invoice {
  // Anonymous consumer invoices have no customer snapshot (the tomador is omitted from the DPS).
  return { ...props, customerName: props.customerSnapshot?.name ?? "", customerTaxId: props.customerSnapshot?.taxId ?? props.customerSnapshot?.foreign?.taxId ?? "", serviceDescription: props.serviceSnapshot.description };
}
export interface InvoiceQuery extends PageParams { companyId?: string; status?: InvoiceStatus; from?: string; to?: string; externalId?: string }
export type OverviewPeriod = "7d" | "30d";
export interface InvoiceOverview {
  period: OverviewPeriod;
  from: string;
  to: string;
  timezone: string;
  counts: { authorized: number; rejected: number; processing: number };
  dailyActivity: { date: string; count: number }[];
  recentInvoices: Invoice[];
}
type InvoiceBody = InvoiceWire;
type EventWire = { id: string; invoiceId: string; fromStatus: InvoiceStatus | null; toStatus: InvoiceStatus; createdAt: string; reason: string | null; source?: "portal" | null; portalEvent?: string | null };
export type ReviewAction = "retry" | "discard";
export type ReviewOutcome =
  | { id: string; outcome: "accepted" }
  | { id: string; outcome: "skipped"; reason: "not_found" | "not_in_manual_review" | "changed" };
const REVIEW_BATCH = 100;
export interface FiscalPortalStatus { environment: "test" | "live"; available: boolean; since: string | null; retryAt: string | null }
/** Whether the national NFS-e portal is answering; while it is not, invoices wait in the queue. */
export const fiscalPortal = {
  status: async (signal?: AbortSignal) => unwrap(await request<Envelope<FiscalPortalStatus>>("/fiscal-portal/status", { signal })),
};
export interface InvoicePackageSummary { month: string; count: number; total: string; limit: number; companyName: string; companyTaxId: string }
export interface AccountantSettings { email: string | null; lastSentMonth: string | null }
export type AccountantSendStatus = "sent" | "skipped-test" | "skipped-no-email" | "skipped-empty" | "skipped-already-sent";
/** The month package (ZIP with xml/, pdf/ and resumo.csv) and the monthly send to the accountant. */
export const invoicePackages = {
  summary: async (companyId: string, month: string, signal?: AbortSignal) => unwrap(await request<Envelope<InvoicePackageSummary>>(`/companies/${idPath(companyId)}/invoice-package/summary${query({ month })}`, { signal })),
  download: (companyId: string, month: string) => request<Blob>(`/companies/${idPath(companyId)}/invoice-package${query({ month })}`, {}, true),
  accountant: async (companyId: string, signal?: AbortSignal) => unwrap(await request<Envelope<AccountantSettings>>(`/companies/${idPath(companyId)}/accountant-package`, { signal })),
  setAccountant: async (companyId: string, accountantEmail: string | null) => unwrap(await request<Envelope<AccountantSettings>>(`/companies/${idPath(companyId)}/accountant-package`, json({ accountantEmail }, "PUT"))),
  sendToAccountant: async (companyId: string, month: string) => unwrap(await request<Envelope<{ status: AccountantSendStatus }>>(`/companies/${idPath(companyId)}/accountant-package/send`, json({ month }))).status,
};
export const invoices = {
  overview: async (period: OverviewPeriod = "7d", signal?: AbortSignal): Promise<InvoiceOverview> => {
    const result = unwrap(await request<Envelope<Omit<InvoiceOverview, "recentInvoices"> & { recentInvoices: InvoiceWire[] }>>(`/invoices/overview${query({ period })}`, { signal }));
    return { ...result, recentInvoices: result.recentInvoices.map(adaptInvoice) };
  },
  list: async (params: InvoiceQuery = {}, signal?: AbortSignal): Promise<Page<Invoice>> => { const page = toPage(await request<ListBody<InvoiceBody>>(`/invoices${query(params)}`, { signal })); return { ...page, items: page.items.map(adaptInvoice) }; },
  get: async (id: string, signal?: AbortSignal) => adaptInvoice(unwrap(await request<Envelope<InvoiceBody>>(`/invoices/${idPath(id)}`, { signal }))),
  create: async (data: CreateInvoiceInput, idempotencyKey: string) => adaptInvoice(unwrap(await request<Envelope<InvoiceBody>>("/invoices", { ...json(data), headers: { "idempotency-key": idempotencyKey } }))),
  calculate: async (data: CreateInvoiceInput, signal?: AbortSignal) => unwrap(await request<Envelope<InvoiceCalculation>>("/invoices/calculate", { ...json(data), signal })),
  /** Issues the substitute of an authorized invoice. Customer, competence and amount are copied by the API. */
  substitute: async (id: string, data: SubstituteInvoiceInput, idempotencyKey: string) => adaptInvoice(unwrap(await request<Envelope<InvoiceBody>>(`/invoices/${idPath(id)}/substitute`, { ...json(data), headers: { "idempotency-key": idempotencyKey } }))),
  cancel: async (id: string, data: { reason: CancellationReasonCode; description?: string }) => adaptInvoice(unwrap(await request<Envelope<InvoiceBody>>(`/invoices/${idPath(id)}/cancel`, json(data)))),
  xml: (id: string) => request<Blob>(`/invoices/${idPath(id)}/xml`, {}, true),
  pdf: (id: string) => request<Blob>(`/invoices/${idPath(id)}/pdf`, {}, true),
  events: async (id: string, params: PageParams = {}, signal?: AbortSignal): Promise<Page<InvoiceEvent>> => { const page = toPage(await request<ListBody<EventWire>>(`/invoices/${idPath(id)}/events${query(params)}`, { signal })); return { ...page, items: page.items.map((event) => ({ id: event.id, invoiceId: event.invoiceId, from: event.fromStatus, to: event.toStatus, at: event.createdAt, reason: event.reason, source: event.source ?? null, portalEvent: event.portalEvent ?? null } satisfies InvoiceEvent)) }; },
  downloadUrl: async (id: string, format: "pdf" | "xml") => (await request<Envelope<{ downloadUrl: string; expiresAt: string; fileName: string; mimeType: string }>>(`/invoices/${idPath(id)}/download-url`, json({ format }))).data,
  /** Resolves invoices in manual review; sent in chunks of up to 100 (the API limit). */
  review: async (action: ReviewAction, invoiceIds: string[]): Promise<ReviewOutcome[]> => {
    const results: ReviewOutcome[] = [];
    for (let start = 0; start < invoiceIds.length; start += REVIEW_BATCH) {
      const chunk = invoiceIds.slice(start, start + REVIEW_BATCH);
      results.push(...unwrap(await request<Envelope<{ results: ReviewOutcome[] }>>("/invoices/review", json({ action, invoiceIds: chunk }))).results);
    }
    return results;
  },
  email: async (id: string, idempotencyKey: string) => (await request<Envelope<{ emailId: string; status: string }>>(`/invoices/${idPath(id)}/email`, { ...json({}), headers: { "idempotency-key": idempotencyKey } })).data,
};
interface BillingWire { plan: { slug: string; name: string; monthly_price_cents: number }; subscription?: { status: string; paid_until: string | null; cancel_at_period_end: boolean; scheduled_plan: string | null; blocked: boolean; pix_subscription?: PixSubscription | null; stripe_portal_available?: boolean; stripe_subscription?: boolean }; usage: { avulso_balance?: number; credits_used: number; credits_reserved: number; credits_remaining: number; monthly_allowance: number; daily_usage: number; daily_limit: number | null; active_companies: number; max_active_companies: number; period_start?: string; period_end?: string } }
export function adaptBilling(wire: BillingWire): BillingPlan {
  const u = wire.usage;
  return { slug: wire.plan.slug, name: wire.plan.name, monthlyPriceCents: wire.plan.monthly_price_cents, subscription: { status: wire.subscription?.status ?? "none", paidUntil: wire.subscription?.paid_until ?? null, cancelAtPeriodEnd: wire.subscription?.cancel_at_period_end ?? false, scheduledPlan: wire.subscription?.scheduled_plan ?? null, blocked: wire.subscription?.blocked ?? false, pixSubscription: wire.subscription?.pix_subscription ?? null, stripePortalAvailable: wire.subscription?.stripe_portal_available ?? false, stripeSubscription: wire.subscription?.stripe_subscription ?? false }, usage: { creditsUsed: u.credits_used, creditsReserved: u.credits_reserved, creditsRemaining: u.credits_remaining, monthlyAllowance: u.monthly_allowance, dailyUsage: u.daily_usage, dailyLimit: u.daily_limit, activeCompanies: u.active_companies, maxActiveCompanies: u.max_active_companies, periodStart: u.period_start ?? "", periodEnd: u.period_end ?? "", avulsoBalance: u.avulso_balance ?? 0 } };
}
export const billing = {
  plan: async (signal?: AbortSignal) => adaptBilling(unwrap(await request<Envelope<BillingWire>>("/billing/plan", { signal }))),
  usage: async () => unwrap(await request<Envelope<BillingUsage>>("/billing/usage")),
  plans: plans.list,
  checkout: async (planSlug: CheckoutPlan, idempotencyKey: string) => { const d = unwrap(await request<Envelope<{ session_id: string; url: string }>>("/billing/checkout", { ...json({ plan_slug: planSlug }), headers: { "idempotency-key": idempotencyKey } })); return { sessionId: d.session_id, url: d.url }; },
  checkoutStatus: async (sessionId: string) => { const d = unwrap(await request<Envelope<{ session_id: string; status: string; payment_status: string; activated: boolean }>>(`/billing/checkout/${idPath(sessionId)}`)); return { sessionId: d.session_id, status: d.status, paymentStatus: d.payment_status, activated: d.activated }; },
  portal: async () => unwrap(await request<Envelope<{ url: string }>>("/billing/portal", { method: "POST" })),
  purchase: async (req: PurchaseRequest, idempotencyKey: string): Promise<PurchaseResult> => {
    const body = req.kind === "avulso"
      ? { kind: "avulso", units: req.units, method: req.method }
      : { kind: "plan", plan_slug: req.planSlug, cycle: req.cycle, method: req.method, customer: req.customer };
    return unwrap(await request<Envelope<PurchaseResult>>("/billing/checkout", { ...json(body), headers: { "idempotency-key": idempotencyKey } }));
  },
  payments: async (signal?: AbortSignal): Promise<PaymentRecord[]> => {
    const rows = unwrap(await request<Envelope<Array<{ id: string; kind: "plan" | "avulso"; plan_slug: string | null; cycle: "monthly" | "annual" | null; units: number | null; amount_cents: number; provider: "woovi" | "stripe"; paid_at: string | null }>>>("/billing/payments", { signal }));
    return rows.map((r) => ({ id: r.id, kind: r.kind, planSlug: r.plan_slug, cycle: r.cycle, units: r.units, amountCents: r.amount_cents, provider: r.provider, paidAt: r.paid_at }));
  },
  cancelPix: async () => { unwrap(await request<Envelope<{ cancelled: boolean }>>("/billing/pix/cancel", json({}))); },
  changePlan: async (planSlug: PlanSlug, direction: "upgrade" | "downgrade") => { const d = unwrap(await request<Envelope<{ scheduled_plan: string | null; effective_at: string | null }>>(`/billing/${direction}`, json({ plan_slug: planSlug }))); return { scheduledPlan: d.scheduled_plan, effectiveAt: d.effective_at }; },
};
export type CheckoutPlan = "solo" | "equipe" | "empresa" | "escala";
export type PaymentMethod = "pix" | "card";
export type Payer = { name: string; taxID: string; email: string; phone: string };
export type PurchaseRequest =
  | { kind: "plan"; planSlug: CheckoutPlan; cycle: "monthly" | "annual"; method: PaymentMethod; customer?: Payer }
  | { kind: "avulso"; units: number; method: PaymentMethod };
export type PurchaseResult =
  | { method: "card"; url: string }
  | { method: "pix"; brCode: string | null; qrCodeImage: string | null; paymentLinkUrl: string; expiresAt: string | null };
type ScheduleWire = { id: string; kind: InvoiceSchedule["kind"]; frequency: ScheduleFrequency | null; status: InvoiceSchedule["status"]; pause_reason: InvoiceSchedule["pauseReason"]; company_id: string; anchor_on: string; next_run_on: string | null; ends_on: string | null; attempts: number; last_run_on: string | null; invoice: Record<string, unknown>; created_at: string };
type ScheduleRunWire = { id: string; occurrence_on: string; ran_on: string; attempt: number; outcome: ScheduleRun["outcome"]; invoice_id: string | null; error_code: string | null; error_message: string | null; created_at: string };
const adaptSchedule = (w: ScheduleWire): InvoiceSchedule => ({ id: w.id, kind: w.kind, frequency: w.frequency, status: w.status, pauseReason: w.pause_reason, companyId: w.company_id, anchorOn: w.anchor_on, nextRunOn: w.next_run_on, endsOn: w.ends_on, attempts: w.attempts, lastRunOn: w.last_run_on, invoice: w.invoice, createdAt: w.created_at });
const adaptScheduleRun = (w: ScheduleRunWire): ScheduleRun => ({ id: w.id, occurrenceOn: w.occurrence_on, ranOn: w.ran_on, attempt: w.attempt, outcome: w.outcome, invoiceId: w.invoice_id, errorCode: w.error_code, errorMessage: w.error_message, createdAt: w.created_at });
/** What POST /invoices takes to create a schedule: the invoice body plus `options.type` SCHEDULE or RECURRING. */
/** What a substitute can change (the Sefin forbids changing the customer, the competence date and the amount for MEI and Simples Nacional). */
export interface SubstituteInvoiceInput { description: string; service?: { description?: string }; purchaseOrder?: string; notes?: string }
export interface CreateScheduleInput { companyId: string; amount: number; competenceDate: string; customer?: { name?: string; taxId?: string; email?: string; address?: { city?: string; state?: string }; foreign?: ForeignCustomer }; service?: { description?: string; code?: string; municipalityCode?: string }; deduction?: number; purchaseOrder?: string; notes?: string; options: { type: "SCHEDULE" | "RECURRING"; recurrence?: { frequency: ScheduleFrequency; endsOn?: string }; email?: { send: boolean } } }
export interface UpdateScheduleInput { invoice?: Record<string, unknown>; endsOn?: string | null; frequency?: ScheduleFrequency; anchorOn?: string }
export const schedules = {
  list: async (params: PageParams & { status?: InvoiceSchedule["status"] } = {}, signal?: AbortSignal): Promise<Page<InvoiceSchedule>> => { const page = toPage(await request<ListBody<ScheduleWire>>(`/schedules${query(params)}`, { signal })); return { ...page, items: page.items.map(adaptSchedule) }; },
  get: async (id: string) => adaptSchedule(unwrap(await request<Envelope<ScheduleWire>>(`/schedules/${idPath(id)}`))),
  runs: async (id: string, params: PageParams = {}, signal?: AbortSignal): Promise<Page<ScheduleRun>> => { const page = toPage(await request<ListBody<ScheduleRunWire>>(`/schedules/${idPath(id)}/runs${query(params)}`, { signal })); return { ...page, items: page.items.map(adaptScheduleRun) }; },
  create: async (input: CreateScheduleInput, idempotencyKey?: string) => adaptSchedule(unwrap(await request<Envelope<ScheduleWire>>("/invoices", { ...json(input), ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {}) }))),
  update: async (id: string, patch: UpdateScheduleInput) => adaptSchedule(unwrap(await request<Envelope<ScheduleWire>>(`/schedules/${idPath(id)}`, json(patch, "PATCH")))),
  pause: async (id: string) => adaptSchedule(unwrap(await request<Envelope<ScheduleWire>>(`/schedules/${idPath(id)}/pause`, json({})))),
  resume: async (id: string) => adaptSchedule(unwrap(await request<Envelope<ScheduleWire>>(`/schedules/${idPath(id)}/resume`, json({})))),
  cancel: async (id: string) => adaptSchedule(unwrap(await request<Envelope<ScheduleWire>>(`/schedules/${idPath(id)}/cancel`, json({})))),
};
export const customers = {
  list: async (params: PageParams & { search?: string } = {}, signal?: AbortSignal): Promise<Page<SavedCustomer>> => toPage(await request<ListBody<SavedCustomer>>(`/customers${query(params)}`, { signal })),
  /** Null when the document was never saved (the API answers 404). */
  find: async (taxId: string, signal?: AbortSignal): Promise<SavedCustomer | null> => {
    try { return unwrap(await request<Envelope<SavedCustomer>>(`/customers/${idPath(taxId)}`, { signal })); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 404) return null; throw cause; }
  },
  update: async (taxId: string, patch: { name?: string; email?: string | null }) => unwrap(await request<Envelope<SavedCustomer>>(`/customers/${idPath(taxId)}`, json(patch, "PATCH"))),
  remove: async (taxId: string): Promise<void> => { await request<Envelope<null>>(`/customers/${idPath(taxId)}`, { method: "DELETE" }); },
};
export const webhooks = {
  list: async (params: PageParams = {}) => toPage(await request<ListBody<WebhookEndpoint>>(`/webhooks${query(params)}`)),
  create: async (data: { url: string; events: WebhookEvent[] }) => unwrap(await request<Envelope<WebhookEndpoint>>("/webhooks", json(data))),
  delete: async (id: string) => unwrap(await request<Envelope<{ deleted: boolean }>>(`/webhooks/${idPath(id)}`, { method: "DELETE" })),
  test: async (id: string) => unwrap(await request<Envelope<{ sent: boolean; statusCode?: number | null; error?: string }>>(`/webhooks/${idPath(id)}/test`, { method: "POST" })),
  deliveries: async (params: WebhookDeliveriesQuery = {}) => toPage(await request<ListBody<WebhookDelivery>>(`/webhooks/deliveries${query(params)}`)),
  deliveryStats: async (hours = 24, environment = "live") => unwrap(await request<Envelope<DeliveryStats>>(`/webhooks/deliveries/stats${query({ hours, environment })}`)),
  retryDelivery: async (id: string) => unwrap(await request<Envelope<{ retried: boolean }>>(`/webhooks/deliveries/${idPath(id)}/retry`, { method: "POST" })),
};
export interface IntegrationProvider { id: string; name: string; version: string; credentialFields: { key: string; label: string; secret: boolean; generate?: boolean; inWebhookUrl?: boolean }[]; webhookInstructions: { pt: string; en: string }; supportedFlows: string[] }
export type IntegrationConnectionState = "draft" | "active" | "paused" | "reauth_required" | "disconnected";
export interface IntegrationConnection { id: string; provider: string; environment: "test" | "live"; companyId: string; state: IntegrationConnectionState; externalAccountId: string | null; activeFrom: string | null; webhookUrl: string; createdAt: string;
  /** Only in the create response: secrets the client must paste into the platform. */
  secrets?: Record<string, string> }
export interface IntegrationSale {
  id: string; operationKey: string; commercialState: "pending" | "paid" | "refunded" | "disputed" | "canceled"; fiscalStatus: "none" | "blocked" | "needs_attention" | "submitted";
  blockReason: string | null; amountCents: number; currency: string; customer: { name: string | null; email: string | null; taxId: string | null; taxIdMasked: boolean } | null;
  paidAt: string | null; invoiceId: string | null; createdAt: string; updatedAt: string;
}
export interface IntegrationRuleInput { externalProductId?: string | null; service: { description?: string; code?: string }; sendEmail: boolean; allowAnonymousCustomer?: boolean; cancelOnRefund?: boolean }
export interface IntegrationRule { id: string; externalProductId: string | null; service: { description?: string; code?: string }; sendEmail: boolean; allowAnonymousCustomer: boolean; cancelOnRefund: boolean }
export interface IntegrationEvent { id: string; deliveryId: string; externalType: string; state: "received" | "processing" | "retry_pending" | "processed" | "ignored" | "needs_attention" | "dead"; attempts: number; lastError: string | null; operationId: string | null; createdAt: string }
export interface CreateIntegrationInput { provider: string; companyId: string; environment: "test" | "live"; credentials: Record<string, string>; activeFrom?: string }
export const integrations = {
  providers: async () => unwrap(await request<Envelope<IntegrationProvider[]>>("/integrations/providers")),
  list: async () => unwrap(await request<Envelope<IntegrationConnection[]>>("/integrations/connections")),
  create: async (data: CreateIntegrationInput) => unwrap(await request<Envelope<IntegrationConnection>>("/integrations/connections", json(data))),
  get: async (id: string) => unwrap(await request<Envelope<IntegrationConnection>>(`/integrations/connections/${idPath(id)}`)),
  validate: async (id: string) => unwrap(await request<Envelope<IntegrationConnection>>(`/integrations/connections/${idPath(id)}/validate`, { method: "POST" })),
  updateCredentials: async (id: string, credentials: Record<string, string>) => unwrap(await request<Envelope<IntegrationConnection>>(`/integrations/connections/${idPath(id)}/credentials`, json({ credentials }, "PUT"))),
  activate: async (id: string) => unwrap(await request<Envelope<IntegrationConnection>>(`/integrations/connections/${idPath(id)}/activate`, { method: "POST" })),
  pause: async (id: string) => unwrap(await request<Envelope<IntegrationConnection>>(`/integrations/connections/${idPath(id)}/pause`, { method: "POST" })),
  disconnect: async (id: string) => unwrap(await request<Envelope<IntegrationConnection>>(`/integrations/connections/${idPath(id)}/disconnect`, { method: "POST" })),
  putRules: async (id: string, rules: IntegrationRuleInput[]) => unwrap(await request<Envelope<unknown[]>>(`/integrations/connections/${idPath(id)}/rules`, json({ rules }, "PUT"))),
  rules: async (id: string) => unwrap(await request<Envelope<IntegrationRule[]>>(`/integrations/connections/${idPath(id)}/rules`)),
  events: async (id: string, limit = 20) => unwrap(await request<Envelope<IntegrationEvent[]>>(`/integrations/connections/${idPath(id)}/events${query({ limit })}`)),
  sales: async (id: string, limit = 50) => unwrap(await request<Envelope<IntegrationSale[]>>(`/integrations/connections/${idPath(id)}/operations${query({ limit })}`)),
  completeCustomer: async (saleId: string, data: { taxId: string; name?: string; email?: string }) => unwrap(await request<Envelope<IntegrationSale>>(`/integrations/operations/${idPath(saleId)}/customer`, json(data, "PATCH"))),
  retry: async (saleId: string) => unwrap(await request<Envelope<{ state: string; lastError?: string }>>(`/integrations/operations/${idPath(saleId)}/retry`, { method: "POST" })),
};
export interface Member { id: string; email: string; name: string; role: string; createdAt: string }
export interface InviteResult { id: string; email: string; name: string; role: string; expiresAt: string; createdAt: string }
export type Invitation = InviteResult
export interface InvitationPreview { role: string; invitedBy: string }
export const members = {
  list: async (params: PageParams = {}) => toPage(await request<ListBody<Member>>(`/auth/members${query(params)}`)),
  invite: async (data: { name: string; email: string; role: string }) => unwrap(await request<Envelope<InviteResult>>("/auth/invite", json(data))),
  remove: async (id: string) => unwrap(await request<Envelope<{ deleted: boolean }>>(`/auth/members/${idPath(id)}`, { method: "DELETE" })),
};
export const invitations = {
  list: async () => unwrap(await request<Envelope<Invitation[]>>("/auth/invitations")),
  resend: async (id: string) => unwrap(await request<Envelope<Invitation>>(`/auth/invitations/${idPath(id)}/resend`, { method: "POST" })),
  revoke: async (id: string) => unwrap(await request<Envelope<{ revoked: boolean }>>(`/auth/invitations/${idPath(id)}`, { method: "DELETE" })),
  preview: async (token: string) => unwrap(await request<Envelope<InvitationPreview>>("/auth/invitations/preview", json({ token }))),
  accept: async (token: string) => unwrap(await request<Envelope<{ tenantId: string; role: string }>>("/auth/invitations/accept", json({ token }))),
};
export interface McpConsentContext {
  client: { id: string; name: string };
  redirect_host: string;
  scopes: { name: string; description: string }[];
  tenants: { id: string; name: string; allowed_scopes: string[] }[];
}
export interface McpConsentParams { client_id: string; redirect_uri: string; scope?: string; state: string; code_challenge: string; code_challenge_method: string }
export interface McpConnection {
  id: string; tenant_id: string; tenant_name: string; client_name: string; scopes: string[]; granted_at: string; last_used_at: string | null;
  environment: "test" | "live"; tool_calls: number; invoices_issued: number; revoked: boolean; mine: boolean; owner_email: string | null;
}
export const mcp = {
  consentContext: async (params: McpConsentParams, signal?: AbortSignal) => unwrap(await request<Envelope<McpConsentContext>>(`/mcp/consent${query(params)}`, { signal })),
  decide: async (params: McpConsentParams, decision: "allow" | "deny", tenantId?: string, environment?: "test" | "live") => unwrap(await request<Envelope<{ redirect_url: string }>>("/mcp/consent", json({ ...params, decision, ...(tenantId ? { tenant_id: tenantId } : {}), ...(environment ? { environment } : {}) }))),
  connections: async (params: PageParams = {}, signal?: AbortSignal) => toPage(await request<ListBody<McpConnection>>(`/mcp/connections${query(params)}`, { signal })),
  revoke: async (id: string) => unwrap(await request<Envelope<{ revoked: boolean }>>(`/mcp/connections/${idPath(id)}`, { method: "DELETE" })),
};

type ImportWire = { id: string; status: ImportJob["status"]; file_name: string; company_id: string | null; error_code: string | null; rows_expected: number | null; unknown_columns?: string[]; emit_started_at: string | null; emit_finished_at: string | null; created_at: string; counters: Omit<ImportJob["counters"], "awaitingCredits" | "validAmount" | "awaitingAmount" | "authorizedAmount" | "pendingAmount" | "failedAmount"> & { awaiting_credits: number; valid_amount: number; awaiting_amount: number; authorized_amount?: number; pending_amount?: number; failed_amount?: number } };
type ImportRowWire = { line: number; data: Record<string, unknown>; status: ImportRow["status"]; error_code: string | null; error_message: string | null; invoice_id: string | null };
// The amounts while issuing came later: an older API without them reads as zero.
const adaptCounters = ({ awaiting_credits, valid_amount, awaiting_amount, authorized_amount, pending_amount, failed_amount, ...rest }: ImportWire["counters"]): ImportJob["counters"] => ({ ...rest, awaitingCredits: awaiting_credits, validAmount: valid_amount, awaitingAmount: awaiting_amount, authorizedAmount: authorized_amount ?? 0, pendingAmount: pending_amount ?? 0, failedAmount: failed_amount ?? 0 });
const adaptImport = (w: ImportWire): ImportJob => ({ id: w.id, status: w.status, fileName: w.file_name, companyId: w.company_id, errorCode: w.error_code, rowsExpected: w.rows_expected, unknownColumns: w.unknown_columns ?? [], emitStartedAt: w.emit_started_at, emitFinishedAt: w.emit_finished_at, createdAt: w.created_at, counters: adaptCounters(w.counters) });
const adaptImportRow = (w: ImportRowWire): ImportRow => ({ line: w.line, data: w.data, status: w.status, errorCode: w.error_code, errorMessage: w.error_message, invoiceId: w.invoice_id });
export const imports = {
  /** Sends the spreadsheet; the answer is the import to follow, still being read. */
  start: async (file: File, companyId?: string): Promise<ImportStart> => {
    const body = new FormData();
    body.append("file", file);
    if (companyId) body.append("companyId", companyId);
    const d = unwrap(await request<Envelope<{ id: string; status: ImportStatus; duplicate_of: string | null }>>("/imports", { method: "POST", body }));
    return { id: d.id, status: d.status, duplicateOf: d.duplicate_of };
  },
  /** The newest imports, with counters, so one can be picked up again later. */
  list: async (limit = 10, signal?: AbortSignal) => unwrap(await request<Envelope<ImportWire[]>>(`/imports${query({ limit })}`, { signal })).map(adaptImport),
  get: async (id: string, signal?: AbortSignal) => adaptImport(unwrap(await request<Envelope<ImportWire>>(`/imports/${idPath(id)}`, { signal }))),
  rows: async (id: string, params: PageParams & { status?: ImportRow["status"] } = {}, signal?: AbortSignal): Promise<Page<ImportRow>> => { const page = toPage(await request<ListBody<ImportRowWire>>(`/imports/${idPath(id)}/rows${query(params)}`, { signal })); return { ...page, items: page.items.map(adaptImportRow) }; },
  updateRow: async (id: string, line: number, item: Record<string, unknown>) => adaptImportRow(unwrap(await request<Envelope<ImportRowWire>>(`/imports/${idPath(id)}/rows/${line}`, json({ item }, "PATCH")))),
  emit: async (id: string, options: { sendEmail?: boolean } = {}) => adaptImport(unwrap(await request<Envelope<ImportWire>>(`/imports/${idPath(id)}/emit`, json(options.sendEmail ? { sendEmail: true } : {})))),
  discard: (id: string) => request<null>(`/imports/${idPath(id)}`, { method: "DELETE" }),
  errorsCsv: (id: string) => request<Blob>(`/imports/${idPath(id)}/errors.csv`, {}, true),
  template: () => request<Blob>("/imports/template", {}, true),
};
