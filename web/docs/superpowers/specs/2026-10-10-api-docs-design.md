# Corvo API Docs — Design Spec

**Date:** 2026-10-10
**Status:** Approved
**Source of truth:** `corvo-backend/docs/api-key-reference.md` (658 lines, 31 operations, verified against local controllers on 2026-10-10; not validated against production)

## Goal

Replace the current flat `/[locale]/api-docs` page with a full, beautiful, bilingual developer documentation section at `/[locale]/docs`, documenting the **API-key integration API only** (31 operations). Portal/session authentication (magic-link, CSRF, cookies) does not appear anywhere in the docs. Reference style: AbacatePay / Stripe / Resend — sidebar navigation, endpoint cards, code windows with cURL and JavaScript tabs.

## Decisions (confirmed with user)

| Decision | Choice |
|---|---|
| Structure | Multi-page with fixed sidebar, real URLs per section |
| Language | Bilingual EN + PT-BR (PT is canonical source, EN is translation) |
| Code examples | cURL + JavaScript (tabs) |
| Route | New `/[locale]/docs`; **no redirect** from old `/api-docs` (page deleted, pointers updated) |
| Approach | Data-driven: typed TS content trees + generic server-component renderers |

## Route map

```
app/[locale]/docs/
├── layout.tsx             ← docs chrome: sidebar + header (server component + client drawer)
├── page.tsx               ← Introduction / quickstart
└── [...section]/page.tsx  ← catch-all; renders any section from data
```

Catch-all chosen to allow future sub-pages (e.g. `/docs/webhooks/signature`) without new route files. All pages are **server components** with `generateStaticParams` (13 slugs × 2 locales, plus the home page). Only the mobile sidebar drawer and code-window language tabs are client components.

## Sidebar structure

Groups with mono uppercase labels and dividers (Resend-style):

- **GETTING STARTED** — Introduction (`/docs`) · Authentication · Errors · Rate limits
- **REFERENCE** — Companies · Certificates · Invoices · Webhooks · Credits · Billing
- **GUIDES** — Async issuance & idempotency · Pagination · Receiving webhooks · Integration checklist

Active item: `--accent` text + left border. Locale switch (EN/PT) links to the same section in the other locale. Mobile: drawer (existing dashboard pattern).

## Content mapping (reference §1–13 → docs pages)

| Reference section | Docs page | Group |
|---|---|---|
| 1. Conexão e autenticação + ambientes + escopos | `/docs/authentication` | Getting Started |
| 2. Inventário completo | Summary table in `/docs` Introduction | Getting Started |
| 3. Formatos de resposta (`data` vs `props` envelopes) | Block in Introduction | Getting Started |
| 4. Empresas (5 ops) | `/docs/companies` | Reference |
| 5. Certificados (3 ops) | `/docs/certificates` | Reference |
| 6. Notas fiscais (10 ops + Invoice schema) | `/docs/invoices` | Reference |
| 7. Webhooks (7 ops) | `/docs/webhooks` (config API) | Reference |
| 7. Recebimento, assinatura, repetição | `/docs/receiving-webhooks` | Guides |
| 8. Créditos (4 ops) | `/docs/credits` | Reference |
| 9. Plano e cotas (4 ops) | `/docs/billing` | Reference |
| 10. Erros | `/docs/errors` | Getting Started |
| 10. Rate limit | `/docs/rate-limits` | Getting Started |
| 11. Rotas fora desta API | **Excluded** — no portal/session routes in docs | — |
| 12. Sequência de integração | `/docs/integration-checklist` | Guides |
| 6/10 (split out) | `/docs/async-issuance` (async emission + idempotency) | Guides |
| 3 (split out) | `/docs/pagination` | Guides |

13 slugs total + Introduction = 14 pages.

## Data architecture

```
lib/docs/
├── types.ts        ← DocPage, EndpointBlock, CodeExample, ParamRow, TableBlock, CalloutBlock, ProseBlock
├── content/
│   ├── en.ts       ← English tree
│   └── pt.ts       ← PT-BR tree (canonical, transcribed from reference)
└── registry.ts     ← slug → { group, order } per locale; feeds sidebar + catch-all + generateStaticParams
```

- Both trees typed against the **same interfaces** — structural divergence (an endpoint present in PT but missing in EN) is a compile error.
- `EndpointBlock` fields: `method`, `path`, `scopes`, `successStatus`, description, params (required/optional/validation), `examples: { curl, node }`, `response` (JSON + status label), callouts/notes.
- Docs chrome labels (sidebar groups, page titles) live in the docs content trees — **no new next-intl namespaces**. Locale read from `params.locale`.

## Visual design (existing tokens only, no new colors)

- **EndpointCard**: left border colored by method (POST/GET = `--accent`, DELETE = `--danger`, PATCH = `--warn`); header with `font-mono` method + path, scope badges, success status.
- **CodeWindow**: terminal-style window with three dots, **cURL / JavaScript** tabs, copy button; response JSON block below with status label (e.g. `201 Created`).
- **Tables** (params, schemas, events, errors): `border-border bg-surface` styling as in the current catalog.
- **Callouts**: existing `.banner-warn` / `.banner-accent` / `.banner-danger` classes.
- Typography: `font-sans` prose, `font-mono` paths/fields. Minimal docs header: Corvo wordmark, breadcrumb "Docs / Section", EN/PT switch. No search in v1.

## Migration

1. Delete `app/[locale]/api-docs/` and `lib/api-catalog.ts` (verify no other importers first).
2. Update pointers from `/api-docs` to `/docs`: `components/landing/hero.tsx`, `components/landing/nav.tsx`, `components/landing/footer.tsx`, `components/dashboard/topbar.tsx`, `app/not-found.tsx`, `app/robots.ts`.

## Verification

- `tsc --noEmit` clean; ESLint clean on new files.
- Vitest parity test: EN/PT trees have identical slugs and per-page endpoint counts (guards content drift).
- Smoke: all 28 routes (14 pages × 2 locales) return HTTP 200.
- Visual check of `/docs` and `/docs/invoices` at desktop and 375px width.
