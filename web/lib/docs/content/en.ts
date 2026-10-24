// lib/docs/content/en.ts
import { SDKS } from "../../sdks";
import type { DocsTree } from "../types";

const enWithRetiredCredits: DocsTree = {
  chrome: {
    homeLabel: "Introduction",
    groups: { gettingStarted: "Getting Started", reference: "Reference", guides: "Guides" },
    copy: {
      copy: "Copy",
      copied: "Copied",
      response: "Response",
      close: "Close",
      menu: "Menu",
      table: { field: "Field", type: "Type", required: "Required", description: "Description" },
    },
    localeSwitch: { en: "English", pt: "Português" },
    notFound: { title: "Page not found", body: "Check the URL." },
  },
  home: {
    title: "Introduction",
    description: "Issue Brazilian NFS-e for MEI and Simples Nacional companies with a REST API or an AI agent (MCP): tax calculation, multiple companies and webhooks.",
    blocks: [
      {
        kind: "text",
        body: "The Corvo API lets you register companies (MEI, Simples Nacional and other regimes), upload A1 certificates, calculate taxes before issuing, issue service invoices (NFS-e) and track their full lifecycle via webhooks. AI agents such as Claude Code, Cursor and Codex can do the same through the MCP server (see AI agents).",
      },
      { kind: "heading", level: 2, body: "Quickstart" },
      {
        kind: "code",
        label: "bash",
        language: "bash",
        code: "export BASE_URL='https://api.corvo.tech/v1'\nexport CORVO_API_KEY='corvo_test_your_key'\n\ncurl \"$BASE_URL/companies\" -H \"X-API-Key: $CORVO_API_KEY\"",
      },
      {
        kind: "text",
        body: "All paths in this documentation are relative to `BASE_URL` (`https://api.corvo.tech/v1`).",
      },
      { kind: "heading", level: 2, body: "Response formats" },
      {
        kind: "text",
        body: "REST successes use `{ \"data\": ... }` and listings add `pagination`. JSON dates are ISO 8601 strings; optional fields may be absent and nullable fields may be `null`.",
      },
      {
        kind: "table",
        head: ["Operation", "JSON format"],
        rows: [
          ["Create, fetch or update a company", "`{ \"data\": Company }`"],
          ["List companies", "`{ \"data\": Company[], \"pagination\": {...} }`"],
          ["Delete a company", "`{ \"data\": null }`"],
          ["Certificate upload / listing", "`{ \"data\": Certificate } / paginated listing`"],
          ["Issue / fetch an invoice", "`{ \"data\": Invoice }`"],
          ["List invoices and events", "`{ \"data\": [ ... ], \"pagination\": {...} }`"],
          ["Download URL / email", "`{ \"data\": ... }`"],
          ["Webhooks and deliveries", "`{ \"data\": ... } or paginated listing`"],
          ["Plan & quotas", "`{ \"data\": ... }`"],
        ],
      },
      {
        kind: "text",
        body: "Resources come directly inside `data`: an invoice is `data`, a list is `data[]`. Read `data` exactly once. PDF/XML, redirects, OAuth, MCP/JSON-RPC, health checks and `204` responses keep their own formats.",
      },
      { kind: "heading", level: 2, body: "All operations" },
      {
        kind: "text",
        body: "All paths below include the default prefix. Status codes represent success according to the HTTP contract matrix; errors follow the `ERROR_*` format described under Errors.",
      },
      {
        kind: "table",
        head: ["Method", "Path", "Function", "Success"],
        rows: [
          ["POST", "`/v1/companies`", "Register a company", "201"],
          ["GET", "`/v1/companies`", "List companies", "200"],
          ["GET", "`/v1/companies/:id`", "Fetch a company", "200"],
          ["PATCH", "`/v1/companies/:id`", "Update a company", "200"],
          ["DELETE", "`/v1/companies/:id`", "Delete a company", "200"],
          ["POST", "`/v1/companies/:companyId/certificates`", "Upload a certificate", "201"],
          ["GET", "`/v1/companies/:companyId/certificates`", "List certificates", "200"],
          ["DELETE", "`/v1/companies/:companyId/certificates/:certId`", "Revoke a certificate", "204"],
          ["POST", "`/v1/invoices`", "Request issuance", "202"],
          ["POST", "`/v1/invoices/calculate`", "Calculate taxes without issuing", "200"],
          ["GET", "`/v1/invoices`", "List invoices", "200"],
          ["GET", "`/v1/invoices/:id`", "Fetch an invoice", "200"],
          ["GET", "`/v1/invoices/:id/xml`", "Download XML", "200"],
          ["GET", "`/v1/invoices/:id/pdf`", "Download PDF", "200"],
          ["GET", "`/v1/invoices/:id/events`", "Fetch event history", "200"],
          ["POST", "`/v1/invoices/:id/download-url`", "Generate a signed URL", "200"],
          ["POST", "`/v1/invoices/:id/email`", "Request email delivery", "202"],
          ["POST", "`/v1/invoices/:id/cancel`", "Cancel an invoice", "200/202"],
          ["GET", "`/v1/webhooks`", "List webhook configurations", "200"],
          ["POST", "`/v1/webhooks`", "Register a webhook", "201"],
          ["DELETE", "`/v1/webhooks/:id`", "Delete a webhook", "200"],
          ["POST", "`/v1/webhooks/:id/test`", "Send a test event", "200"],
          ["GET", "`/v1/webhooks/deliveries`", "List deliveries", "200"],
          ["GET", "`/v1/webhooks/deliveries/stats`", "Fetch delivery statistics", "200"],
          ["POST", "`/v1/webhooks/deliveries/:id/retry`", "Schedule a retry", "200"],
          ["GET", "`/v1/billing/plan`", "Fetch plan and consumption", "200"],
          ["GET", "`/v1/billing/usage`", "Fetch availability and quotas", "200"],
          ["POST", "`/v1/billing/upgrade`", "Schedule a plan change", "200"],
          ["POST", "`/v1/billing/downgrade`", "Schedule a plan change", "200"],
          ["GET", "`/v1/plans`", "List plan prices (public)", "200"],
          ["GET", "`/v1/plans/:slug`", "Fetch one plan price (public)", "200"],
          ["GET", "`/v1/plans/quote`", "Recommend a plan for a volume (public)", "200"],
        ],
      },
      {
        kind: "text",
        body: "IDs in paths represent identifiers of resources returned by the API. Store them as strings; do not use a CNPJ in place of a `:id`.",
      },
      { kind: "heading", level: 2, body: "Integration sequence" },
      {
        kind: "list",
        items: [
          "`POST /v1/companies` — register the company with its CNPJ, tax regime and fiscal municipality (`municipalityCode`); set `defaultServiceCode` to simplify invoices.",
          "In `live`, upload a valid A1 certificate (.p12) matching the CNPJ, with its password (`POST /v1/companies/:companyId/certificates`). The municipal registration is optional: provide it only if the city registered the company in the national registry.",
          "`POST /v1/invoices` — use `companyTaxId` (company CNPJ) to request issuance (the `live` environment requires the company to be ready).",
          "Track the lifecycle with `GET /v1/invoices/:id` and webhooks — issuance is asynchronous.",
        ],
      },
    ],
  },
  pages: {
    sdks: {
      title: "SDKs",
      description: "Official libraries for Node.js, Python, Go, PHP, Ruby, Rust, Java, Elixir and .NET.",
      blocks: [
        { kind: "text", body: "Corvo has official SDKs in nine languages. They call the same API this documentation describes, with the same operations, field names and tax rules, so every guide here applies to all of them." },
        { kind: "heading", level: 2, body: "Install" },
        {
          kind: "table",
          head: ["Language", "Package", "Install", "Source"],
          rows: SDKS.map((sdk) => [sdk.name, `\`${sdk.pkg}\` (${sdk.registry})`, `\`${sdk.install}\``, `\`corvo-technology/${sdk.repo}\``]),
        },
        { kind: "callout", tone: "accent", body: "Start with a test key: invoices issued with a `corvo_test_` key have no fiscal value." },
        { kind: "heading", level: 2, body: "What every SDK does" },
        {
          kind: "list",
          items: [
          "Authenticates with `X-API-Key`. It reads `CORVO_API_KEY`, and `CORVO_BASE_URL` if you use a different API URL.",
          "The key decides the environment: `corvo_test_...` for test and `corvo_live_...` for live.",
          "Errors come back as a typed result with `code`, `status`, `requestId`, `details` and `retryAfter`, not as an exception. The iterate helpers raise when a page fails.",
          "Lists are cursor-paginated, and every SDK has an iterate helper that walks all pages.",
          "Creating an invoice and sending an email accept an idempotency key, sent as `Idempotency-Key`.",
          "Webhook signature verification (`X-Corvo-Signature`) in constant time.",
          ],
        },
        { kind: "heading", level: 2, body: "Issue an invoice" },
        { kind: "text", body: "The same call in each language. Each example reads the key from `CORVO_API_KEY` and passes an idempotency key, so repeating the call never issues the invoice twice." },
        ...SDKS.map((sdk) => ({ kind: "code" as const, label: sdk.name, language: (sdk.id === "node" ? "js" : "text") as "js" | "text", code: sdk.snippet })),
        { kind: "text", body: "Changing plans and the billing portal exist only in the dashboard, so they are not in the SDKs. The source of every SDK is in github.com/corvo-technology." },
      ],
    },
    authentication: {
      title: "Authentication",
      description: "Authenticate every request with an API key.",
      blocks: [
        {
          kind: "text",
          body: "Keys have the format `corvo_test_` or `corvo_live_` followed by 40 lowercase hexadecimal characters.",
        },
        {
          kind: "callout",
          tone: "warn",
          body: "The full key is displayed only at creation.",
        },
        { kind: "heading", level: 2, body: "Headers" },
        {
          kind: "table",
          head: ["Header", "Usage"],
          rows: [
            ["`X-API-Key`", "Required for key authentication."],
            ["`Content-Type: application/json`", "JSON bodies."],
            ["`Idempotency-Key`", "Optional on issuance and email requests; recommended for safe retries of those operations."],
          ],
        },
        {
          kind: "text",
          body: "Certificate upload uses `multipart/form-data`. With `curl -F`, let curl generate the `Content-Type` with the boundary. Downloads return PDF or XML with no JSON envelope.",
        },
        { kind: "heading", level: 2, body: "Environments" },
        {
          kind: "list",
          items: [
            "Companies, certificates and invoices are accessed in the key's persisted environment: `test` or `live`.",
            "In `live`, issuance verifies the company, blocks and active certificate; credits and issuance limits also apply.",
            "In `test`, issuance requires an existing company but skips the readiness and certificate checks of the `live` flow.",
            "Webhook deliveries use the explicit `?environment=test|live` filter; without it, they may return both of the account's environments, regardless of the key's environment.",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Credits, plan and webhook settings belong to the account. A `test` key with `full_access` can manage webhooks and read credits and billing. Plan changes, checkout and the billing portal exist only in the dashboard.",
        },
        { kind: "callout", tone: "accent", body: "The server resolves the account from authentication; resources of another account return `404`." },
        { kind: "heading", level: 2, body: "Scopes" },
        {
          kind: "table",
          head: ["Code used in this reference", "Scope"],
          rows: [
            ["F", "`full_access`"],
            ["I", "`invoices_issue`"],
            ["V", "`invoices_view`"],
            ["RW", "`invoices_read_write`"],
          ],
        },
        {
          kind: "text",
          body: "F accepts every operation listed. I allows issuing and requesting email. V allows fetching invoices, documents, events and download URLs. RW combines invoice issuance and fetching, company fetching, certificate listing, and fetching of webhooks/deliveries/statistics. RW does not allow modifying companies, certificates, webhooks, credits or plans. Even F only reaches API-key-enabled routes; scope permissions do not open other routes.",
        },
        { kind: "heading", level: 2, body: "Example" },
        {
          kind: "code",
          label: "bash",
          language: "bash",
          code: "export BASE_URL='https://api.corvo.tech/v1'\nexport CORVO_API_KEY='corvo_test_your_key'\n\ncurl \"$BASE_URL/companies\" -H \"X-API-Key: $CORVO_API_KEY\"",
        },
      ],
    },
    errors: {
      title: "Errors",
      description: "Error body, `ERROR_*` codes, status codes and retry guidance.",
      blocks: [
        {
          kind: "text",
          body: "Fields not declared in the DTOs are rejected, including inside nested objects. Every REST failure uses the same body; there is no separate `error` field anymore.",
        },
        { kind: "heading", level: 2, body: "Error format" },
        {
          kind: "code",
          label: "json",
          language: "json",
          code: `{
  "statusCode": 400,
  "code": "ERROR_VALIDATION",
  "message": "Request validation failed",
  "details": [
    {
      "field": "customer.taxId",
      "code": "ERROR_INVALID_TAX_ID",
      "message": "Invalid tax ID"
    }
  ],
  "requestId": "9f1fc995-4ee4-4a92-b285-cf8dff227a97"
}`,
        },
        {
          kind: "text",
          body: "Decide by `code` and HTTP status. `message` is always an English string (never an array) meant for diagnostics. `details` is optional: for validation it is an array of `{ field, code, message }`; for application errors it holds typed public objects. `requestId` matches the `X-Request-Id` header and can be quoted to support. `5xx` failures use sanitized messages with no internal details.",
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Errors on PDF/XML downloads follow this contract too. Redirects, OAuth, MCP/JSON-RPC, health checks and `204` responses keep their own formats.",
        },
        { kind: "heading", level: 2, body: "HTTP status codes" },
        {
          kind: "table",
          head: ["HTTP", "Usage"],
          rows: [
            ["200 / 201 / 202", "Action completed / resource created / asynchronous processing accepted."],
            ["204", "Operation completed with no body."],
            ["400", "Invalid DTO, parameter, JSON, UUID, `limit` or cursor."],
            ["401 / 403", "Missing or invalid authentication / access denied (scope, endpoint not enabled for API keys, blocked company)."],
            ["404", "Resource not found, including resources of another tenant."],
            ["409 / 410", "Conflict (duplicate CNPJ, idempotency conflict, documents not ready yet) / resource retired."],
            ["413 / 415", "Payload too large / unsupported encoding."],
            ["422", "Fiscal validation in the domain or a rejected business rule (readiness, certificate, quota)."],
            ["429", "Rate limit or cooldown; honor `Retry-After`."],
            ["500 / 502 / 503 / 504", "Internal error / invalid dependency / unavailability / timeout."],
          ],
        },
        { kind: "heading", level: 2, body: "Common codes" },
        {
          kind: "table",
          head: ["code", "When it happens"],
          rows: [
            ["`ERROR_VALIDATION`", "Invalid body or query; see `details[]`."],
            ["`ERROR_INVALID_LIMIT`", "`limit` outside 1–1000 or not an integer (400)."],
            ["`ERROR_INVALID_CURSOR`", "Tampered cursor, or one from another collection, tenant or filter (400)."],
            ["`ERROR_RATE_LIMIT_EXCEEDED`", "Request limit exceeded (429)."],
            ["`ERROR_INSUFFICIENT_CREDITS` / `ERROR_QUOTA_EXCEEDED`", "Not enough credits or quota to issue."],
            ["`ERROR_COMPANY_NOT_READY` / `ERROR_COMPANY_BLOCKED`", "Company without an active certificate in `live`, or blocked."],
            ["`ERROR_IDEMPOTENCY_CONFLICT`", "Same `Idempotency-Key` with a different payload (409)."],
            ["`ERROR_GONE`", "Retired operation, such as one-off credit purchases (410)."],
          ],
        },
        { kind: "heading", level: 2, body: "Best practices" },
        {
          kind: "list",
          items: [
            "For non-2xx responses, keep the status, `code` and `requestId` in diagnostics — never log the API key.",
            "Retry with backoff on 429/503; on 429 wait for `Retry-After`. On issuance, preserve the idempotency key and the payload.",
            "Do not repeat validation errors without fixing the data listed in `details`.",
          ],
        },
      ],
    },
    "rate-limits": {
      title: "Rate limits",
      description: "Request limits per identity and per IP, in 60-second windows.",
      blocks: [
        {
          kind: "table",
          head: ["Identity", "Limit per 60-second window"],
          rows: [
            ["Validated API key (summed across endpoints)", "300"],
            ["Public routes, per IP", "120"],
            ["Whole tenant (all keys and sessions together)", "600"],
            ["Pre-authentication protection, per IP", "1200"],
          ],
        },
        {
          kind: "text",
          body: "Sensitive routes have extra per-route budgets on top of the general limit: OTP, magic link, OAuth and Turnstile (10 to 30 per minute per IP), MCP client registration, token and revocation (10 to 30 per minute per IP), and the costly authenticated routes `POST /invoices`, `POST /invoices/calculate` (120 per minute per tenant) and certificate upload (10 per minute per tenant). Health checks, preflight and Stripe receiving are exempt. Creating more API keys does not raise your ceiling: the tenant-wide limit applies across all of them.",
        },
        {
          kind: "text",
          body: "Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (Unix timestamp in seconds). On `429`, the `Retry-After` header gives the seconds until you can retry and the body carries `code: \"ERROR_RATE_LIMIT_EXCEEDED\"`. On sensitive routes, the route-specific headers replace the general ones.",
        },
        {
          kind: "callout",
          tone: "accent",
          body: "Honor `Retry-After` before retrying and use exponential backoff during spikes. Do not treat the plan's `throughputRps` as the HTTP limit. When the server is saturated it answers `503` with `code: \"ERROR_SERVER_BUSY\"` and `Retry-After: 1`: retry with backoff.",
        },
      ],
    },
    companies: {
      title: "Companies",
      description: "Register and manage the companies used for NFS-e issuance.",
      blocks: [
        {
          kind: "text",
          body: "Permissions: fetches use `nfse.companies.view`; writes use `nfse.companies.manage`.",
        },
        { kind: "heading", level: 2, body: "From signup to issuing" },
        { kind: "list", items: [
          "`POST /v1/companies` with `taxRegime` and `municipalityCode`. `municipalReg` is optional.",
          "`POST /v1/companies/:id/certificates` with the A1 certificate.",
          "`POST /v1/invoices`.",
        ] },
        { kind: "callout", tone: "accent", body: "The regime sent when creating the company creates its fiscal profile, valid from today and already approved by the caller (user or API key). Without a customer or with a CPF customer there is no approval step or service setup: classification comes from the official catalog by `service.code`. With a CNPJ customer the federal withholding depends on the service policy: create the service profile with `withholdingPolicy` `NONE_CONFIRMED` or `CONFIGURED` and approve it, otherwise the calculation returns `blocked` with `TAX_APPLICABILITY_UNKNOWN`. `GET /v1/companies/:id` shows `status` and `setupGaps` (`municipality_code`, `certificate`). Use `POST /v1/invoices/calculate` to check before issuing." },
        { kind: "callout", tone: "warn", body: "Changing `taxRegime`, `simpleNational` or `specialRegime` with `PATCH` on the same day the company was created returns `409` (`ERROR_CONFLICT`, message `profile_validity_conflict`), because an approved profile is not rewritten. For a dated change use `PUT /v1/companies/:id/fiscal-profile` with `validFrom`. Service profiles (`/v1/companies/:id/service-tax-profiles`) are optional and become required when the regime needs IBS/CBS or configured ISS: the calculation returns `FISCAL_CLASSIFICATION_REQUIRED` with the missing fields." },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/companies",
          scopes: ["full_access"],
          success: "201 Created",
          summary: "Registers a company.",
          params: {
            rows: [
              { name: "legalName", type: "string", required: true, description: "Legal name, up to 200 characters, not empty after trim." },
              { name: "taxId", type: "string", required: true, description: "Valid CNPJ; normalized before the duplicate check." },
              { name: "taxRegime", type: "string", required: true, description: "`MEI`, `Simples Nacional`, `Lucro Presumido` or `Lucro Real`." },
              { name: "tradeName", type: "string", required: false, description: "Up to 200 characters." },
              { name: "municipalReg", type: "string or null", required: false, description: "Optional, and nonblank when sent. It is stored but **not sent on the invoice** unless `sendMunicipalReg` is `true`. `null` clears it (and turns `sendMunicipalReg` off)." },
              { name: "sendMunicipalReg", type: "boolean", required: false, description: "Default `false`. Send the municipal registration in the DPS only if the city registered this company in the national registry and the tax authority requires it; otherwise the invoice is rejected (E0120)." },
              { name: "municipalityCode", type: "string", required: true, description: "Exactly 7 digits (IBGE), required in test and live mode. Used as the issuer municipality and default service location." },
              { name: "defaultServiceCode", type: "string", required: false, description: "Exactly 6 digits (cTribNac); default for new invoices. Without it, provide `service.code` when issuing." },
              { name: "simpleNational", type: "boolean", required: false, description: "If omitted, follows the regime (`true` for MEI and Simples Nacional)." },
              { name: "specialRegime", type: "string", required: false, description: "One of `\"0\"`–`\"6\"` (regEspTrib, RTC v1.01): 0 None, 1 Cooperative Act, 2 Estimate, 3 Municipal Microenterprise, 4 Notary or Registrar, 5 Self-employed Professional, 6 Professional Partnership." },
              { name: "address", type: "object", required: false, description: "`street` (200), `number` (20), `complement` (100), `district` (100), `city` (100), `state` (2) and `zip` (10), all optional strings. A filled-in state must be a valid UF and is normalized to uppercase. A filled-in zip must be 8 digits and is stored without punctuation." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/companies" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "legalName": "Empresa Exemplo Ltda",
    "taxId": "11222333000181",
    "taxRegime": "Simples Nacional",
    "simpleNational": true,
    "municipalReg": "123456",
    "municipalityCode": "3550308",
    "defaultServiceCode": "010101",
    "address": {
      "street": "Rua Exemplo",
      "number": "100",
      "city": "São Paulo",
      "state": "SP",
      "zip": "01001000"
    }
  }'`,
            node: `const res = await fetch(\`\${BASE_URL}/companies\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    legalName: "Empresa Exemplo Ltda",
    taxId: "11222333000181",
    taxRegime: "Simples Nacional",
    simpleNational: true,
    municipalReg: "123456",
    municipalityCode: "3550308",
    defaultServiceCode: "010101",
    address: {
      street: "Rua Exemplo",
      number: "100",
      city: "São Paulo",
      state: "SP",
      zip: "01001000",
    },
  }),
});
const body = await res.json();
console.log(body.data.id); // { data: Company }`,
          },
          response: {
            label: "201 Created",
            json: `{
  "data": {
    "id": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
    "legalName": "Empresa Exemplo Ltda",
    "taxId": "11222333000181",
    "taxRegime": "Simples Nacional",
    "municipalityCode": "3550308",
    "defaultServiceCode": "010101",
    "status": "pending_setup",
    "environment": "test",
    "createdAt": "2026-10-10T12:00:00.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "A duplicate CNPJ in the same account/environment returns `409`. In `live`, creation can fail on company limit or blocked plan (`422`)." },
            { kind: "callout", tone: "accent", body: "The input body uses `address`, but the response exposes flat fields: `addressStreet`, `addressNumber`, `addressCity`, `addressState`, `addressZip` etc. `status` is `pending_setup`, `ready` or `blocked`; `setupGaps` lists pending items (`municipality_code`, `certificate`)." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/companies",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Lists the companies in the account/environment.",
          params: {
            rows: [
              { name: "limit", type: "integer", required: false, description: "Defaults to `50`; accepts integers from 1 to 1000 (an invalid value returns `400`)." },
              { name: "cursor", type: "string", required: false, description: "`nextCursor` from the previous page, keeping the same filters." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/companies?limit=50" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/companies?limit=50\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data, body.pagination); // { data: Company[], pagination }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
      "legalName": "Empresa Exemplo Ltda",
      "taxId": "11222333000181",
      "status": "ready",
      "environment": "test"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": true,
    "nextCursor": "eyJ2IjoxLCJjcmVhdGVkQXQiOiIyMDI2LTEwLTA5VDEyOjAwOjAwLjAwMDAwMFoiLCJpZCI6IjNmMWM4YTkwIn0"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Ordering is `createdAt DESC`, then `id DESC`. Continue with `pagination.nextCursor` until `hasMore: false`; there is no `total`." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/companies/:id",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Fetches a single company by id.",
          examples: {
            curl: `curl "$BASE_URL/companies/$COMPANY_ID" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/companies/\${process.env.COMPANY_ID}\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data); // { data: Company }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "id": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
    "legalName": "Empresa Exemplo Ltda",
    "taxId": "11222333000181",
    "municipalReg": "123456",
    "taxRegime": "Simples Nacional",
    "status": "ready",
    "environment": "test",
    "setupGaps": []
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "A company that does not exist, was deleted, or belongs to another environment/account returns `404`. An `id` that is not a valid UUID returns `400` (`ERROR_BAD_REQUEST`)." },
          ],
        },
        {
          kind: "endpoint",
          method: "PATCH",
          path: "/v1/companies/:id",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Updates a company. Accepts the creation fields, all optional.",
          params: {
            rows: [
              { name: "legalName", type: "string", required: false, description: "Legal name, up to 200 characters, not empty after trim." },
              { name: "taxId", type: "string", required: false, description: "Valid CNPJ; normalized before the duplicate check." },
              { name: "taxRegime", type: "string", required: false, description: "`MEI`, `Simples Nacional`, `Lucro Presumido` or `Lucro Real`." },
              { name: "tradeName", type: "string", required: false, description: "Up to 200 characters." },
              { name: "municipalReg", type: "string or null", required: false, description: "Optional. Stored but not sent on the invoice unless `sendMunicipalReg` is `true`. `null` clears it." },
              { name: "municipalityCode", type: "string", required: false, description: "Exactly 7 digits when provided; omit to keep the existing value. Cannot be cleared." },
              { name: "defaultServiceCode", type: "string or null", required: false, description: "Exactly 6 digits when provided. Omit to keep; null clears the default." },
              { name: "simpleNational", type: "boolean", required: false, description: "Omit it to keep the current value." },
              { name: "specialRegime", type: "string", required: false, description: "One of `\"0\"`–`\"6\"` (regEspTrib, RTC v1.01), same codes as on creation. Empty string clears it; omit to keep the current value." },
              { name: "address", type: "object or null", required: false, description: "Same fields as on creation. `null` clears the address." },
            ],
          },
          examples: {
            curl: `curl -X PATCH "$BASE_URL/companies/$COMPANY_ID" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "tradeName": "Novo nome", "municipalReg": "987654" }'`,
            node: `const res = await fetch(\`\${BASE_URL}/companies/\${process.env.COMPANY_ID}\`, {
  method: "PATCH",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ tradeName: "Novo nome", municipalReg: "987654" }),
});
const body = await res.json();
console.log(body.data); // { data: Company }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "id": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
    "tradeName": "Novo nome",
    "municipalReg": "987654",
    "status": "ready"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "`municipalReg: null` clears municipal registration and `address: null` clears the address. Omit `defaultServiceCode` to keep it; `null` clears it; empty or invalid values are rejected. A supplied `municipalityCode` must have 7 digits and cannot be cleared. `environment` cannot be changed. May return `400` on validation, `404`, or `409` on a duplicate CNPJ." },
          ],
        },
        {
          kind: "endpoint",
          method: "DELETE",
          path: "/v1/companies/:id",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Deletes a company (logical deletion).",
          examples: {
            curl: `curl -X DELETE "$BASE_URL/companies/$COMPANY_ID" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/companies/\${process.env.COMPANY_ID}\`, {
  method: "DELETE",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data); // { data: null }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": null
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Returns `404` if the company is not found." },
          ],
        },
      ],
    },
    certificates: {
      title: "Certificates",
      description: "Upload and manage A1 (PKCS#12) certificates for issuance.",
      blocks: [
        {
          kind: "text",
          body: "Permissions: `nfse.certificates.view` to list and `nfse.certificates.manage` to upload/revoke.",
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/companies/:companyId/certificates",
          scopes: ["full_access"],
          success: "201 Created",
          summary: "Uploads an A1 certificate (`.p12`/`.pfx`) for a company. The certificate is parsed, its validity is checked, and its CNPJ must match the company's.",
          params: {
            rows: [
              { name: "file", type: "file", required: true, description: "PKCS#12 certificate (.p12/.pfx), max 50 × 1024 bytes." },
              { name: "password", type: "string", required: true, description: "Non-empty, up to 100 characters." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/companies/$COMPANY_ID/certificates" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -F 'file=@certificate.pfx' \\
  -F 'password=CERT_PASSWORD'`,
            node: `import { readFile } from "node:fs/promises";

// FormData and File are available in browsers and Node 18+.
const form = new FormData();
form.append("file", new File([await readFile("certificate.pfx")], "certificate.pfx"));
form.append("password", process.env.CORVO_CERT_PASSWORD);

const res = await fetch(\`\${BASE_URL}/companies/\${process.env.COMPANY_ID}/certificates\`, {
  method: "POST",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
  body: form, // no Content-Type header — the runtime sets the multipart boundary
});
const body = await res.json(); // { data: Certificate }
console.log(body.data.id);`,
          },
          response: {
            label: "201 Created",
            json: `{
  "data": {
    "id": "9a2b7c40-1d5e-4f6a-8b3c-5d7e9f0a2b41",
    "companyId": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
    "serialNumber": "3881234567",
    "issuer": "AC A1 Teste",
    "subject": "CNPJ: 11222333000181",
    "fingerprint": "AB:CD:EF:...",
    "validFrom": "2026-01-01T00:00:00.000Z",
    "validUntil": "2027-01-01T00:00:00.000Z",
    "status": "active",
    "createdAt": "2026-10-10T12:00:00.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Failures include `400` for missing file/password, `413` for size, and `422` for an expired certificate or a CNPJ that does not match the company. Parsing failures depend on the error produced by the parser; do not assume a single code for every invalid file." },
            { kind: "callout", tone: "accent", body: "The API returns metadata only — never the password or the certificate content. Possible `status` values: `active`, `expired`, `revoked`." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/companies/:companyId/certificates",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Lists the certificates of a company.",
          examples: {
            curl: `curl "$BASE_URL/companies/$COMPANY_ID/certificates" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/companies/\${process.env.COMPANY_ID}/certificates\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data: certs, pagination } = await res.json(); // { data: Certificate[], pagination }
console.log(certs.length, pagination.hasMore);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "9a2b7c40-1d5e-4f6a-8b3c-5d7e9f0a2b41",
      "companyId": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
      "serialNumber": "3881234567",
      "status": "active",
      "validUntil": "2027-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}`,
          },
        },
        {
          kind: "endpoint",
          method: "DELETE",
          path: "/v1/companies/:companyId/certificates/:certId",
          scopes: ["full_access"],
          success: "204 No Content",
          summary: "Revokes a certificate and updates the company's readiness.",
          examples: {
            curl: `curl -X DELETE "$BASE_URL/companies/$COMPANY_ID/certificates/$CERT_ID" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(
  \`\${BASE_URL}/companies/\${process.env.COMPANY_ID}/certificates/\${process.env.CERT_ID}\`,
  {
    method: "DELETE",
    headers: { "X-API-Key": process.env.CORVO_API_KEY },
  },
);
console.log(res.status); // 204`,
          },
          response: { label: "204 No Content", json: "" },
          notes: [
            { kind: "callout", tone: "accent", body: "No response body. Returns `404` if the certificate/company does not match the account, the environment or the path provided." },
          ],
        },
      ],
    },
    invoices: {
      title: "Invoices",
      description: "Issue NFS-e, fetch status, download documents and request email delivery.",
      blocks: [
        {
          kind: "text",
          body: "Permissions: `nfse.invoices.issue` to issue/request email; `nfse.invoices.view` for fetches, documents and signed URLs.",
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "202 Accepted",
          summary: "Requests NFS-e issuance. Issuance is asynchronous: HTTP success means the request was registered/queued — it does not mean fiscal authorization. These examples use the CNPJ (`companyTaxId`) of a company registered with `municipalityCode` and `defaultServiceCode`. The issuer municipality always comes from the company.",
          params: {
            rows: [
              { name: "companyId", type: "string UUID", required: false, description: "Send this field or `companyTaxId`; if both exist, `companyId` takes precedence." },
              { name: "companyTaxId", type: "string", required: false, description: "CNPJ of a company already registered in the account/environment; punctuation optional." },
              { name: "externalId", type: "string", required: false, description: "Reference from the integrating system; does not replace the idempotency key." },
              { name: "customer", type: "object", required: false, description: "Optional: omit it or send `{}` for an invoice without tomador (the customer is left out of the DPS). When sent with any data, `taxId` is required (valid CPF or CNPJ, normalized); `name` is optional, `email` (optional; required when email sending is enabled; no email format validation in this DTO/domain) and `address` (optional: `street`, `city`, `state`, `zip`, `country` are optional strings; if you fill in city or state, fill in both; state must be valid)." },
              { name: "service", type: "object", required: true, description: "`code` is optional: without it the company `defaultServiceCode` is used and, if the company has none, `100901` (LC 116 item 10.09, representation of any nature); exactly 6 digits when provided. `municipalityCode` inherits the company municipality; when provided, exactly 7 digits and sets the service location. `description` is optional: when empty, the name of the service code is used. Empty, null or invalid values of the other fields do not use the defaults." },
              { name: "amount", type: "number", required: true, description: "Value in reais, positive, up to 9999999999.99 with at most 2 decimals." },
              { name: "competenceDate", type: "string ISO 8601", required: true, description: "Valid competence date. Without `options.type` it cannot be in the future (`422` `ERROR_FUTURE_DATE`). With `options.type: \"SCHEDULE\"` a future date is accepted (see Scheduled invoices)." },
              { name: "discount", type: "number", required: false, description: "Unconditional discount in BRL, from 0 up to the invoice amount, at most 2 decimal places." },
              { name: "deduction", type: "number", required: false, description: "Deduction from the ISS base declared by the issuer, in BRL: greater than 0 and less than `amount` minus `discount`, at most 2 decimal places (`0` is the same as omitting it). Sent in the DPS as `vDedRed/vDR`, it reduces the ISS tax base. Use it for the partner professional's share in salons and barbershops with a partnership contract (Brazilian Lei 13.352/2016): the establishment issues the invoice for the full amount and the professional's share goes here. The issuer is responsible for the declared value and the contract; Corvo does not check them. IBS/CBS is still calculated on the amount without the deduction. See Partner salon." },
              { name: "email", type: "boolean", required: false, description: "Requests a notification; defaults to `false`." },
              { name: "options.email.send", type: "boolean", required: false, description: "When set, takes precedence over `email`." },
              { name: "options.type", type: "string", required: false, description: "`IMMEDIATE` (default) or `SCHEDULE`. `SCHEDULE` schedules issuance for a future `competenceDate`; see Scheduled invoices." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: pedido_123_emissao' \\
  -d '{
    "companyTaxId": "11222333000181",
    "externalId": "pedido_123",
    "customer": {
      "name": "Cliente Exemplo",
      "taxId": "52998224725",
      "email": "cliente@example.com",
      "address": { "city": "São Paulo", "state": "SP" }
    },
    "service": {
      "description": "Prestação de serviço"
    },
    "amount": 150.50,
    "competenceDate": "2026-10-01",
    "options": { "email": { "send": true } }
  }'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
    "Idempotency-Key": "pedido_123_emissao",
  },
  body: JSON.stringify({
    companyTaxId: "11222333000181",
    externalId: "pedido_123",
    customer: {
      name: "Cliente Exemplo",
      taxId: "52998224725",
      email: "cliente@example.com",
      address: { city: "São Paulo", state: "SP" },
    },
    service: {
      description: "Prestação de serviço",
    },
    amount: 150.5,
    competenceDate: "2026-10-01",
    options: { email: { send: true } },
  }),
});
const body = await res.json();
console.log(body.data.id); // { data: Invoice }`,
          },
          response: {
            label: "202 Accepted",
            json: `{
  "data": {
    "id": "6c4d2e81-0a3b-4c5d-9e7f-1a2b3c4d5e6f",
    "companyId": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
    "environment": "test",
    "externalId": "pedido_123",
    "idempotencyKey": "pedido_123_emissao",
    "status": "queued",
    "amount": 150.5,
    "currency": "BRL",
    "competenceDate": "2026-10-01T00:00:00.000Z",
    "stage": "pending",
    "createdAt": "2026-10-10T12:00:00.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Send an `Idempotency-Key` header: with the same key, account and environment and equivalent content, the hash recovers the same invoice; different content returns `409` (`ERROR_IDEMPOTENCY_CONFLICT`). The hash is computed before fiscal normalization, with canonical JSON keys and the competence date. Do not change how fields are represented between retries: a CNPJ with and without punctuation can produce different hashes. Without a key there is no deduplication." },
            { kind: "callout", tone: "warn", body: "Issuance is asynchronous — see the Async issuance guide. Track the invoice with `GET /v1/invoices/:id` or webhooks. The customer address is reduced to `city` and `state` in the snapshot; `street`, `zip` and `country` are not preserved — do not rely on them in the response." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices/calculate",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "200 OK",
          summary: "Calculates the taxes of an invoice **without issuing it**: it stores no invoice, uses no credit, reserves no DPS number, schedules nothing and does not call Sefin. Use it to check the fiscal setup and show the amount to the customer before `POST /v1/invoices`.",
          params: {
            rows: [
              { name: "(corpo)", type: "objeto", required: true, description: "Same body as `POST /v1/invoices` (company, `service`, `amount`, `competenceDate`, optional `customer`, `discount`, `deduction`). Requires the `nfse.invoices.issue` permission. It does not require a certificate or a ready company." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices/calculate" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "companyTaxId": "11222333000181",
    "service": { "code": "060101", "description": "Haircut" },
    "amount": 50,
    "competenceDate": "2026-10-13"
  }'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/calculate\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    companyTaxId: "11222333000181",
    service: { code: "060101", description: "Haircut" },
    amount: 50,
    competenceDate: "2026-10-13",
  }),
});
const { data } = await res.json();
console.log(data.status, data.netReceivableAmount); // "ready" "50.00"`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "preEmission": true,
    "status": "ready",
    "disclaimer": "Pre-emission calculation. Values are not a fiscal document and may differ from the final validation by Sefin.",
    "competenceDate": "2026-10-13",
    "taxRegime": "MEI",
    "classification": {
      "serviceCode": "060101",
      "source": "official_catalog",
      "operationNature": "SERVICE",
      "nbsCode": null,
      "cst": null,
      "classCode": null,
      "serviceProfileId": null,
      "catalogValidated": false
    },
    "applicability": {
      "customerRequired": false,
      "strategy": "mei",
      "iss": {
        "status": "NOT_APPLICABLE",
        "reason": "ISS recolhido no DAS-MEI"
      },
      "federalWithholding": {
        "status": "NOT_APPLICABLE",
        "reason": "no federal withholding on payments to Simples Nacional/MEI optants (IN RFB 1.234/2012, art. 4, XI)"
      },
      "cbs": {
        "status": "NOT_APPLICABLE",
        "reason": "MEI não destaca IBS/CBS na fase de teste de 2026"
      },
      "ibs": {
        "status": "NOT_APPLICABLE",
        "reason": "MEI não destaca IBS/CBS na fase de teste de 2026"
      }
    },
    "taxes": {},
    "withholdings": [],
    "netReceivableAmount": "50.00",
    "collectionWaived": false,
    "calculation": {
      "source": "none",
      "calculatorVersion": null,
      "rulesVersion": "2026.10-r1",
      "legalReferences": [
        "Ato Conjunto RFB/CGIBS nº 4/2026; orientação CGNFS-e de 07/08/2026"
      ]
    },
    "warnings": [
      {
        "code": "CLASSIFICATION_NOT_CATALOG_VALIDATED",
        "message": "Service tax classification was not validated against the official catalog",
        "step": "ServiceTaxClassifier"
      }
    ],
    "pendingFields": [],
    "blocking": null,
    "trace": [
      {
        "step": "CompanyFiscalProfile",
        "status": "applied",
        "durationMs": 2.4
      },
      {
        "step": "ServiceTaxClassifier",
        "status": "applied",
        "durationMs": 7.1
      },
      {
        "step": "TaxApplicabilityResolver",
        "status": "applied",
        "durationMs": 0.3
      },
      {
        "step": "RtcTaxCalculator",
        "status": "skipped",
        "durationMs": 0.03,
        "reason": "MEI não destaca IBS/CBS na fase de teste de 2026"
      },
      {
        "step": "FiscalValidator",
        "status": "applied",
        "durationMs": 0.1
      }
    ]
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "`status: \"ready\"` means the fiscal data is complete and the calculation was done. It is a pre-emission estimate, not an authorization from Sefin. Amounts and rates are decimal strings. The response never returns the customer's name or CPF/CNPJ." },
            { kind: "callout", tone: "warn", body: "A fiscal problem is not an HTTP error: it returns `200` with `status: \"blocked\"`, `blocking` (`code`, `message`, `step`) and `pendingFields[]` listing what is missing, for example `FISCAL_CLASSIFICATION_REQUIRED` or `TAX_RATE_NOT_FOUND`. Values already computed before the block stay in the response. Invalid input follows the normal envelope (`404` unknown company, `422` invalid field)." },
            { kind: "callout", tone: "warn", body: "`503` with `Retry-After` (seconds) when the tax calculator is unavailable: retry later, never estimate. The rate limit is the same as any authenticated endpoint (`429` with `Retry-After`). A future competence date is accepted only up to 15 days ahead." },
          ],
        },
        { kind: "heading", level: 2, body: "Scheduled invoices" },
        { kind: "text", body: "Use `options.type: \"SCHEDULE\"` with a future `competenceDate` to have the invoice issued only on that day. Corvo releases issuance at 00:00 `America/Sao_Paulo` on the `competenceDate`. Until then the invoice stays `status: \"queued\"` and `scheduledFor` holds the release instant (ISO); for immediate invoices `scheduledFor` is `null`." },
        { kind: "table", head: ["Situation", "Result"], rows: [
          ["No `options.type` (or `IMMEDIATE`) and a future `competenceDate`", "`422` with `ERROR_FUTURE_DATE` in `details[].code`."],
          ["`SCHEDULE` and a future `competenceDate` within the limit", "`202`, `status: queued`, `scheduledFor` set; issuance happens on that date."],
          ["`SCHEDULE` and a `competenceDate` beyond the limit (default 15 days ahead)", "`422` with `ERROR_SCHEDULE_HORIZON_EXCEEDED` in `details[].code`."],
          ["`SCHEDULE` and a `competenceDate` of today or in the past", "Immediate issuance, `scheduledFor: null`."],
        ] },
        { kind: "code", label: "Schedule an invoice", language: "bash", code: `curl -X POST "$BASE_URL/invoices" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order_123_scheduled" \\
  -d '{
    "companyTaxId": "11222333000181",
    "service": { "description": "Haircut" },
    "amount": 50,
    "competenceDate": "2026-10-20",
    "options": { "type": "SCHEDULE" }
  }'` },
        { kind: "callout", tone: "warn", body: "Tax data is computed when the invoice is issued, using the configuration in force on the `competenceDate`. In `live`, the company must be ready and have an active certificate when you schedule. Before scheduling, `POST /v1/invoices/calculate` shows the calculation for that date. The `nfse.invoice.authorized` (or `rejected`) webhook arrives when issuance happens, not when you schedule." },
        { kind: "heading", level: 2, body: "Partner salon" },
        { kind: "text", body: "Establishments with a partnership contract (Brazilian Lei 13.352/2016) issue a single invoice for the total amount charged to the customer and report the partner professional's share in `deduction`. The value is sent in the DPS as `vDedRed/vDR` and deducted from the ISS tax base." },
        { kind: "table", head: ["Field / tax", "How it is handled"], rows: [
          ["`amount`", "Total amount charged to the customer."],
          ["`deduction`", "The partner professional's share. Greater than 0 and less than `amount` minus `discount`; `0` is the same as omitting it."],
          ["ISS", "Base = `amount` − `discount` − `deduction`."],
          ["Federal withholdings", "Base unchanged: `amount` − `discount`."],
          ["IBS/CBS", "Calculated on the amount without the deduction."],
          ["Net receivable", "Does not change with the deduction."],
        ] },
        { kind: "code", label: "Partner salon invoice", language: "bash", code: `curl -X POST "$BASE_URL/invoices" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order_123" \\
  -d '{
    "companyTaxId": "11222333000181",
    "service": { "description": "Haircut" },
    "amount": 100,
    "deduction": 40,
    "competenceDate": "2026-10-20"
  }'` },
        { kind: "callout", tone: "warn", body: "The establishment declares the value and is responsible for it and for the partnership contract: Corvo issues what was reported, does not check the contract and does not replace your accountant. Acceptance of the deduction by the municipality and the national system has not been validated in Produção Restrita yet; if the invoice is rejected, the reason is in `lastErrorCode` and `lastErrorMessage`. A service profile with the `PARTNER_SALON` nature still requires fiscal review and blocks issuance: use the `SERVICE` nature with `deduction`." },
        { kind: "heading", level: 2, body: "Invoice schema" },
        { kind: "text", body: "Each invoice has these fields:" },
        {
          kind: "table",
          head: ["Fields", "Type / notes"],
          rows: [
            ["`id`, `companyId`", "Identification strings."],
            ["`environment`", "`test` or `live`."],
            ["`externalId`, `idempotencyKey`", "String or null."],
            ["`status`", "Enum described below."],
            ["`customerSnapshot`", "`taxId`, `name`, `email?`, `address?: { city, state, country? }`."],
            ["`serviceSnapshot`", "`description`, `code`, `municipalityCode`."],
            ["`taxSnapshot`", "Fiscal information object."],
            ["`amount`, `currency`, `competenceDate`", "Number in reais, currency and ISO 8601 date-time (the competence date at midnight UTC, e.g. `2026-10-01T00:00:00.000Z`)."],
            ["`discount`, `deduction`", "Optional numbers in reais: the unconditional discount and the issuer-declared deduction from the ISS base (see Partner salon)."],
            ["`dpsId`, `dpsSeries`, `dpsNumber`", "String/string/number or null."],
            ["`accessKey`, `nfseNumber`", "String/number or null."],
            ["`fiscalProvider`, `fiscalSchemaVersion`", "Strings."],
            ["`issuedAt`, `authorizedAt`", "ISO date or null."],
            ["`emailSnapshot`", "Optional object with `send`."],
            ["`lastErrorCode`, `lastErrorMessage`, `lastErrorProvider`", "String or null."],
            ["`documentsReadyAt`", "ISO date or null."],
            ["`lastEmailStatus`, `lastEmailSentAt`", "`queued`, `sent`, `failed` or null; ISO date or null."],
            ["`documentsStatus`", "Derived state: `pending` or `ready`."],
            ["`emailStatus`", "Derived state: `queued`, `sent`, `failed` or null."],
            ["`stage`", "Derived state: `pending`, `authorized`, `documents_ready`, `completed`, `failed`."],
            ["`scheduledFor`", "ISO release date of a scheduled invoice, or null."],
            ["`cancellationReason`, `cancellationDescription`", "Reason (`issue_error`, `service_not_provided` or `other`) and justification of the cancellation request, or null."],
            ["`cancelledAt`", "ISO date when the invoice reached `cancelled`, or null."],
            ["`cancellationRequestedAt`", "ISO date of a cancellation requested while the invoice was `processing`, or null. The invoice is cancelled at the Sefin as soon as it is authorized."],
            ["`createdAt`, `updatedAt`", "ISO dates."],
            ["`documentKeyVersion`", "Optional number, when present in the snapshot."],
          ],
        },
        {
          kind: "text",
          body: "`requestHash` is removed from serialization. The current response uses `documentsReadyAt`/`documentsStatus`, not the `documentsReady` boolean shown by a Swagger DTO. There is no `lastEmail` object in the current JSON — use the fields above. `stage: completed` can also occur with the email in `failed`; check `emailStatus` to know whether a send succeeded.",
        },
        {
          kind: "text",
          body: "Fiscal statuses: `queued`, `processing`, `authorized`, `rejected`, `retry_pending`, `reconciliation_required`, `manual_review`, `failed`, `cancelling`, `cancelled`. Do not treat authorization as immediate availability of every document.",
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/invoices",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Lists invoices, newest first.",
          params: {
            rows: [
              { name: "companyId", type: "string UUID", required: false, description: "Filters by company." },
              { name: "status", type: "string", required: false, description: "One of the fiscal statuses above." },
              { name: "from", type: "string ISO 8601", required: false, description: "Inclusive filter by competence date — not by `createdAt`." },
              { name: "to", type: "string ISO 8601", required: false, description: "Inclusive filter by competence date — not by `createdAt`." },
              { name: "externalId", type: "string", required: false, description: "Exact match." },
              { name: "limit", type: "integer", required: false, description: "Integer between 1 and 1000; defaults to `50`." },
              { name: "cursor", type: "string", required: false, description: "`nextCursor` from the previous page, keeping the same filters." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/invoices?status=authorized&limit=50" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices?status=authorized&limit=50\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data: invoices, pagination } = await res.json(); // { data: Invoice[], pagination }
console.log(invoices.length, pagination.nextCursor);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "6c4d2e81-0a3b-4c5d-9e7f-1a2b3c4d5e6f",
      "status": "authorized",
      "amount": 150.5,
      "competenceDate": "2026-10-01T00:00:00.000Z",
      "createdAt": "2026-10-10T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": true,
    "nextCursor": "eyJ2IjoxLCJjcmVhdGVkQXQiOiIyMDI2LTEwLTA5VDEyOjAwOjAwLjAwMDAwMFoiLCJpZCI6IjNmMWM4YTkwIn0"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Ordering is `createdAt DESC` with an ID tie-break. Continue with `pagination.nextCursor` until `hasMore: false`; newer inserts do not show up when continuing, and there is no `total`." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/invoices/:id",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Fetches a single invoice by id.",
          examples: {
            curl: `curl "$BASE_URL/invoices/$INVOICE_ID" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${process.env.INVOICE_ID}\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.status); // { data: Invoice }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "id": "6c4d2e81-0a3b-4c5d-9e7f-1a2b3c4d5e6f",
    "status": "authorized",
    "stage": "documents_ready",
    "documentsStatus": "ready",
    "accessKey": "35260712345678900000350010000000011000000019",
    "nfseNumber": 123
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Returns `404` if the invoice is not found in the account/environment. An `id` that is not a valid UUID returns `400` (`ERROR_BAD_REQUEST`)." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/invoices/:id/xml",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Downloads the XML of an authorized invoice.",
          examples: {
            curl: `curl "$BASE_URL/invoices/$INVOICE_ID/xml" \\
  -H "X-API-Key: $CORVO_API_KEY" --fail --output nfse.xml`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${process.env.INVOICE_ID}/xml\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
if (!res.ok) throw new Error(\`XML download failed: \${res.status}\`);
const xml = await res.text(); // raw XML, no JSON envelope`,
          },
          response: { label: "200 OK", json: "" },
          notes: [
            { kind: "callout", tone: "accent", body: "Returns raw XML with `Content-Type: application/xml` and `Content-Disposition: attachment; filename=\"nfse-<number-or-id>.xml\"` — no JSON envelope." },
            { kind: "callout", tone: "warn", body: "The invoice must be `authorized`, otherwise `404`. Availability also depends on document storage." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/invoices/:id/pdf",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Downloads the PDF of an authorized invoice.",
          examples: {
            curl: `curl "$BASE_URL/invoices/$INVOICE_ID/pdf" \\
  -H "X-API-Key: $CORVO_API_KEY" --fail --output nota.pdf`,
            node: `import { writeFile } from "node:fs/promises";

const res = await fetch(\`\${BASE_URL}/invoices/\${process.env.INVOICE_ID}/pdf\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
if (!res.ok) throw new Error(\`PDF download failed: \${res.status}\`);
await writeFile("nfse.pdf", Buffer.from(await res.arrayBuffer()));`,
          },
          response: { label: "200 OK", json: "" },
          notes: [
            { kind: "callout", tone: "accent", body: "Returns PDF bytes with `Content-Type: application/pdf` and `Content-Disposition: inline; filename=\"nfse-<number-or-id>.pdf\"` — no JSON envelope." },
            { kind: "callout", tone: "warn", body: "The invoice must be `authorized`, otherwise `404`. Availability also depends on document storage." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/invoices/:id/events",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Fetches the status history of an invoice, oldest first. Paginated like any list (`limit`, `cursor`).",
          examples: {
            curl: `curl "$BASE_URL/invoices/$INVOICE_ID/events" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${process.env.INVOICE_ID}/events\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data: events, pagination } = await res.json(); // { data: InvoiceEvent[], pagination }
console.log(events.length, pagination.hasMore);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "e1d2c3b4-5a6f-4b7c-8d9e-0f1a2b3c4d5e",
      "invoiceId": "6c4d2e81-0a3b-4c5d-9e7f-1a2b3c4d5e6f",
      "fromStatus": "queued",
      "toStatus": "authorized",
      "reason": null,
      "createdAt": "2026-10-10T12:01:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Fields: `id`, `invoiceId`, `fromStatus` (string or null), `toStatus`, `reason` (string or null), `createdAt`." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices/:id/download-url",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Generates a short-lived signed URL for the invoice documents.",
          params: {
            rows: [
              { name: "format", type: "string", required: true, description: "`\"pdf\"` or `\"xml\"`." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices/$INVOICE_ID/download-url" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "format": "pdf" }'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${process.env.INVOICE_ID}/download-url\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ format: "pdf" }),
});
const body = await res.json();
console.log(body.data.downloadUrl); // { data: { downloadUrl, expiresAt, fileName, mimeType } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "downloadUrl": "https://storage.example.com/documento-assinado",
    "expiresAt": "2026-10-10T15:00:00.000Z",
    "fileName": "nfse-123.pdf",
    "mimeType": "application/pdf"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "The response comes with `Cache-Control: no-store`. The URL is valid for 3600 seconds at the storage. Use it directly and protect it as a temporary credential." },
            { kind: "callout", tone: "warn", body: "The invoice must be authorized and have `documentsReadyAt`, otherwise `409`. Missing invoice: `404`. Storage unavailable: `503`." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices/:id/email",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "202 Accepted",
          summary: "Requests email delivery of the invoice to the address stored in `customerSnapshot.email`; no alternative recipient is accepted. The invoice must be authorized with documents ready.",
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices/$INVOICE_ID/email" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Idempotency-Key: pedido_123_email'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${process.env.INVOICE_ID}/email\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Idempotency-Key": "pedido_123_email",
  },
});
const body = await res.json();
console.log(body.data.status); // { data: { emailId, status } }`,
          },
          response: {
            label: "202 Accepted",
            json: `{
  "data": {
    "emailId": "pedido_123_email",
    "status": "queued"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Optional `Idempotency-Key` header: 1–64 characters, letters, numbers, `_` and `-` only. Deduplication checks for the existence of this invoice/key job in the queue." },
            { kind: "callout", tone: "warn", body: "`202` does not confirm delivery. On a repeat request the status may reflect the last state of the email. Errors: `404` invoice missing; `409` documents not ready; `422` customer without email or invalid idempotency key." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices/:id/cancel",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "200 OK / 202 Accepted",
          summary: "Cancels an invoice. A `queued` invoice (scheduled or not yet processed) is cancelled immediately; an `authorized` NFS-e moves to `cancelling` while event 101101 is sent to the Sefin. A `processing` invoice (being issued) registers the request: `202`, still `processing`, with `cancellationRequestedAt` set.",
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices/$INVOICE_ID/cancel" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{"reason":"issue_error","description":"Service amount was informed incorrectly"}'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${process.env.INVOICE_ID}/cancel\`, {
  method: "POST",
  headers: { "X-API-Key": process.env.CORVO_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ reason: "issue_error", description: "Service amount was informed incorrectly" }),
});
const body = await res.json();
console.log(res.status, body.data.status); // 202 "cancelling"`,
          },
          response: {
            label: "202 Accepted",
            json: `{
  "data": {
    "id": "6f1c0e2a-4b7d-4c1e-9a55-2b8f7c3d9e10",
    "status": "cancelling",
    "stage": "completed",
    "cancellationReason": "issue_error",
    "cancellationDescription": "Service amount was informed incorrectly",
    "cancelledAt": null,
    "cancellationRequestedAt": null
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "`reason`: `issue_error`, `service_not_provided` or `other`. `description` is required (15–255 characters) for an authorized NFS-e and optional for a queued invoice. A `processing` invoice also requires `description`; once it is authorized it is cancelled automatically at the Sefin and the credit is not refunded, and if the emission ends `rejected` or `failed` the request is discarded and the reservation refunded as usual. Repeating the request for a `processing` (first request wins), `cancelling` or `cancelled` invoice returns its current state." },
            { kind: "callout", tone: "warn", body: "`202` does not confirm the cancellation: wait for `nfse.invoice.cancelled` or `nfse.invoice.cancellation_rejected` (the invoice returns to `authorized` with `lastErrorCode`). Cancelling an issued NFS-e does not refund the credit; cancelling a queued invoice releases the live reservation. Errors: `404` invoice missing; `409` `ERROR_INVOICE_NOT_CANCELLABLE` (e.g. `retry_pending`, `reconciliation_required`, `manual_review`); `422` `ERROR_INVALID_CANCELLATION_REASON`. If another request already cancelled the invoice, the current state is returned." },
          ],
        },
      ],
    },
    webhooks: {
      title: "Webhooks",
      description: "Register webhook configurations and inspect deliveries.",
      blocks: [
        {
          kind: "text",
          body: "Permissions: `webhooks.view` for fetches; `webhooks.manage` for registration, deletion, test and retry.",
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/webhooks",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Lists the webhook configurations of the account.",
          examples: {
            curl: `curl "$BASE_URL/webhooks" -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data: configs, pagination } = await res.json(); // { data: [...], pagination }
console.log(configs.length, pagination.hasMore);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "7b8c9d0e-1f2a-4b3c-8d5e-6f7a8b9c0d1e",
      "url": "https://integracao.example.com/webhooks/corvo",
      "events": [
        "nfse.invoice.authorized"
      ],
      "active": true,
      "createdAt": "2026-10-10T12:00:00.000Z",
      "updatedAt": "2026-10-10T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "The listing never returns `secret`." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/webhooks",
          scopes: ["full_access"],
          success: "201 Created",
          summary: "Registers a webhook configuration.",
          params: {
            rows: [
              { name: "url", type: "string", required: true, description: "Must use HTTP or HTTPS and must not point to private/loopback/link-local hosts." },
              { name: "events", type: "string[]", required: true, description: "Non-empty array containing only accepted public events (list below)." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/webhooks" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://integracao.example.com/webhooks/corvo",
    "events": [
      "nfse.invoice.authorized",
      "nfse.invoice.documents_ready",
      "nfse.invoice.email_sent",
      "nfse.invoice.email_failed"
    ]
  }'`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    url: "https://integracao.example.com/webhooks/corvo",
    events: [
      "nfse.invoice.authorized",
      "nfse.invoice.documents_ready",
      "nfse.invoice.email_sent",
      "nfse.invoice.email_failed",
    ],
  }),
});
const body = await res.json();
console.log(body.data.secret); // store the secret now — it is not returned again`,
          },
          response: {
            label: "201 Created",
            json: `{
  "data": {
    "id": "7b8c9d0e-1f2a-4b3c-8d5e-6f7a8b9c0d1e",
    "url": "https://integracao.example.com/webhooks/corvo",
    "events": [
      "nfse.invoice.authorized"
    ],
    "active": true,
    "secret": "whsec_...",
    "createdAt": "2026-10-10T12:00:00.000Z",
    "updatedAt": "2026-10-10T12:00:00.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Store the secret at creation time — it never comes back in the listing. `active` starts as `true`." },
          ],
        },
        { kind: "heading", level: 2, body: "Subscribed events" },
        {
          kind: "list",
          items: [
            "`nfse.invoice.authorized`",
            "`nfse.invoice.rejected`",
            "`nfse.invoice.failed`",
            "`nfse.invoice.reconciliation_required`",
            "`nfse.invoice.manual_review`",
            "`nfse.invoice.documents_ready`",
            "`nfse.invoice.email_sent`",
            "`nfse.invoice.email_failed`",
            "`nfse.invoice.fiscal_discrepancy`",
            "`nfse.invoice.cancelled`",
            "`nfse.invoice.cancellation_rejected`",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          body: "`webhook.test` is used by the test route and cannot be included in the subscription array. Accepting an event at registration does not guarantee that every failure path of the current processing emits it; do not rely solely on `failed`/`reconciliation_required` without fetching the invoice.",
        },
        {
          kind: "endpoint",
          method: "DELETE",
          path: "/v1/webhooks/:id",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Deletes a webhook configuration.",
          examples: {
            curl: `curl -X DELETE "$BASE_URL/webhooks/$WEBHOOK_ID" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks/\${process.env.WEBHOOK_ID}\`, {
  method: "DELETE",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.deleted); // { data: { deleted: true } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "deleted": true
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Returns `404` if the configuration is not present in the account." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/webhooks/:id/test",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Sends a `webhook.test` event — always with environment `test` — to the registered URL.",
          examples: {
            curl: `curl -X POST "$BASE_URL/webhooks/$WEBHOOK_ID/test" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks/\${process.env.WEBHOOK_ID}/test\`, {
  method: "POST",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.sent); // { data: { sent: true } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "sent": true
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "`{ \"sent\": true }` is returned when your endpoint answers `2xx`. Otherwise the response is still `200` with `{ \"sent\": false, \"statusCode\": 405, \"error\": \"...\" }` (`statusCode` is `null` if the endpoint could not be reached). A failed test attempt does not schedule the normal retries." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/webhooks/deliveries",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Lists webhook deliveries, newest first.",
          params: {
            rows: [
              { name: "hours", type: "number", required: false, description: "Window in hours (default `24`); it stays fixed on following pages." },
              { name: "limit", type: "integer", required: false, description: "Defaults to `50`; accepts integers from 1 to 1000 (an invalid value returns `400`)." },
              { name: "cursor", type: "string", required: false, description: "`nextCursor` from the previous page, keeping the same filters." },
              { name: "environment", type: "string", required: false, description: "`test` or `live`." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/webhooks/deliveries?hours=24&limit=50" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks/deliveries?hours=24&limit=50\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data: deliveries, pagination } = await res.json(); // { data: WebhookDelivery[], pagination }
console.log(deliveries.length, pagination.nextCursor);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      "webhookConfigId": "7b8c9d0e-1f2a-4b3c-8d5e-6f7a8b9c0d1e",
      "eventType": "nfse.invoice.authorized",
      "environment": "test",
      "url": "https://integracao.example.com/webhooks/corvo",
      "statusCode": 200,
      "status": "sent",
      "durationMs": 120,
      "retryCount": 0,
      "createdAt": "2026-10-10T12:00:05.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": true,
    "nextCursor": "eyJ2IjoxLCJjcmVhdGVkQXQiOiIyMDI2LTEwLTA5VDEyOjAwOjAwLjAwMDAwMFoiLCJpZCI6IjNmMWM4YTkwIn0"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Fields include `id`, `webhookConfigId`, `eventType`, `environment`, `url`, `payload?`, `statusCode?`, `responseBody?`, `errorMessage?`, `status`, `durationMs?`, `retryCount`, `nextRetryAt?`, `lastError?`, `createdAt`. Delivery `status` values: `pending`, `sent`, `delayed`, `failed`, `manual_retry`. Without `?environment`, the listing may return both environments of the account." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/webhooks/deliveries/stats",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Fetches delivery statistics for the recent window.",
          params: {
            rows: [
              { name: "hours", type: "number", required: false, description: "Defaults to `24`." },
              { name: "environment", type: "string", required: false, description: "`test` or `live`." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/webhooks/deliveries/stats?hours=24" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks/deliveries/stats?hours=24\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data: stats } = await res.json(); // { data: { total, sent, ... } }
console.log(stats.total, stats.sent);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "total": 10,
    "sent": 7,
    "failed": 1,
    "pending": 1,
    "delayed": 1
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "The current implementation computes over up to 1000 recent deliveries. `manual_retry` counts toward `total` but has no counter of its own; the sum of the four counters can be smaller than `total`." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/webhooks/deliveries/:id/retry",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Schedules a new delivery attempt for a failed delivery.",
          examples: {
            curl: `curl -X POST "$BASE_URL/webhooks/deliveries/$DELIVERY_ID/retry" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks/deliveries/\${process.env.DELIVERY_ID}/retry\`, {
  method: "POST",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.retried); // { data: { retried: true } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "retried": true
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Schedules the delivery with `status: manual_retry` and resets its counter — it does not mean the receiver already got the event. Returns `404` for a delivery missing from the account." },
          ],
        },
      ],
    },
    credits: {
      title: "Credits",
      description: "Balance, plans, history and one-off purchases (retired).",
      blocks: [
        {
          kind: "text",
          body: "All four operations require `credits.view` and the `full_access` scope.",
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/credits",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Fetches the credit balance of the account.",
          examples: {
            curl: `curl "$BASE_URL/credits" -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/credits\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.balance); // { data: { balance, overageUnits, ... } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "balance": 100,
    "overageUnits": 0,
    "overageAmountCents": 0,
    "hardLimit": null
  }
}`,
          },
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/credits/plans",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Lists the available plans.",
          examples: {
            curl: `curl "$BASE_URL/credits/plans" -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/credits/plans\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data: plans, pagination } = await res.json(); // { data: Plan[], pagination }
console.log(plans.length, pagination.hasMore);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "3ec51af3-c715-4755-95da-c9b0951973dd",
      "slug": "developer",
      "name": "Developer",
      "description": "Start issuing NFS-e for any number of companies",
      "monthlyCreditAllowance": 250,
      "dailyLimit": null,
      "maxActiveCompanies": 999999,
      "creditUnitPriceCents": 12,
      "throughputRps": 50,
      "includesWebhooks": true,
      "includesXmlDownload": true,
      "includesPdfDownload": true,
      "includesApiKeys": true,
      "supportTier": "email",
      "active": true,
      "createdAt": "2026-10-01T12:00:00.000Z",
      "updatedAt": "2026-10-01T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Plan fields: `id`, `slug`, `name`, `description`, `monthlyCreditAllowance`, `dailyLimit` (number or null), `maxActiveCompanies`, `creditUnitPriceCents`, `throughputRps`, `includesWebhooks`, `includesXmlDownload`, `includesPdfDownload`, `includesApiKeys`, `supportTier`, `active`, `createdAt`, `updatedAt`. Slugs defined in the domain: `free`, `developer`, `growth`, `scale`, `volume`; `supportTier`: `community`, `email`, `priority`. Use the returned catalog to identify available plans — do not hard-code prices in the integration." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/credits/history",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Lists credit transactions, newest first.",
          params: {
            rows: [
              { name: "cursor", type: "string", required: false, description: "`nextCursor` from the previous page, keeping the same filters." },
              { name: "limit", type: "integer", required: false, description: "Defaults to `50`; accepts integers from 1 to 1000 (an invalid value returns `400`)." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/credits/history?limit=50" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/credits/history?limit=50\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data: txs, pagination } = await res.json(); // { data: CreditTransaction[], pagination }
console.log(txs.length, pagination.nextCursor);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "f4e3d2c1-5b6a-4c7d-8e9f-0a1b2c3d4e5f",
      "amount": 100,
      "type": "purchase",
      "description": null,
      "createdAt": "2026-10-10T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": true,
    "nextCursor": "eyJ2IjoxLCJjcmVhdGVkQXQiOiIyMDI2LTEwLTA5VDEyOjAwOjAwLjAwMDAwMFoiLCJpZCI6IjNmMWM4YTkwIn0"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "`type`: `purchase`, `subscription_charge`, `topup`, `overage`, `invoice_authorized`, `invoice_rejected`, `expiration`, `message_sent`, `refund`, `adjustment`, `bonus`. `source`: `subscription`, `avulso`, `bonus`. Fields ending in `Cents` use cents; `amount` here is credits, not currency." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/credits/purchase/preview",
          scopes: ["full_access"],
          success: "410 Gone",
          summary: "Retired: one-off credit purchases were replaced by monthly subscriptions and billed overage.",
          params: {
            rows: [
              { name: "amountBrlCents", type: "number", required: true, description: "Positive integer, minimum 1000 (R$ 10)." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/credits/purchase/preview" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "amountBrlCents": 1000 }'`,
            node: `const res = await fetch(\`\${BASE_URL}/credits/purchase/preview\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ amountBrlCents: 1000 }),
});
const body = await res.json();
console.log(res.status, body.code); // 410 "ERROR_GONE"`,
          },
          response: {
            label: "410 Gone",
            json: `{
  "statusCode": 410,
  "code": "ERROR_GONE",
  "message": "Credit purchases have been replaced by monthly subscriptions and billed overage",
  "requestId": "9f1fc995-4ee4-4a92-b285-cf8dff227a97"
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Always answers `410 Gone` with `code: \"ERROR_GONE\"`. To raise capacity, change plan in the dashboard; usage above the allowance is billed as overage." },
          ],
        },
      ],
    },
    billing: {
      title: "Billing & quotas",
      description: "Plan, consumption, availability and plan changes.",
      blocks: [
        {
          kind: "text",
          body: "Fetches require `billing.view`; changes require `billing.manage`. All operations use `full_access`.",
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/billing/plan",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Fetches the current plan and its consumption.",
          examples: {
            curl: `curl "$BASE_URL/billing/plan" -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/billing/plan\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.plan.slug); // { data: { plan, subscription, usage } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "plan": {
      "slug": "developer",
      "name": "Developer",
      "monthly_allowance": 250,
      "daily_limit": null,
      "max_active_companies": 999999,
      "monthly_price_cents": 2990
    },
    "usage": {
      "overage_units": 0,
      "overage_amount_cents": 0,
      "hard_limit": null,
      "credits_used": 10,
      "credits_reserved": 2,
      "credits_remaining": 238,
      "monthly_allowance": 250,
      "daily_usage": 3,
      "daily_limit": null,
      "active_companies": 1,
      "max_active_companies": 999999,
      "period_start": "2026-10-01T00:00:00.000Z",
      "period_end": "2026-10-31T23:59:59.000Z"
    },
    "subscription": {
      "status": "active",
      "paid_until": "2026-10-31T23:59:59.000Z",
      "cancel_at_period_end": false,
      "scheduled_plan": null,
      "blocked": false
    }
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Values are illustrative. This route uses snake_case, unlike `billing/usage`. If no plan is found after resolution: `404`." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/billing/usage",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Fetches quota availability for issuance.",
          examples: {
            curl: `curl "$BASE_URL/billing/usage" -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/billing/usage\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.canEmit); // { data: QuotaStatus }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "canEmit": true,
    "creditsRemaining": 188,
    "creditsUsed": 10,
    "creditsReserved": 2,
    "monthlyAllowance": 200,
    "dailyUsage": 3,
    "dailyLimit": null,
    "activeCompanies": 1,
    "maxActiveCompanies": 10,
    "periodStart": "2026-10-01T00:00:00.000Z",
    "periodEnd": "2026-10-31T23:59:59.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "QuotaStatus: `canEmit` (boolean), `reason?`, `creditsRemaining`, `creditsUsed`, `creditsReserved`, `monthlyAllowance`, `dailyUsage`, `dailyLimit` (number or null), `activeCompanies`, `maxActiveCompanies`, `periodStart`, `periodEnd` (dates or null). Defined `reason` values: `no_credits`, `daily_limit_exceeded`, `company_limit_exceeded`, `plan_blocked`. The current check derives `canEmit` from credits, the daily limit and plan activity — it is not a guarantee that a company's fiscal data/certificate is ready. Quota fetches can initialize the default plan and refresh an expired period." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/billing/upgrade",
          scopes: ["dashboard"],
          success: "200 OK",
          summary: "Schedules the switch to the target plan on the subscription.",
          params: {
            rows: [
              { name: "plan_slug", type: "string", required: true, description: "Slug of the target plan, e.g. `\"growth\"`." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/billing/upgrade" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "plan_slug": "growth" }'`,
            node: `const res = await fetch(\`\${BASE_URL}/billing/upgrade\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ plan_slug: "growth" }),
});
const body = await res.json();
console.log(body.data.scheduled_plan); // { data: { scheduled_plan, effective_at } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "scheduled_plan": "growth",
    "effective_at": "2026-11-01T00:00:00.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Dashboard-only route: API keys have no access (`403`). Requires an active subscription (`409` otherwise) and returns `scheduled_plan` and `effective_at`; checkout and the billing portal also live in the dashboard." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/billing/downgrade",
          scopes: ["dashboard"],
          success: "200 OK",
          summary: "Schedules a plan change for the end of the period.",
          params: {
            rows: [
              { name: "plan_slug", type: "string", required: true, description: "Slug of the target plan, e.g. `\"developer\"`." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/billing/downgrade" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "plan_slug": "developer" }'`,
            node: `const res = await fetch(\`\${BASE_URL}/billing/downgrade\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ plan_slug: "developer" }),
});
const body = await res.json();
console.log(body.data.scheduled_plan); // { data: { scheduled_plan, effective_at } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "scheduled_plan": "developer",
    "effective_at": "2026-11-01T00:00:00.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Dashboard-only route: API keys have no access (`403`). Requires an active subscription (`409` otherwise) and returns `scheduled_plan` and `effective_at`; checkout and the billing portal also live in the dashboard." },
          ],
        },
        { kind: "heading", level: 2, body: "Public plan catalog" },
        { kind: "text", body: "These three routes need no API key or session: use them to show prices on your own site or to size a plan. Amounts are in cents (`...Cents`) and the only cycle is `monthly`; any other `cycle` returns `400`." },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/plans",
          scopes: ["public"],
          success: "200 OK",
          summary: "Lists the plans with their monthly price and allowance.",
          params: {
            rows: [
              { name: "cycle", type: "string", required: false, description: "Only `monthly` is accepted (default)." },
              { name: "limit", type: "integer", required: false, description: "Defaults to `50`; integer from 1 to 1000." },
              { name: "cursor", type: "string", required: false, description: "`nextCursor` from the previous page." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/plans"`,
            node: `const res = await fetch(\`\${BASE_URL}/plans\`);
const { data: plans, pagination } = await res.json(); // { data: PlanQuote[], pagination }
console.log(plans.map((p) => p.slug), pagination.hasMore);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "slug": "developer",
      "name": "Developer",
      "monthlyAllowance": 250,
      "basePriceCents": 2990,
      "perCreditOverageCents": 12,
      "monthlyTotalCents": 2990,
      "currency": "BRL"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Ordered from the smallest to the largest allowance. `monthlyAllowance` is the number of included credits, `perCreditOverageCents` the price of each credit above it and `monthlyTotalCents` the monthly price. This is the pricing view; `GET /v1/credits/plans` returns the plan limits and features instead." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/plans/:slug",
          scopes: ["public"],
          success: "200 OK",
          summary: "Fetches the price of one plan.",
          params: {
            rows: [
              { name: "cycle", type: "string", required: false, description: "Only `monthly` is accepted (default)." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/plans/growth"`,
            node: `const res = await fetch(\`\${BASE_URL}/plans/growth\`);
const body = await res.json();
console.log(body.data.monthlyTotalCents); // { data: PlanQuote }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "slug": "growth",
    "name": "Growth",
    "monthlyAllowance": 750,
    "basePriceCents": 8990,
    "perCreditOverageCents": 12,
    "monthlyTotalCents": 8990,
    "currency": "BRL"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "`slug` is `free`, `developer`, `growth`, `scale` or `volume`. An unknown plan returns `404`." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/plans/quote",
          scopes: ["public"],
          success: "200 OK",
          summary: "Recommends the plan for a monthly volume of invoices and estimates the total cost.",
          params: {
            rows: [
              { name: "volume", type: "integer", required: false, description: "Invoices per month. Required for a quote." },
              { name: "cycle", type: "string", required: false, description: "Only `monthly` is accepted (default)." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/plans/quote?volume=20000"`,
            node: `const res = await fetch(\`\${BASE_URL}/plans/quote?volume=20000\`);
const body = await res.json();
console.log(body.data.recommended_plan, body.data.total_estimated_cents); // { data: Quote | null }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "volume": 20000,
    "recommended_plan": "volume",
    "plan_name": "Volume",
    "monthly_allowance": 10000,
    "overage_credits": 10000,
    "overage_cost_cents": 90000,
    "base_price_cents": 89990,
    "total_estimated_cents": 179990,
    "currency": "BRL",
    "billing_cycle": "monthly"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "This route uses snake_case. `total_estimated_cents` is the plan price plus the estimated overage (`overage_credits` × the plan's price per credit). A missing, zero, negative or non-numeric `volume` returns `200` with `{ \"data\": null }`, not an error." },
          ],
        },
      ],
    },
    "async-issuance": {
      title: "Async issuance",
      description: "How issuance processing, tracking and idempotent retries work.",
      blocks: [
        {
          kind: "text",
          body: "`POST /v1/invoices` responds immediately: a `202` with the invoice in an early status (`queued`, then `processing`/`pending`) means the request was registered and queued — not that the fiscal authority authorized it. Actual processing is asynchronous.",
        },
        { kind: "heading", level: 2, body: "Tracking" },
        {
          kind: "list",
          items: [
            "Poll `GET /v1/invoices/:id` and follow `status`/`stage` until `authorized` (or a terminal failure).",
            "Fetch the transition history with `GET /v1/invoices/:id/events`.",
            "Subscribe to webhooks (`nfse.invoice.authorized`, `nfse.invoice.documents_ready`, etc.) to avoid polling.",
            "Check `GET /v1/billing/usage` (`canEmit`) before issuing again.",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Fiscal statuses: `queued`, `processing`, `authorized`, `rejected`, `retry_pending`, `reconciliation_required`, `manual_review`, `failed`, `cancelling`, `cancelled`. Do not treat authorization as immediate availability of every document — wait for `documentsStatus: \"ready\"` before generating URLs and requesting emails.",
        },
        { kind: "heading", level: 2, body: "Idempotency-Key" },
        {
          kind: "text",
          body: "The `Idempotency-Key` header is optional on issuance and email requests, but recommended — it makes retries safe. Use a stable key per business operation (e.g. the order id in your system) and keep the same key and the same payload on every retry.",
        },
        {
          kind: "text",
          body: "The same key, account and environment with content equivalent to the computed hash recovers the same invoice; different content returns `409` (`ERROR_IDEMPOTENCY_CONFLICT`). The hash is computed before fiscal normalization, with canonical JSON keys and the competence date — do not change how fields are represented between retries (a CNPJ with and without punctuation can produce different hashes).",
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Without the header there is no deduplication — a naive retry after a timeout can emit the same NFS-e twice.",
        },
        {
          kind: "code",
          label: "javascript",
          language: "js",
          code: `const key = \`pedido_\${pedidoId}_emissao\`; // stable per business operation

async function issueWithRetry(buildBody, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(\`\${BASE_URL}/invoices\`, {
      method: "POST",
      headers: {
        "X-API-Key": process.env.CORVO_API_KEY,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(buildBody()),
    });
    if (res.status === 409) {
      // ERROR_IDEMPOTENCY_CONFLICT — payload differs; fix the data, don't retry
      throw new Error("Idempotency conflict: payload changed between retries");
    }
    if (res.status < 500) return res.json(); // success or client error — no retry
    await new Promise((r) => setTimeout(r, 2000 * 2 ** i)); // backoff on 5xx
  }
  throw new Error("Issuance request failed after retries");
}`,
        },
        {
          kind: "callout",
          tone: "accent",
          body: "Retry with backoff only on `429`/`503`, with the same payload and the same `Idempotency-Key`. Do not repeat validation errors without fixing the data.",
        },
      ],
    },
    pagination: {
      title: "Pagination",
      description: "Opaque cursor pagination on every list endpoint.",
      blocks: [
        {
          kind: "text",
          body: "Every listing returns `{ \"data\": [...], \"pagination\": { \"limit\", \"hasMore\", \"nextCursor\" } }`. There is no `page`, `pageSize`, `offset` or `total`.",
        },
        { kind: "heading", level: 2, body: "How to paginate" },
        {
          kind: "list",
          items: [
            "First call: `GET /v1/companies?limit=50`. `limit` accepts integers from 1 to 1000 (default `50`); invalid values return `400` with `ERROR_INVALID_LIMIT`, never silently truncated.",
            "Next pages: send `cursor=<nextCursor>` keeping exactly the same filters. You may change `limit` between pages.",
            "At the end, `hasMore` is `false` and `nextCursor` is `null`. An empty list returns `data: []`.",
            "The cursor is opaque and versioned: do not edit, build or reuse it on another collection, tenant or filter (`400` with `ERROR_INVALID_CURSOR`).",
            "Reads use current data with no snapshot between requests: items inserted later do not show up when continuing a descending listing, and a cursor keeps working if its record is deleted.",
          ],
        },
        {
          kind: "code",
          label: "javascript",
          language: "js",
          code: `async function listAllCompanies() {
  const all = [];
  let cursor;

  do {
    const url = new URL(\`\${BASE_URL}/companies\`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, {
      headers: { "X-API-Key": process.env.CORVO_API_KEY },
    });
    const { data, pagination } = await res.json();
    all.push(...data);
    cursor = pagination.hasMore ? pagination.nextCursor : undefined;
  } while (cursor);

  return all;
}`,
        },
        {
          kind: "callout",
          tone: "warn",
          body: "For webhook deliveries (`GET /v1/webhooks/deliveries`) the `hours` window stays fixed on the following pages. Invoice events are ascending; plans keep the commercial order; the other listings are descending by creation date.",
        },
      ],
    },
    "receiving-webhooks": {
      title: "Receiving webhooks",
      description: "Outbound request format, event types, retries and signature verification.",
      blocks: [
        {
          kind: "text",
          body: "Corvo sends a JSON POST to your registered URL. Respond with HTTP 2xx within 10 seconds; enqueue slow work in your receiver.",
        },
        { kind: "heading", level: 2, body: "Request format" },
        {
          kind: "list",
          items: [
            "Method: `POST`.",
            "Headers: `Content-Type: application/json`, `X-Corvo-Signature: sha256=<hex>`.",
            "Body: a JSON envelope with `id`, `type`, `environment`, `createdAt` and `data`.",
          ],
        },
        {
          kind: "code",
          label: "json",
          language: "json",
          code: `{
  "id": "evt_identifier",
  "type": "nfse.invoice.authorized",
  "environment": "test",
  "createdAt": "2026-10-10T14:00:00.000Z",
  "data": {
    "invoiceId": "INVOICE_UUID",
    "companyId": "COMPANY_UUID",
    "environment": "test",
    "status": "authorized",
    "documentsStatus": "pending",
    "emailStatus": null,
    "stage": "authorized",
    "accessKey": "ACCESS_KEY",
    "nfseNumber": 123
  }
}`,
        },
        {
          kind: "text",
          body: "`data` varies by event; in the fiscal flow it includes the invoice's identification and state. Authorization adds `accessKey`/`nfseNumber`, rejection adds `errorCode`/`errorMessage`, manual review adds `reason`, ready documents add `accessKey`/`nfseNumber`/`documentsReadyAt`, and a sent email adds `sentAt`. The test event carries `{ \"message\": \"This is a test webhook event\" }`.",
        },
        { kind: "heading", level: 2, body: "Event types" },
        {
          kind: "table",
          head: ["Event type", "When"],
          rows: [
            ["`nfse.invoice.authorized`", "The invoice was authorized; adds `accessKey`/`nfseNumber`."],
            ["`nfse.invoice.rejected`", "Authorization was rejected; adds `errorCode`/`errorMessage`."],
            ["`nfse.invoice.failed`", "Processing failed."],
            ["`nfse.invoice.reconciliation_required`", "Reconciliation is required."],
            ["`nfse.invoice.manual_review`", "Manual review is required; adds `reason`."],
            ["`nfse.invoice.documents_ready`", "Documents are ready; adds `accessKey`/`nfseNumber`/`documentsReadyAt`."],
            ["`nfse.invoice.email_sent`", "The notification email was sent; adds `sentAt`."],
            ["`nfse.invoice.email_failed`", "The notification email failed."],
            ["`nfse.invoice.fiscal_discrepancy`", "`invoiceId`, `status` and `differences[]` (`field`, `local`, `authorized`, `delta`, `kind`): difference between Corvo's calculation and the authorized NFS-e, above R$ 0.01 per tax. The authorized XML is not changed."],
            ["`nfse.invoice.cancelled`", "The invoice was cancelled; adds `reason`."],
            ["`nfse.invoice.cancellation_rejected`", "The Sefin refused the cancellation; the invoice is `authorized` again; adds `errorCode` and `errorMessage`."],
            ["`webhook.test`", "Sent by the test route; carries `{ \"message\": \"This is a test webhook event\" }`."],
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Accepting an event at registration does not guarantee that every failure path of the current processing emits it; do not rely solely on `failed`/`reconciliation_required` without fetching the invoice. `webhook.test` cannot be subscribed.",
        },
        { kind: "heading", level: 2, body: "Signature verification" },
        {
          kind: "text",
          body: "The signature is the HMAC-SHA256 of the sent JSON body with the configuration's `secret`, in hex. Verify the raw received body bytes — do not parse and stringify before verifying.",
        },
        {
          kind: "code",
          label: "javascript",
          language: "js",
          code: `import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook(rawBody, signatureHeader, secret) {
  if (typeof signatureHeader !== "string") return false;
  const match = /^sha256=([a-f0-9]{64})$/.exec(signatureHeader);
  if (!match) return false;
  const received = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(received, expected);
}`,
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Always compare in constant time (`timingSafeEqual`) and verify against the raw body bytes.",
        },
        { kind: "heading", level: 2, body: "Retries and delivery semantics" },
        {
          kind: "list",
          items: [
            "The outbox makes up to 5 attempts, with intervals after a failure of 60 seconds, 160 seconds, 15 minutes and 30 minutes; execution depends on the worker.",
            "Retries preserve the original payload — deduplicate by the event `id`.",
            "The receiver may get the same event again; the current signature has no separate verification timestamp, so deduplication on the receiver is required.",
            "Do not assume a global delivery order.",
          ],
        },
        {
          kind: "callout",
          tone: "accent",
          body: "Respond `2xx` quickly and process asynchronously: the 10-second window applies to the HTTP response, not to the work itself.",
        },
      ],
    },
    "integration-checklist": {
      title: "Integration checklist",
      description: "From the first test key to going live.",
      blocks: [
        {
          kind: "list",
          items: [
            "1. Get a `test` key with the right scope. Registering companies/certificates requires `full_access`; an `invoices_read_write` key can issue once the registration exists.",
            "2. Register or fetch the company in the corresponding environment (`POST /v1/companies`, `GET /v1/companies/:id`).",
            "3. In `live`, upload a valid A1 certificate matching the CNPJ (`POST /v1/companies/:companyId/certificates`). The municipal registration is optional.",
            "4. Check readiness with `GET /v1/companies/:id` — `status` must be `ready` and `setupGaps` empty.",
            "5. Issue the first invoices in `test` with a stable `Idempotency-Key` and store `data.id`.",
            "6. Register a webhook (`POST /v1/webhooks`) and confirm delivery with `POST /v1/webhooks/:id/test`.",
            "7. Track status via `GET /v1/invoices/:id` or signed webhooks; generate download URLs and request email only after documents are ready — check `emailStatus` separately.",
          ],
        },
        {
          kind: "callout",
          tone: "accent",
          body: "Going live requires an active certificate matching the CNPJ and credits/quota available (`GET /v1/billing/usage` — `canEmit` must be `true`).",
        },
      ],
    },
    "mcp": {
      "title": "AI agents (MCP)",
      "description": "Connect Claude Code, Cursor and other agents to Corvo with OAuth.",
      "blocks": [
        {
          "kind": "text",
          "body": "The Corvo MCP server lets AI agents (Claude Code, Cursor and other MCP clients) issue and query NFS-e on behalf of a user, without you writing an integration. The agent connects with OAuth: it opens the browser, you sign in to Corvo, pick the workspace and approve. No API key is copied."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Connect an agent"
        },
        {
          "kind": "text",
          "body": "Use the server URL below. It also appears in the dashboard under AI agents, with ready-to-copy commands."
        },
        {
          "kind": "code",
          "label": "Claude Code",
          "language": "bash",
          "code": "claude mcp add --transport http corvo https://api.corvo.tech/mcp"
        },
        {
          "kind": "code",
          "label": "Cursor (.cursor/mcp.json)",
          "language": "json",
          "code": "{\n  \"mcpServers\": {\n    \"corvo\": {\n      \"url\": \"https://api.corvo.tech/mcp\"\n    }\n  }\n}"
        },
        {
          "kind": "list",
          "items": [
            "Add the server to the agent with the URL `https://api.corvo.tech/mcp`.",
            "The agent opens the browser on the Corvo approval screen. If you are not signed in, sign in first; you then return to the approval.",
            "Pick the workspace and click Allow (or Deny).",
            "Go back to the agent. It now has the Corvo tools."
          ]
        },
        {
          "kind": "callout",
          "tone": "warn",
          "body": "When you approve, you choose the connection environment: `test` (invoices with no fiscal value) or `live` (real invoices, using credits). Each connection stays in one environment; to switch, reconnect the agent. Start with test."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Permissions"
        },
        {
          "kind": "table",
          "head": [
            "Scope",
            "What it allows",
            "Roles that can grant it"
          ],
          "rows": [
            [
              "`nfse:read`",
              "Query, list and download the PDF of invoices",
              "admin, developer, billing"
            ],
            [
              "`nfse:write`",
              "Issue invoices",
              "admin, developer"
            ]
          ]
        },
        {
          "kind": "text",
          "body": "A member can only approve scopes that their own role in the workspace allows. A workspace where your role does not cover the request appears disabled on the approval screen."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Tools"
        },
        {
          "kind": "table",
          "head": [
            "Tool",
            "Scope",
            "Main input",
            "Output"
          ],
          "rows": [
            [
              "`nfse_issue`",
              "`nfse:write`",
              "`company_tax_id` (CNPJ) or `company_id`, `amount` (or `services [{description, quantity, unit_price}]`), `customer? {tax_id, name?, email?}` (`tax_id` required when a customer is sent), `description?`, `discount?`, `deduction?` (ISS base deduction, e.g. the partner professional's share), `competence_date?` (default: today), `emission_type?` (`IMMEDIATE`/`SCHEDULE`), `send_email?`, `service_code?`, `external_id?`, `idempotency_key?`",
              "`{ invoice_id, access_key, status }`"
            ],
            [
              "`company_list`",
              "`nfse:read`",
              "`tax_id?` (CNPJ), `limit?`, `cursor?`",
              "`{ companies [{ id, legal_name, tax_id, status, tax_regime, setup_gaps, ready_to_issue }], next_cursor }`"
            ],
            ["`company_get`", "`nfse:read`", "`tax_id` (CNPJ)", "`{ company }` or `{ company: null }`"],
            ["`company_create`", "`nfse:write`", "`legal_name`, `tax_id`, `tax_regime`, `municipality_code` and optional fiscal data", "`{ id, legal_name, tax_id, status }`; certificates remain API-only"],
            ["`nfse_calculate`", "`nfse:read`", "`company_tax_id` or `company_id`, `amount` and optional fiscal data", "Calculation result; no issue, credit reservation or DPS"],
            ["`billing_usage`", "`nfse:read`", "No parameters", "`QuotaStatus` with `canEmit`, allowance and usage"],
            [
              "`nfse_cancel`",
              "`nfse:write`",
              "`invoice_id`, `reason` (`issue_error`, `service_not_provided` or `other`), `description?` (15–255 characters, required for an authorized NFS-e or one being issued)",
              "`{ invoice_id, status, cancelled_at }` (`cancelled`, `cancelling`, or `processing` with the request recorded)"
            ],
            [
              "`nfse_query`",
              "`nfse:read`",
              "`access_key`",
              "`{ access_key, status, nfse_number, authorized_at, last_error }`"
            ],
            [
              "`nfse_list`",
              "`nfse:read`",
              "`status?`, `limit?`, `cursor?`",
              "`{ invoices, next_cursor }`"
            ],
            [
              "`nfse_download_pdf`",
              "`nfse:read`",
              "`access_key` (authorized invoice)",
              "`{ access_key, pdf_base64 }`"
            ],
            [
              "`nfse_get_download_url`",
              "`nfse:read`",
              "`access_key`, `format` (`pdf` or `xml`; authorized invoice)",
              "`{ download_url, expires_at, file_name, mime_type }` (signed URL, valid for one hour)"
            ]
          ]
        },
        {
          "kind": "text",
          "body": "The simplest call is `company_tax_id` plus `amount`: the customer is optional (omit it for an invoice without tomador; if you send one, `tax_id` is required), the competence date defaults to today, the service code comes from the company or falls back to `100901` (LC 116 item 10.09) and the description from the service code. Use `company_get` for one CNPJ and `billing_usage` before issuing. A1 certificates are not exposed over MCP and must be uploaded through the API only. Tool failures come back as a result with `isError: true` and the message as text, so the agent can read and fix them."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "See usage and revoke"
        },
        {
          "kind": "list",
          "items": [
            "In the dashboard, open AI agents → Connected apps: you see each agent, the workspace, the permissions, the last use and how many calls and invoices it made.",
            "Click Revoke to cut access immediately. The agent has to be approved again to come back.",
            "Workspace admins see and can revoke every member's connections; other members see only their own.",
            "Reconnecting the same agent reuses the connection and revokes the previous session."
          ]
        }
      ]
    },
    "llms": {
      "title": "Build with AI (llms.txt)",
      "description": "Give llms.txt to your coding agent and let it implement the Corvo integration.",
      "blocks": [
        {
          "kind": "text",
          "body": "Corvo publishes its documentation in a format built for AI coding agents. Give the address to your agent (Claude Code, Cursor, Codex, Copilot and others) and it reads the API and writes the integration in your project, following the same rules as this documentation."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "What to give the agent"
        },
        {
          "kind": "table",
          "head": [
            "File",
            "Address",
            "Use"
          ],
          "rows": [
            [
              "`llms.txt`",
              "`https://corvo.tech/llms.txt`",
              "Short index with the key facts and a link to every documentation page. The agent opens only what it needs."
            ],
            [
              "`llms-full.txt`",
              "`https://corvo.tech/llms-full.txt`",
              "The whole documentation in one Markdown file (English): endpoints, fields, examples and errors. Best when the agent should implement everything in one pass."
            ]
          ]
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Ready-to-use prompt"
        },
        {
          "kind": "text",
          "body": "Copy it, fill in the part in brackets and paste it into your agent. It points to `llms-full.txt` and sets the rules that matter: test environment, key outside the code, idempotency and asynchronous issuance."
        },
        {
          "kind": "code",
          "label": "Prompt",
          "language": "text",
          "code": "Read https://corvo.tech/llms-full.txt (the Corvo NFS-e API documentation) and integrate invoice issuance into this project.\n\nMy stack and where invoices are created: [describe your language/framework and the place in the code where an order or sale becomes an invoice].\n\nFollow these rules:\n- Use the test environment. Read the key from the CORVO_API_KEY environment variable (it starts with corvo_test_). Never write a key in code, in tests or in commits.\n- Register the company once with POST /v1/companies (taxId, taxRegime, municipalityCode) and keep its id.\n- Before issuing, call POST /v1/invoices/calculate and show the taxes when it makes sense.\n- Issue with POST /v1/invoices and send an Idempotency-Key built from my own order id, so a retry never creates a second invoice.\n- Issuance is asynchronous: save the invoice id, and update the status from the nfse.invoice.authorized and nfse.invoice.rejected webhooks (verify the signature) or by polling GET /v1/invoices/:id.\n- Handle the documented errors (validation, 409, 429 with Retry-After) and never log customer documents.\n- Write tests with mocked HTTP. Do not call the live environment.\n\nWhen you finish, list the files you changed and what I still need to configure (webhook URL, environment variables)."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "In each tool"
        },
        {
          "kind": "list",
          "items": [
            "Claude Code, Codex and other terminal agents: paste the prompt. They fetch the address themselves.",
            "Cursor: add `https://corvo.tech/llms-full.txt` as a documentation source (Settings → Indexing & Docs), then mention it in the chat, or paste the prompt.",
            "VS Code, Windsurf and chat apps: paste the prompt; if the tool cannot open addresses, download `llms-full.txt` and attach the file to the conversation."
          ]
        },
        {
          "kind": "callout",
          "tone": "warn",
          "body": "Never paste a `live` key into a prompt or a chat. Keep `corvo_test_...` in an environment variable, review the generated code before going live (company data, service code and tax regime are yours to confirm) and only then switch the key."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Write the code, or operate directly"
        },
        {
          "kind": "text",
          "body": "This page is for an agent that writes the integration into your repository. If you want the agent to issue and query invoices itself, in a conversation, connect it to the MCP server instead: see AI agents (MCP). Both can be used together."
        }
      ]
    },
  },
};

// The retired credit-purchase reference is intentionally not published.
const { credits: _retiredCreditsEn, ...enPages } = enWithRetiredCredits.pages;
export const en: DocsTree = {
  ...enWithRetiredCredits,
  pages: enPages as DocsTree["pages"],
};
