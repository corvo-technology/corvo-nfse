# HTTP Contract Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the corvo-frontend dashboard and both docs content trees to the backend's new HTTP contract (`{data}` envelope, `{data, pagination}` listings, `ERROR_*` error bodies, explicit statuses, new rate limits) and enable the new billing/credits features.

**Architecture:** Central helpers in `lib/api.ts` (`unwrap`, `toPage`, typed `ApiError`), namespaces returning `Page<T>` for listings, a shared `useCursorPagination` hook feeding "Load more" buttons, and mass content updates in `lib/docs/content/{pt,en}.ts` guarded by the existing parity test.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Vitest + jsdom, next-intl (dashboard toasts only), yarn.

**Spec:** `docs/superpowers/specs/2026-10-11-http-contract-adaptation-design.md` — read it before starting.

**Backend references (read-only, outside this repo):**
- `/Users/pedrohenrique/Documents/corvo-backend/docs/api/http-contract.md` (78 lines)
- `/Users/pedrohenrique/Documents/corvo-backend/docs/api/route-contract-matrix.md` (85 lines)

## Status & corrections (2026-10-11, after reading `corvo-backend/src`)

**Backend facts that override earlier assumptions** (see the spec for the full table):
- `POST /credits/purchase/preview|confirm` always return **410 `ERROR_GONE`** — no purchase UI/flow. `credits.purchasePreview` was removed from the client.
- Billing: `POST /billing/checkout` (alias `/subscribe`) takes `{plan_slug}` + required `Idempotency-Key` → `{session_id,url}`; `GET /billing/checkout/:id` → `{session_id,status,payment_status,activated}`; `POST /billing/portal` → `{url}`; `upgrade|downgrade` → `{scheduled_plan,effective_at}` (session-only: not API-key accessible). Stripe returns to `/app/billing/success?session_id=…` or `/app/billing/cancel`.
- Real rate-limit code is `ERROR_RATE_LIMIT_EXCEEDED`.

| Task | State |
|---|---|
| 1–2 ApiError/unwrap/toPage | Done |
| 3 Companies + certificates → `Page<T>` | Done (`collectAll` for cert list) |
| 4 Invoices + `useCursorPagination` | Done (invoices & companies pages use the hook + "Load more"; client cursor hack removed) |
| 5 Webhooks / members / api-keys | Done (deliveries "Load more"; small lists use `collectAll`) |
| 6 Credits + billing | Done **without** any credit-purchase flow: plans grid, subscribe (checkout), change plan, billing portal, `/app/billing/success` polling, `/app/billing/cancel` redirect; `BillingPlan` gained `subscription` + overage |
| 7–8 Docs PT/EN | Done: home table, tenant note, errors, rate-limits, pagination guide rewritten; 21 response envelopes; statuses (download-url/test/upgrade/downgrade 200, purchase preview 410); parity 17/17 |
| 9 429 toast | Billing page handles 429 (`Retry-After`) and 409; other pages keep their generic error states |
| 10 Verification | `tsc`, `eslint`, 63 vitest, `yarn build` pass. **Live backend check pending** — backend was not running on :8080 during this session; authenticated flows need a manual pass |

Other fixes made on the way: `Common.loadMore` i18n key (was missing), `api-errors.fieldIssues` now reads `details[]` directly and also accepts 422.

---

## Global Constraints

- Package manager: **yarn** only (`yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`).
- **No commits during execution** — the user instructed the orchestrator to skip all commit steps. Implement and verify only.
- Dashboard talks to the **live backend** through the existing proxy (`/api/proxy/v1`). Final validation includes the dev server on port 4000.
- Response shapes for billing/credits endpoints are verified against `/Users/pedrohenrique/Documents/corvo-backend/src` controllers (see Status section); do not invent fields.
- Docs content: PT (`pt.ts`) is canonical; EN mirrors structure exactly (parity test `tests/docs-parity.test.ts` enforces 17/17).
- All UI copy in English (dashboard messages files en/pt already translated — add keys to BOTH `messages/en.json` and `messages/pt.json` when a task adds copy).
- `ApiError` decisions by `code` + HTTP status; `message` is a single string (never an array).
- Pagination UI is a "Load more" button everywhere (no infinite scroll, no page numbers).

## File Structure

```
Modify:
  lib/api.ts                    — ApiError upgrade, unwrap/toPage, all namespaces
  lib/use-cursor-pagination.ts  — NEW shared hook
  app/app/invoices/page.tsx     — Page<T> + load-more via hook
  app/app/page.tsx              — overview invoices.list placeholder shape
  app/app/companies/page.tsx    — Page<T>
  app/app/webhooks/page.tsx     — deliveries cursor + stats unwrap
  app/app/billing/page.tsx      — portal + checkout + plans page shape
  components/dashboard/sidebar.tsx — billing.plan() unchanged shape (verify)
  lib/types.ts                  — new types (CreditPlan, CheckoutSession…)
  messages/en.json, messages/pt.json — rate-limit / purchase copy
  tests/api.test.ts             — updated + new contract tests
  lib/docs/content/pt.ts        — contract sections + 31 envelopes
  lib/docs/content/en.ts        — mirror
Tests:
  tests/api.test.ts, tests/docs-parity.test.ts (existing), yarn typecheck/lint/build
```

---

### Task 1: ApiError upgrade + error parsing (TDD)

**Files:**
- Modify: `lib/api.ts:14-16` (ApiError), `lib/api.ts:58-66` (responseError)
- Test: `tests/api.test.ts` (update 1 existing test + add 1)

**Interfaces (Produces):**
- `class ApiError extends Error { constructor(status: number, message: string, code?: string, retryAfterSeconds?: number, details?: ApiErrorDetail[], requestId?: string) }`
- `interface ApiErrorDetail { field: string; code: string; message: string }` — exported from `lib/api.ts`.

- [ ] **Step 1: Update/add failing tests** (edit `tests/api.test.ts`)

Replace the existing 429 test (it asserts array-message joining, which the new contract removes):

```ts
  it("preserves Retry-After and new ERROR_* bodies without retrying mutations", async () => {
    fetchMock.mockResolvedValue(reply({ statusCode: 429, code: "ERROR_RATE_LIMITED", message: "Rate limit exceeded", requestId: "req-1" }, 429, { "Retry-After": "17" }));
    await expect(auth.magicLinkRequest("bad")).rejects.toMatchObject({ status: 429, code: "ERROR_RATE_LIMITED", retryAfterSeconds: 17, requestId: "req-1", message: "Rate limit exceeded" }); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("maps validation details and falls back on missing bodies", async () => {
    fetchMock.mockResolvedValueOnce(reply({ statusCode: 400, code: "ERROR_VALIDATION", message: "Request validation failed", details: [{ field: "customer.taxId", code: "ERROR_INVALID_TAX_ID", message: "Invalid tax ID" }], requestId: "req-2" })).mockResolvedValueOnce(reply(null, 500));
    await expect(auth.me()).rejects.toMatchObject({ status: 400, code: "ERROR_VALIDATION", details: [{ field: "customer.taxId" }] });
    await expect(auth.me()).rejects.toMatchObject({ status: 500, message: "Request failed (500)", code: undefined });
  });
```

- [ ] **Step 2: Run to verify failure** — Run: `yarn vitest run tests/api.test.ts` → FAIL (message joining/undefined code).

- [ ] **Step 3: Implement** — in `lib/api.ts`, above `ApiError`:

```ts
export interface ApiErrorDetail { field: string; code: string; message: string }
```

Change the class constructor to accept `details?: ApiErrorDetail[]` and `requestId?: string` (keep existing positional order `status, message, code, retryAfterSeconds` then append the two). Replace `responseError` body parsing:

```ts
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
```

- [ ] **Step 4: Run tests to pass** — `yarn vitest run tests/api.test.ts` → PASS; `yarn typecheck` → clean.
- [ ] **Step 5: Commit — SKIPPED per user instruction (no commits).**

---

### Task 2: unwrap/toPage helpers + Page<T> (TDD)

**Files:**
- Modify: `lib/api.ts` (add near `Envelope` at top)
- Test: `tests/api.test.ts` (add describe block)

**Interfaces (Produces):**
- `interface Page<T> { items: T[]; hasMore: boolean; nextCursor: string | null }` — exported.
- `export function unwrap<T>(body: { data: T } | null): T` — throws `new ApiError(502, "Invalid response payload.")` when `body?.data === undefined`.
- `export function toPage<T>(body: { data: T[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } } | null): Page<T>` — `items` from `data`; when `pagination` missing: `hasMore: false`, `nextCursor: null`.

- [ ] **Step 1: Add failing tests** (append to `tests/api.test.ts`)

```ts
describe("envelope helpers", () => {
  it("unwraps data and rejects missing envelopes", async () => {
    fetchMock.mockResolvedValueOnce(reply({ data: { id: "c1" } })).mockResolvedValueOnce(reply({ unexpected: true }));
    const body = await request<{ data: { id: string } }>("/companies/c1");
    expect(unwrap<{ id: string }>(body).id).toBe("c1");
    expect(() => unwrap(null)).toThrow(ApiError);
    expect(() => unwrap({} as never)).toThrow(ApiError);
  });
  it("builds pages from data+pagination and tolerates missing pagination", async () => {
    expect(toPage({ data: [1, 2], pagination: { limit: 50, hasMore: true, nextCursor: "cur" } })).toEqual({ items: [1, 2], hasMore: true, nextCursor: "cur" });
    expect(toPage({ data: [] })).toEqual({ items: [], hasMore: false, nextCursor: null });
    expect(toPage({ data: [{ id: "last" }], pagination: { hasMore: false, nextCursor: null } }).hasMore).toBe(false);
  });
});
```

- [ ] **Step 2: Verify failure** — Run: `yarn vitest run tests/api.test.ts` → FAIL (unwrap/toPage undefined).
- [ ] **Step 3: Implement** after the `Envelope` type:

```ts
export interface Page<T> { items: T[]; hasMore: boolean; nextCursor: string | null }
export function unwrap<T>(body: { data: T } | null): T {
  if (body && typeof body === "object" && "data" in body && (body as { data?: T }).data !== undefined) return (body as { data: T }).data;
  throw new ApiError(502, "Invalid response payload.");
}
export function toPage<T>(body: { data: T[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } } | null): Page<T> {
  const items = Array.isArray(body?.data) ? body.data : [];
  const pagination = body?.pagination;
  return { items, hasMore: pagination?.hasMore === true && typeof pagination?.nextCursor === "string", nextCursor: typeof pagination?.nextCursor === "string" ? pagination.nextCursor : null };
}
```

- [ ] **Step 4: Run to pass** — `yarn vitest run tests/api.test.ts` → PASS; `yarn typecheck` clean.
- [ ] **Step 5: Commit — SKIPPED.**

---

### Task 3: Companies + certificates namespaces → Page<T>

**Files:**
- Modify: `lib/api.ts:125-136` (companies, certificates)
- Test: `tests/api.test.ts` (update endpoint-contract tests)

**Interfaces:**
- Consumes: `unwrap`, `toPage`, `Page` (Tasks 1–2).
- Produces: `companies.list(params?: { limit?: number; cursor?: string }, signal?): Promise<Page<Company>>`; `certificates.list(companyId, params?: { cursor?: number | string }, signal?): Promise<Page<Certificate>>`; `certificates.create → Promise<Certificate>`; `certificates.delete → Promise<void>` (204).

- [ ] **Step 1: Update tests** — replace the companies part of the "adapts flat company addresses…" test and the multipart test:

```ts
  it("adapts flat company addresses from the paginated envelope", async () => {
    fetchMock.mockResolvedValueOnce(reply({ data: [company], pagination: { limit: 50, hasMore: true, nextCursor: "cur-1" } }));
    const page = await companies.list({ limit: 50 });
    expect(page.items[0].address.city).toBe("São Paulo"); expect(page.hasMore).toBe(true); expect(page.nextCursor).toBe("cur-1");
  });
```

In the multipart test keep behavior; response becomes `reply({ data: { id: "cert-1" } }, 201)` and `certificates.create` resolves to `{ id: "cert-1" }`. Add:

```ts
  it("lists certificates as a page and deletes with 204", async () => {
    fetchMock.mockResolvedValueOnce(reply({ data: [{ id: "cert-1" }], pagination: { hasMore: false, nextCursor: null } })).mockResolvedValueOnce(reply(null, 204));
    expect((await certificates.list("company-1")).items).toHaveLength(1);
    expect(await certificates.delete("company-1", "cert-1")).toBeUndefined();
  });
```

- [ ] **Step 2: Verify failure** — `yarn vitest run tests/api.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `lib/api.ts`:

```ts
export const companies = {
  list: async (params: { limit?: number; cursor?: string } = {}, signal?: AbortSignal) => {
    const page = toPage(await request<{ data: CompanyWire[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } }>(`/companies${query(params)}`, { signal }));
    return { ...page, items: page.items.map(adaptCompany) };
  },
  get: async (id: string, signal?: AbortSignal) => adaptCompany(unwrap(await request<{ data: CompanyWire }>(`/companies/${idPath(id)}`, { signal }))),
  create: async (data: CompanyFormInput) => adaptCompany(unwrap(await request<{ data: CompanyWire }>("/companies", json(data)))),
  update: async (id: string, data: UpdateCompanyInput) => adaptCompany(unwrap(await request<{ data: CompanyWire }>(`/companies/${idPath(id)}`, json(data, "PATCH")))),
  delete: async (id: string) => { unwrap(await request<{ data: null }>(`/companies/${idPath(id)}`, { method: "DELETE" })); },
};
export const certificates = {
  list: async (companyId: string, params: { cursor?: string } = {}, signal?: AbortSignal) => toPage(await request<{ data: Certificate[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } }>(`/companies/${idPath(companyId)}/certificates${query(params)}`, { signal })),
  create: async (companyId: string, formData: FormData) => unwrap(await request<{ data: Certificate }>(`/companies/${idPath(companyId)}/certificates`, { method: "POST", body: formData })),
  delete: async (companyId: string, certId: string) => { await request<null>(`/companies/${idPath(companyId)}/certificates/${idPath(certId)}`, { method: "DELETE" }); },
};
```

- [ ] **Step 4: Typecheck fallout** — Run: `yarn typecheck`. Fix consumers:
  - `app/app/companies/page.tsx` uses `companies.list()` result with `.data`/`hasMore` logic — change to `page.items` / `page.hasMore` / `page.nextCursor` (its own load-more already exists; keep its structure, just the field renames + pass `{ cursor }` on continuation).
  - `components/dashboard/company-form.tsx` / `app/app/companies/[id]/page.tsx` if they call `certificates.list(...).then(rows => …)` — change to `page.items`.
  Run `yarn vitest run && yarn typecheck` → green.
- [ ] **Step 5: Commit — SKIPPED.**

---

### Task 4: Invoices namespace + useCursorPagination hook

**Files:**
- Modify: `lib/api.ts:141-155` (invoices)
- Create: `lib/use-cursor-pagination.ts`
- Modify: `app/app/invoices/page.tsx:35,94`, `app/app/page.tsx:40`
- Test: `tests/api.test.ts`

**Interfaces:**
- Consumes: `unwrap`, `toPage`, `Page` (Tasks 1–2).
- Produces:
  - `invoices.list(params: InvoiceQuery, signal?): Promise<Page<Invoice>>` — `InvoiceQuery` gains `cursor?: string`; server pagination (no client clamp, no `next_cursor` fabrication).
  - `invoices.get/create/events` unwrap `data` (`events → Page<InvoiceEvent>` via `data.props`).
  - `useCursorPagination<T>(fetcher: (cursor?: string) => Promise<Page<T>>, deps: unknown[])` → `{ items, hasMore, loading, loadingMore, error, loadMore, reset }`.

- [ ] **Step 1: Update test** — replace the invoices/events portions of the endpoint-contract test:

```ts
    fetchMock.mockResolvedValueOnce(reply({ data: [invoice], pagination: { limit: 50, hasMore: false, nextCursor: null } })).mockResolvedValueOnce(reply({ data: [{ props: { id: "event-1", invoiceId: "invoice-1", fromStatus: "processing", toStatus: "authorized", createdAt: "2026-10-09T12:00:00.000Z", reason: null } }] }));
    const page = await invoices.list({ limit: 50 });
    expect(page.items[0]).toMatchObject({ customerName: "Customer", serviceDescription: "Consulting", nfseNumber: 123 }); expect(page.hasMore).toBe(false);
    expect((await invoices.events("invoice-1")).items[0]).toMatchObject({ from: "processing", to: "authorized", at: invoice.props.createdAt });
```

Add `it("creates invoices by unwrapping data.props")`: mock `reply({ data: invoice }, 202)` then `expect(await invoices.create({ ... } as never, "idem-1")).toMatchObject({ nfseNumber: 123 })`.

- [ ] **Step 2: Verify failure** — `yarn vitest run tests/api.test.ts` → FAIL.
- [ ] **Step 3: Implement** — `lib/api.ts`:

```ts
export interface InvoiceQuery { limit?: number; cursor?: string; companyId?: string; status?: InvoiceStatus; from?: string; to?: string; externalId?: string }
export const invoices = {
  list: async (params: InvoiceQuery = {}, signal?: AbortSignal) => {
    const page = toPage(await request<{ data: { props: InvoiceWire }[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } }>(`/invoices${query(params)}`, { signal }));
    return { ...page, items: page.items.map(adaptInvoice) };
  },
  get: async (id: string, signal?: AbortSignal) => adaptInvoice(unwrap(await request<{ data: { props: InvoiceWire } }>(`/invoices/${idPath(id)}`, { signal }))),
  create: async (data: CreateInvoiceInput, idempotencyKey: string) => adaptInvoice(unwrap(await request<{ data: { props: InvoiceWire } }>("/invoices", { ...json(data), headers: { "idempotency-key": idempotencyKey } }))),
  xml: (id: string) => request<Blob>(`/invoices/${idPath(id)}/xml`, {}, true),
  pdf: (id: string) => request<Blob>(`/invoices/${idPath(id)}/pdf`, {}, true),
  events: async (id: string, params: { cursor?: string } = {}, signal?: AbortSignal) => {
    const page = toPage(await request<{ data: { props: { id: string; invoiceId: string; fromStatus: InvoiceStatus | null; toStatus: InvoiceStatus; createdAt: string; reason: string | null } }[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } }>(`/invoices/${idPath(id)}/events${query(params)}`, { signal }));
    return { ...page, items: page.items.map(({ props }) => ({ id: props.id, invoiceId: props.invoiceId, from: props.fromStatus, to: props.toStatus, at: props.createdAt, reason: props.reason }) satisfies InvoiceEvent) };
  },
  downloadUrl: async (id: string, format: "pdf" | "xml") => unwrap(await request<{ data: { downloadUrl: string; expiresAt: string; fileName: string; mimeType: string } }>(`/invoices/${idPath(id)}/download-url`, json({ format }))),
  email: async (id: string, idempotencyKey: string) => unwrap(await request<{ data: { emailId: string; status: string } }>(`/invoices/${idPath(id)}/email`, { ...json({}), headers: { "idempotency-key": idempotencyKey } })),
};
```

New hook `lib/use-cursor-pagination.ts`:

```ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "./api";

export function useCursorPagination<T>(fetcher: (cursor?: string) => Promise<Page<T>>, deps: unknown[]) {
  const [items, setItems] = useState<T[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useCallback(async () => {
    setLoading(true); setError(false);
    try { const page = await fetcher(undefined); if (!alive.current) return; setItems(page.items); setNextCursor(page.nextCursor); setHasMore(page.hasMore); }
    catch { if (alive.current) { setItems([]); setError(true); } }
    finally { if (alive.current) setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); }, [run]);
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try { const page = await fetcher(nextCursor); if (!alive.current) return; setItems((rows) => [...(rows ?? []), ...page.items]); setNextCursor(page.nextCursor); setHasMore(page.hasMore); }
    catch { if (alive.current) setError(true); }
    finally { if (alive.current) setLoadingMore(false); }
  }, [fetcher, nextCursor, loadingMore]);
  const reset = useCallback(() => { setItems(null); setNextCursor(null); setHasMore(false); void run(); }, [run]);
  return { items, hasMore, loading, loadingMore, error, loadMore, reset };
}
```

- [ ] **Step 4: Fix consumers** — `app/app/invoices/page.tsx`: replace the `.then(res => { setInvoices(res.data); setCursor(res.next_cursor) })` fetch and the `cursor &&` load-more button with the hook (`const { items: invoices, loading, loadingMore, hasMore, loadMore } = useCursorPagination((cursor) => invoicesApi.list({ ...filters, cursor, limit: 50 }), [filters…])`; keep the existing dedup unnecessary — server cursor won't duplicate). `app/app/page.tsx:40`: placeholder becomes `{ items: [], hasMore: false, nextCursor: null }` and the real call consumes `res.items`.
- [ ] **Step 5: Verify** — `yarn vitest run && yarn typecheck` → green; `yarn lint` → no new errors (the eslint-disable above is required for the deps array pattern).
- [ ] **Step 6: Commit — SKIPPED.**

---

### Task 5: Webhooks + members + apiKeys namespaces

**Files:**
- Modify: `lib/api.ts:108-112,166-181`
- Modify: `app/app/webhooks/page.tsx:73` (deliveries params)
- Test: `tests/api.test.ts`

**Interfaces (Produces):**
- `webhooks.list(): Promise<Page<WebhookEndpoint>>`; `webhooks.deliveries(params?: { hours?: number; limit?: number; cursor?: string; environment?: string }): Promise<Page<WebhookDelivery>>`; `create/delete/test/retryDelivery/deliveryStats` unwrap `data`.
- `members.list(): Promise<Page<Member>>`; `apiKeys.list(): Promise<Page<ApiKey>>`; create/delete unwrap `data`.

- [ ] **Step 1: Update test** — in the "adapts nested snake-case billing and direct webhooks versus enveloped memberships" test change mocks to new shapes:

```ts
    fetchMock.mockResolvedValueOnce(reply({ data: { plan: { slug: "free", name: "Free", monthly_price_cents: 0 }, usage: { credits_used: 2, credits_reserved: 1, credits_remaining: 97, monthly_allowance: 100, daily_usage: 2, daily_limit: 10, active_companies: 1, max_active_companies: 1, period_start: "2026-10-01T00:00:00Z" } } })).mockResolvedValueOnce(reply({ data: [{ id: "wh-1", events: ["nfse.invoice.authorized"] }], pagination: { hasMore: false, nextCursor: null } })).mockResolvedValueOnce(reply({ data: [{ id: "user-1", email: "person@example.com" }], pagination: { hasMore: false, nextCursor: null } })).mockResolvedValueOnce(reply({ data: [{ id: "key-1", name: "prod" }], pagination: { hasMore: false, nextCursor: null } }));
    expect(await billing.plan()).toMatchObject({ slug: "free", usage: { creditsUsed: 2, creditsRemaining: 97, periodStart: "2026-10-01T00:00:00Z" } });
    expect((await webhooks.list()).items[0].id).toBe("wh-1"); expect((await members.list()).items[0].id).toBe("user-1"); expect((await apiKeys.list()).items[0].id).toBe("key-1");
```

Add a test for `webhooks.deliveries` returning a page with `nextCursor` and `retryDelivery` unwrapping `{ data: { retried: true } }`.

- [ ] **Step 2: Verify failure** — `yarn vitest run tests/api.test.ts` → FAIL.
- [ ] **Step 3: Implement** — mirror Task 3/4 patterns:

```ts
export const webhooks = {
  list: async () => toPage(await request<{ data: WebhookEndpoint[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } }>("/webhooks")),
  create: async (data: { url: string; events: WebhookEvent[] }) => unwrap(await request<{ data: WebhookEndpoint }>("/webhooks", json(data))),
  delete: async (id: string) => unwrap(await request<{ data: { deleted: boolean } }>(`/webhooks/${idPath(id)}`, { method: "DELETE" })),
  test: async (id: string) => unwrap(await request<{ data: { sent: boolean } }>(`/webhooks/${idPath(id)}/test`, { method: "POST" })),
  deliveries: async (params: { hours?: number; limit?: number; cursor?: string; environment?: string } = {}) => toPage(await request<{ data: WebhookDelivery[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } }>(`/webhooks/deliveries${query(params)}`)),
  deliveryStats: async (hours = 24, environment = "live") => unwrap(await request<{ data: DeliveryStats }>(`/webhooks/deliveries/stats${query({ hours, environment })}`)),
  retryDelivery: async (id: string) => unwrap(await request<{ data: { retried: boolean } }>(`/webhooks/deliveries/${idPath(id)}/retry`, { method: "POST" })),
};
``` `members.list` and `apiKeys.list` likewise → `toPage(...)`; their create/delete → `unwrap(...)`.

- [ ] **Step 4: Fix consumers** — `app/app/webhooks/page.tsx`: `webhooks.deliveries({ hours: 24, limit: 50, environment: envFilter })` result → `.items` for `setDeliveries`; if the page shows a delivery count/hasMore, use `hasMore`/`nextCursor` (add a "Load more" button only if the page already paginates; otherwise single page is acceptable — check the page). `app/app/api-keys/page.tsx`, `app/app/members/page.tsx`: `.data`/direct-array reads → `.items`.
- [ ] **Step 5: Verify** — `yarn vitest run && yarn typecheck && yarn lint` → green.
- [ ] **Step 6: Commit — SKIPPED.**

---

### Task 6: Credits + billing namespaces and billing UI (CORRECTED)

**Files:** `lib/api.ts`, `lib/types.ts`, `app/app/billing/page.tsx`, `app/app/billing/success/page.tsx`, `app/app/billing/cancel/page.tsx`, `messages/{en,pt}.json` (`Billing.*`), `tests/api.test.ts`.

**Interfaces:** `credits.balance()` → `{tenantId,balance,overageUnits,overageAmountCents,hardLimit}`; `credits.history(params)` / `plans.list(cycle, params)` → `Page<T>`; `billing.checkout(planSlug, idempotencyKey)` → `{sessionId,url}`; `billing.checkoutStatus(id)`; `billing.portal()` → `{url}`; `billing.changePlan(slug, "upgrade"|"downgrade")` → `{scheduledPlan,effectiveAt}`. **No `purchasePreview`/`purchaseConfirm`** (backend 410).

- [x] Tests with real shapes (checkout header + body, portal, change plan, status, balance, history cursor).
- [x] Billing page: plans grid with Subscribe / Upgrade / Downgrade (permission `billing.manage`), "Manage billing" when a subscription exists, scheduled-plan / cancel-at-period-end / blocked / overage notices, 429 and 409 toasts.
- [x] `/app/billing/success` polls `checkoutStatus` (3s, 10 tries) until `activated`; `/app/billing/cancel` redirects back.

---

### Task 7: Docs PT content — contract sections + envelopes

**Files:**
- Modify: `lib/docs/content/pt.ts`

**Source of truth:** `corvo-backend/docs/api/http-contract.md` + `route-contract-matrix.md` (paths above). The parity test currently passes (17/17) — it must STILL pass after your edits (structure: block kinds per page, table row counts, endpoint method+path lists must stay identical to `en.ts`).

**Edits (PT):**

1. **Home response-formats table** (`pages.home`): rewrite rows to the new envelopes:
   - Objeto/ação/nulo → `` `{ "data": Company }` `` style per resource; invoices row → `` `{ "data": Invoice }` `` with text note that the JSON da nota mantém o formato interno `props` (o envelope da API é `data.props`).
   - Add ONE new table row: `["Listagens", "`{ \"data\": [...], \"pagination\": { \"limit\", \"hasMore\", \"nextCursor\" } }`"]` — this changes the table row count in BOTH trees (mirrored in Task 8).
   - Add a text block after the table: cursor pagination pointer to the Pagination guide.
2. **Home status-code note**: update the "POST sem `@HttpCode` retorna 201" text to add: listagens retornam `data` + `pagination`; erros seguem `{ statusCode, code, message, details?, requestId }`.
3. **`pagination` guide**: full rewrite per contract §Sucesso — opaque server cursor, `limit` 1–1000 default 50 (inválido → 400), `hasMore=false` ⇒ `nextCursor=null`, sem `total`/página/offset, mesmo cursor com filtros idênticos, tamanho da página pode mudar mantendo o cursor, cursor sobrevive à exclusão do registro, listagens leem dados atuais (sem snapshot). Update the JS loop example to consume `data`/`pagination` (keep the same block structure: heading+list+heading+list+2 callouts+code block — do NOT change block kinds/counts).
4. **`errors` page**: rewrite to the new body (`statusCode`, `code` string, `message` string única em inglês, `details[]` opcional com `{field, code, message}`, `requestId` ≡ header `X-Request-Id`); decision by `code` + status; expand the status table to the contract table (add rows 410, 413, 415, 5xx group) — mirror row additions in EN (Task 8); 5xx sanitizados; nota: não registrar/credenciais ao reportar requestId.
5. **`rate-limits` page**: rewrite — 300/min por identidade validada (sessão ou API key, somadas entre endpoints), 120/min por IP público, 1200/min pré-auth por IP, janelas fixas de 60s via Redis; headers `X-RateLimit-Limit/Remaining/Reset` (Unix seconds); `Retry-After` em 429; isentos: health, preflight, Stripe. Keep the existing block structure.
6. **`authentication` page**: add ONE text block (both trees, same position — after the key-format text): "O servidor resolve o tenant a partir da API key — não envie `tenantId` nos corpos; recursos de outro tenant retornam `404`."
7. **All 31 endpoint `response.json`/`response.label`**: update envelopes per the matrix:
   - Listings (companies list, certificates list, invoices list, events, webhooks list, deliveries, api-keys list, members list, plans list, credits history/plans): `label: "200 OK"`, json = `{ "data": [ … ], "pagination": { "limit": 50, "hasMore": false, "nextCursor": null } }` (trim item lists with `"..."` where long).
   - Objects/actions: wrap in `"data"` (certificates upload → `{ "data": Certificate }`; webhooks create → `{ "data": … }`; invoice create → `{ "data": { "props": … } }` with 202 label already set; billing upgrade/downgrade → label `200 OK` per matrix; purchase preview stays 201).
   - 204s unchanged (empty json).
   - GET single objects (company get, invoice get): `{ "data": … }` / `{ "data": { "props": … } }`.
8. **Error mentions in notes**: where notes say "retorna `409`" etc. these stay (status codes unchanged); only bodies/envelopes change. Also update any note describing the OLD error body (`error` field) if present — grep `\"error\"` in the tree.
9. **Integration checklist / async-issuance**: grep for `offset`, `page=`, `total`, `next_cursor`, old envelopes — fix any hits per the contract.

- [ ] **Step 1: Read the two backend contract docs fully.**
- [ ] **Step 2: Apply edits 1–9 to `pt.ts`.**
- [ ] **Step 3: Verify** — `yarn typecheck` clean; `yarn vitest run tests/docs-parity.test.ts` — expected to FAIL on structure until Task 8 mirrors the structural changes (row counts); record exactly which assertions fail and WHY (they are the contract for Task 8).
- [ ] **Step 4: Commit — SKIPPED.**

---

### Task 8: Docs EN content — mirrored contract updates

**Files:**
- Modify: `lib/docs/content/en.ts`

**Interfaces:**
- Consumes: the PT edits from Task 7.
- Produces: EN tree with IDENTICAL structure (same block kinds/order, same table row counts, same endpoints) and the same envelope updates, in natural technical English.

- [ ] **Step 1: Read the PT diff** (`git diff lib/docs/content/pt.ts` — no-commit policy: read the current file and compare with your memory of Task 7's edit list; or read both trees side by side per page) and the backend contract docs.
- [ ] **Step 2: Mirror every Task 7 edit in `en.ts`** — home table rows + pointer text + status note, pagination guide rewrite (same blocks), errors page (status table rows must match PT exactly), rate limits, auth tenant block (same position), all 31 response envelopes (identical JSON bodies — JSON is language-neutral; labels like `"200 OK"` stay), integration/async greps.
- [ ] **Step 3: Verify** — `yarn vitest run tests/docs-parity.test.ts` → 17/17 PASS; `yarn typecheck` clean.
- [ ] **Step 4: Commit — SKIPPED.**

---

### Task 9: 429 rate-limit toast in dashboard

**Files:**
- Modify: pages/catch blocks that surface `ApiError` (invoices load, companies load, webhooks load, billing actions) — the shared pattern: wherever `catch (error)` currently toasts a generic failure, special-case 429.
- Modify: `messages/en.json`, `messages/pt.json` (add `Common.rateLimited` key: EN "Too many requests. Try again in {seconds}s." / PT "Muitas requisições. Tente novamente em {seconds}s.") — use FormatJS `{seconds}` brace syntax (single braces; the repo uses `'{N}'`-style escaping per team memory — CHECK an existing interpolated key in messages for the exact pattern before writing).
- Note: if pages already share a toast helper for API errors, put the 429 branch there once; otherwise add it per page catch (keep it 3 lines: `if (error instanceof ApiError && error.status === 429) return toast.error(t("Common.rateLimited", { seconds: error.retryAfterSeconds ?? 60 }));`).

- [ ] **Step 1: Read `app/app/invoices/page.tsx` and `app/app/companies/page.tsx` catch blocks + `messages/en.json` `Common` namespace; identify the shared pattern.**
- [ ] **Step 2: Implement the 429 branch + i18n keys in both languages.**
- [ ] **Step 3: Verify** — `yarn typecheck && yarn lint` clean; `yarn test` green; visually the pages are unchanged for non-429 errors.
- [ ] **Step 4: Commit — SKIPPED.**

---

### Task 10: Final verification (live backend)

**Files:** none (verification only).

- [ ] **Step 1: Full gate** — `yarn typecheck && yarn lint && yarn test && yarn build` → all clean/pass. (`yarn test` includes the docs parity 17/17 and the updated `tests/api.test.ts`.)
- [ ] **Step 2: Live dashboard smoke (dev server port 4000, backend live)** — for each route: `/app` (overview KPIs load), `/app/invoices` (table renders + "Load more" appears when >50), `/app/companies` (load more), `/app/webhooks` (deliveries render), `/app/billing` (plan loads; portal/checkout buttons present), `/app/api-keys`, `/app/members`. Assert no console-level failures via page HTML fetch (`curl -s localhost:4000/app/invoices | grep -c "error"` sanity) and no `undefined` visible strings. If auth requires a session cookie, verify at minimum that the routes compile/return 200/307 and report that authenticated flows need a manual login pass.
- [ ] **Step 3: Docs smoke** — 28 route loop (from the previous plan's Task 11) all 200; `/pt/docs/pagination` shows the new cursor text (`grep nextCursor`); `/en/docs/errors` shows `requestId`; parity 17/17.
- [ ] **Step 4: Report** — gates run, live-backend findings, any item needing manual authenticated testing.

---

## Self-Review Notes (written at plan time)

- **Spec coverage:** ApiError/requestId/details → Task 1; unwrap/toPage/Page → Task 2; namespaces (companies, certificates, invoices, webhooks, members, apiKeys, credits, billing) → Tasks 3–6; useCursorPagination + invoices/companies load-more → Tasks 3–4; new features (checkout/portal/credits purchase/plans) → Task 6 with backend DTO lookup (no invented fields); docs 7 sections + 31 envelopes → Tasks 7–8; 429 Retry-After UI → Task 9; live validation + build → Task 10. `plans.quote` explicitly out of scope (spec).
- **Placeholder scan:** Task 6 intentionally defers DTO field names to backend reading (spec mandate — inventing them is the greater failure mode); all other code is fully written above. The `…` inline types in Task 5 are called out as "spell out the real type".
- **Type consistency:** `Page<T>`, `unwrap`, `toPage`, `ApiError(status, message, code, retryAfterSeconds, details, requestId)` used identically across all tasks; hook signature `useCursorPagination<T>(fetcher, deps)` consumed only in Task 4.
