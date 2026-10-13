# HTTP Contract Adaptation — Design Spec

**Date:** 2026-10-11
**Status:** Approved (approach A + docs update)
**Source of truth (backend):** `corvo-backend/docs/api/http-contract.md` (78 lines) and `corvo-backend/docs/api/route-contract-matrix.md` (85 lines). Backend with the new contract is LIVE — the dashboard must work against it.

## What changed in the backend contract

1. **Success envelopes:** all REST successes wrap the result in `{ "data": ... }`. Resource content is preserved — invoices remain `data.props` internally. Read `data` exactly once.
2. **Listings:** `{ "data": [...], "pagination": { "limit", "hasMore", "nextCursor" } }`. Cursor-based: first call `?limit=50` (default 50, allowed 1–1000, invalid → 400), continuation sends previous `nextCursor` with the same filters. `hasMore: false` ⇒ `nextCursor: null`. No `total`, no `page`/`pageSize`/`offset` (removed). Cursor is opaque, belongs to collection+tenant+filters; page size may change while keeping the cursor.
3. **Errors:** `{ statusCode, code, message, details?, requestId }`. `message` is always a single English string. `details` optional: validation = `[{field, code, message}]`; application = typed public objects. No separate `error` field. Decide by `code` + HTTP status. `requestId` corresponds to the `X-Request-Id` header.
4. **Statuses explicit:** 200/201/202 success, 204 no body, 400 input/pagination, 401/403 auth, 404 not-found (incl. other tenants), 409 conflict, 422 fiscal/business rule, 429 rate limit, plus 410/413/415/5xx.
5. **Rate limit:** 300/min per validated identity (session or API key), 120/min per public IP, route-specific budgets additive. Headers `X-RateLimit-Limit/Remaining/Reset`, `Retry-After` on 429.
6. **Tenant:** server resolves tenant from auth; clients must NOT send `tenantId` in bodies. Cross-tenant resources → 404.
7. **Unchanged formats:** PDF/XML blobs, redirects, OAuth, MCP/JSON-RPC, health checks, 204s, Stripe webhook.

New/changed endpoints (shapes verified against `corvo-backend/src` controllers, not just the matrix):

| Route | Input | `data` |
|---|---|---|
| `POST /billing/checkout` (`/billing/subscribe` is an alias, 201) | `{plan_slug: developer\|growth\|scale\|volume}` + **required `Idempotency-Key` header** | `{session_id, url}` |
| `GET /billing/checkout/:sessionId` | — | `{session_id, status, payment_status, activated}` |
| `POST /billing/portal` (200) | — | `{url}` |
| `POST /billing/upgrade` / `/downgrade` (200) | `{plan_slug}` (also `free`) | `{scheduled_plan, effective_at}` |
| `GET /credits` | — | `{tenantId, balance, overageUnits, overageAmountCents, hardLimit}` |
| `GET /credits/plans`, `/credits/history` | cursor query | `data + pagination` |
| `POST /credits/purchase/preview` and `/confirm` | — | **always 410 `ERROR_GONE`** — avulso credit purchase was replaced by monthly subscriptions + billed overage. Do NOT build a purchase flow. |

Billing business errors (409): `customer_required` (portal without Stripe customer), `subscription_required` (upgrade/downgrade without subscription), `subscription_exists` (checkout while subscribed), expired checkout (needs a new Idempotency-Key). Real error codes seen in `shared/http/api-error.ts`: `ERROR_RATE_LIMIT_EXCEEDED` (429), `ERROR_INVALID_LIMIT`/`ERROR_INVALID_CURSOR` (400), `ERROR_PAYMENT_REQUIRED` (402), `ERROR_INSUFFICIENT_CREDITS`, `ERROR_QUOTA_EXCEEDED`, `ERROR_CERTIFICATE_*`, `ERROR_COMPANY_NOT_READY`/`_BLOCKED`/`_ALREADY_EXISTS`, `ERROR_DUPLICATE_INVITATION`, `ERROR_LAST_TENANT_ADMIN`, `ERROR_GONE` (410). CSRF 403s map to generic `ERROR_FORBIDDEN`; detection stays by message (`/CSRF token/i`).

## Scope (confirmed with user)

- **Dashboard:** adapt existing functionality AND enable the new backend features (credit purchase via Stripe, billing portal, plan quote). Validate against the live backend.
- **Docs:** update both content trees (`lib/docs/content/{pt,en}.ts`) to the new contract. Endpoint tables/params/scopes/cURL examples stay; envelopes, pagination guide, errors, rate limits, and the 31 response examples change.
- Pagination UI: **"Load more" button** using server `nextCursor` (no infinite scroll, no page numbers).

## Dashboard design (approach A — central helpers)

### `lib/api.ts`

- `request<T>` unchanged in behavior (proxy, CSRF, env header, 204 → null, binary). Error path updated:
  - `ApiError` gains `requestId?: string` and types `details` as `ApiErrorDetail[] | undefined` (`{ field: string; code: string; message: string }`).
  - `responseError` reads the new shape: `message` string only (no array joining), `code`, `details`, `requestId`. Falls back to `Request failed (${status})`.
- New tiny helpers (single unwrap, per contract):
  - `interface Page<T> { items: T[]; hasMore: boolean; nextCursor: string | null }`
  - `function unwrap<T>(body: { data: T } | null): T` — throws `ApiError(502)` if `data` missing.
  - `function toPage<T>(body: { data: T[]; pagination?: { hasMore: boolean; nextCursor: string | null } } | null): Page<T>` — tolerant when `pagination` absent (falls back to `hasMore: false`).
- Namespace changes:
  - `companies.list({ limit?, cursor? }) → Page<Company>` (cursor from server, not client).
  - `certificates.list(companyId, { cursor? }) → Page<Certificate>`; `create` unwraps `data`; `delete` → 204 (no body).
  - `invoices.list(params incl. cursor) → Page<Invoice>` — drop client-side cursor fabrication (`createdAt` hack) and `Math.min(100…)` clamp; server validates. `get`/`create` unwrap `data` then `adaptInvoice` on `data.props`. `events` → `Page<InvoiceEvent>` via `data.props`. `xml`/`pdf` blobs unchanged. `downloadUrl`/`email` already unwrap `data` — keep.
  - `credits.balance` unwraps `data`; `credits.history({ cursor?, limit? }) → Page<CreditTransaction>` (offset removed); `credits.plans()` new → `Page<CreditPlan>`; `credits.balance` → `data` `{tenantId,balance,overageUnits,overageAmountCents,hardLimit}`. `purchasePreview` is removed from the client (backend returns 410).
  - `plans.list(cycle)` → keep the existing unwrap but tolerate the pagination wrapper (list shape). `plans.quote` stays out of scope — no UI consumer yet.
  - `billing.plan/usage` unwrap `data` as today.
  - `webhooks.list() → Page<WebhookEndpoint>`; `create/delete/test/retryDelivery` unwrap `data`; `deliveries({ cursor?, limit?, ... }) → Page<WebhookDelivery>` (offset→cursor); `deliveryStats` unwraps `data`.
  - `members.list() → Page<Member>`; `invite/remove` unwrap `data`.
  - `apiKeys.list() → Page<ApiKey>`; `create/delete` unwrap `data`.
  - `billing.checkout(planSlug, idempotencyKey) → {sessionId, url}`; `billing.checkoutStatus(sessionId)`; `billing.portal() → {url}`; `billing.changePlan(planSlug) → {scheduledPlan, effectiveAt}` (snake_case wire → camelCase). Inner shapes verified from backend controllers (see table above).
- `useCursorPagination` hook (`lib/use-cursor-pagination.ts`): holds `items`, `nextCursor`, `hasMore`, `loading`, `loadingMore`, `error`; `loadMore()` appends; `reset()` on filter change. Used by invoices, companies, webhooks deliveries, credits history tables.

### Pages

- **Invoices list** (`app/app/invoices/page.tsx`): "Load more" button replaces the old next-cursor row logic; filters keep `limit`+`cursor` semantics.
- **Companies** (`app/app/companies/page.tsx`): load more.
- **Webhooks** deliveries table: load more (cursor replaces offset params).
- **Credits** (`app/app/credits/…` if exists / billing page usage section): history via cursor; **no purchase flow** (backend 410): show balance, overage and history only; paid capacity comes from plan subscription.
- **Billing** (`app/app/billing/page.tsx`): "Manage billing" → `billing.portal()` redirect (409 `customer_required` → prompt to subscribe); subscribe → `billing.checkout` (fresh `Idempotency-Key` per attempt, redirect to `url`); with an active subscription use `changePlan` (shows scheduled plan + effective date); return from Stripe polls `checkoutStatus` until `activated`.
- **Error surfacing**: field errors from `details[]` (map to form fields where the form exists); `code`-driven toasts; 429 shows a rate-limit toast honoring `Retry-After` (seconds countdown or "try again in Ns"); 404 from other tenant treated as "not found" (no special casing).

### Tests

- `tests/api.test.ts` (exists): update for unwrap/toPage/error parsing; add cases: list envelope → Page, missing pagination fallback, error with details/requestId, message as string, 204 → null.
- Page-level behavior verified manually against the live backend (dev server, port 4000) plus `yarn typecheck`/`yarn lint`/`yarn test`.

## Docs design

Both trees keep identical structure (parity test enforces). Content edits:

1. **Home** (`pages.home`):
   - Response-formats table: every REST success row → `{ "data": ... }`; invoices row becomes `{ "data": Invoice }` with note that the invoice keeps its internal `props` shape (`data.props` in API-key JSON). Add a listings row: `{ "data": [...], "pagination": {...} }`.
   - Add short paragraph: cursor pagination pointer (link-style mention of the Pagination guide).
2. **`pagination` guide**: full rewrite — opaque server cursors, `limit` 1–1000 default 50, `hasMore`/`nextCursor`, same filters on continuation, no total/pages/offset, cursor survives record deletion, page-size change allowed, keep the JS loop example updated to the server envelope.
3. **`errors` page**: new error body (statusCode/code/message/details/requestId), `code`-first decisions, validation details example, status table from the contract (add 410/413/415/5xx rows), `X-Request-Id` note.
4. **`rate-limits` page**: 300/min identity, 120/min IP, additive route budgets, `X-RateLimit-*` headers, `Retry-After` on 429, exemptions (health/preflight/Stripe).
5. **`authentication` page**: add "server resolves the tenant from the key — never send `tenantId`" note (this replaces the earlier removed copy, now it IS contract-relevant); keep key format, headers, environments, scopes.
6. **All 31 endpoint response examples**: update `response.json` envelopes per the matrix (`data` for objects; `{data, pagination}` for listings: companies, certificates list, invoices list, events, webhooks list, deliveries, credits history, plans, api-keys, members; 204s stay bodyless). Success status codes follow the matrix (e.g. billing upgrade/downgrade are `200`, not `201`; purchase preview is `201`).
7. **Integration checklist / async guides**: touch only where they reference removed formats (offset, fabricated cursors, old error bodies).

Verification: parity test (17/17), typecheck, lint, full vitest suite, production build, route smoke (28 routes), visible-HTML checks; dashboard validated against the live backend on port 4000.

## Out of scope

- MCP/OAuth/Stripe-webhook protocol surfaces (native formats, dashboard doesn't consume them).
- `plans.quote` UI (no current consumer).
- Any credit purchase UI (backend 410).
- Webhook signature format changes (none in this contract).
