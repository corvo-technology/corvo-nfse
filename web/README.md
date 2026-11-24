# Corvo NFS-e — Web

<p>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb" />
  <img alt="License: AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-blue" />
</p>

The Corvo website, API reference and dashboard. Part of the [Corvo monorepo](../README.md); the backend is in [`api/`](../api/README.md).

## 📑 Contents

- [🧱 Stack](#-stack)
- [🗺️ What is here](#-what-is-here)
- [🚀 Quick start](#-quick-start)
- [⌨️ Commands](#-commands)
- [🔧 Configuration](#-configuration)
- [🗂️ Code layout](#-code-layout)
- [📚 Documentation content](#-documentation-content)
- [🔎 SEO](#-seo)
- [🧪 Testing](#-testing)
- [🐳 Docker](#-docker)

## 🧱 Stack

Next.js 16 (App Router) with React 19, Tailwind CSS 4, `next-intl` for English and Portuguese, Vitest and Playwright.

## 🗺️ What is here

| Area | Route | Notes |
| --- | --- | --- |
| 🌐 Website | `/en`, `/pt` | Landing page with pricing, plus terms, privacy and DPA. |
| 📚 API reference | `/en/docs`, `/pt/docs` | Written as typed content in `lib/docs`. Also served as `/llms.txt` and `/llms-full.txt`. |
| 📊 Dashboard | `/app` | Companies, certificates, invoices, billing, webhooks, API keys, members, AI agents and settings. |
| 🔐 Sign in | `/login` | Email code. |
| 🤖 Agent approval | `/mcp/authorize` | Login and consent screen for AI agents connecting through MCP. |
| 🔁 API proxy | `/api/proxy/v1/*` | Same-origin proxy to the backend (see below). |

## 🚀 Quick start

From the repository root, `yarn setup` installs both applications. Create `web/.env.local` from [.env.example](.env.example). With the backend running (see [`api/README.md`](../api/README.md#-quick-start)):

```bash
yarn dev:web     # http://localhost:4000
```

To run everything in Docker instead, follow the [root README](../README.md#-quick-start).

## ⌨️ Commands

Run inside `web/`, or use the root commands:

| Command | Action |
| --- | --- |
| `yarn dev` | Development server on port 4000. |
| `yarn build` / `yarn start` | Production build and server (port 4000). |
| `yarn lint` | ESLint. |
| `yarn typecheck` | TypeScript check. |
| `yarn test` | Vitest unit and component tests. |
| `yarn test:e2e` | Playwright against a production build on port 4100, with mocked API responses. |

The standalone Docker container listens on port `3000` internally, mapped to host port `4000` in the local stack.

## 🔧 Configuration

Copy [.env.example](.env.example) to `.env.local` for development outside Docker.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Browser API base. Keep `/api/proxy/v1`. |
| `API_BASE_URL` | Server-only upstream origin, without `/v1`. |
| `APP_ORIGIN` | Exact browser origin, checked on mutations. Required over HTTPS in production. |
| `SITE_ACCESS_MODE` | `open` enables login and dashboard; `coming-soon` keeps the site in prelaunch mode. |
| `NEXT_PUBLIC_MCP_URL` | Optional. Address shown to users for the MCP server (defaults to `https://api.corvo.tech/mcp`). |
| `SUPPORT_WHATSAPP_NUMBER` | Optional, read at runtime. Digits with country code (e.g. `5551999999999`). Shows the "Precisa de ajuda?" WhatsApp button in the dashboard. |
| `SUPPORT_WHATSAPP_MESSAGE` | Optional. Prefilled WhatsApp text (default: "Olá! Preciso de ajuda com a Corvo."). |
| `SUPPORT_EMAIL` | Optional. Support e-mail, shown in the Ajuda menu. |
| `COMMUNITY_WHATSAPP_URL` | Optional. Group invite, `https://chat.whatsapp.com/...` or `https://wa.me/...`. |
| `SUPPORT_AVATAR_URL` | Optional. `https://` image shown on the help button. |
| `NEXT_PUBLIC_GA_ID` | Optional analytics, only after consent; never on login or dashboard. |

Browser requests go to `/api/proxy/v1`. The proxy forwards them to `API_BASE_URL`, passes only the session cookie and the CSRF header, and allows only the routes and methods listed in `app/api/proxy/[...path]/route.ts`. Production uses HTTPS so session cookies are secure.

> [!WARNING]
> Integration API keys belong in external clients, never in browser code.

## 🗂️ Code layout

```text
app/[locale]/    website, legal pages and the API reference (en, pt)
app/app/         dashboard (companies, invoices, billing, webhooks, agents, ...)
app/mcp/         agent approval screen
app/api/proxy/   same-origin proxy to the backend
components/      landing, dashboard, docs, legal, SEO and UI primitives
lib/             API client (api.ts), auth, docs content, SEO helpers
messages/        en.json and pt.json (UI text)
tests/           Vitest suites and Playwright specs (tests/e2e)
```

The dashboard is client-rendered and reads the session through the proxy. Keep fiscal rules in the backend and show its HTTP contract errors; do not duplicate them here.

## 📚 Documentation content

The API reference is typed content, not Markdown: `lib/docs/content/en.ts` and `pt.ts` implement `lib/docs/types.ts`, and `lib/docs/registry.ts` sets the page order. English and Portuguese must keep the same structure; `tests/docs-parity.test.ts` enforces it. Adding a page means adding its slug to the types and the registry, and its content to both languages. `lib/docs/to-markdown.ts` renders the same content for `/llms-full.txt`.

## 🔎 SEO

Per-page metadata (canonical, hreflang, Open Graph, Twitter) comes from `lib/seo.ts`. Structured data is rendered with `components/seo/json-ld.tsx`. `app/sitemap.ts` and `app/robots.ts` list every public page in both languages; the dashboard, login and agent approval screens are sent with `noindex`. The share image is `public/open-graph-1200x630.png`.

## 🧪 Testing

Vitest covers the API client, the proxy, authentication, documentation content, SEO helpers and forms. Playwright runs the dashboard against mocked API responses. Neither verifies real issuance or payments.

## 🐳 Docker

Run from the repository root:

```bash
docker build -f deploy/Dockerfile.web -t corvo-web:local .
```

The image uses Next.js standalone output. See [SELF_HOSTING.md](../SELF_HOSTING.md) for the complete stack.
