// lib/docs/content/en.ts
import type { DocsTree } from "../types";

export const en: DocsTree = {
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
    description: "Issue and manage NFS-e programmatically with an API key.",
    blocks: [
      {
        kind: "text",
        body: "The Corvo API lets you register companies, upload A1 certificates, issue service invoices (NFS-e), and track their full lifecycle via webhooks.",
      },
      { kind: "heading", level: 2, body: "Quickstart" },
      {
        kind: "code",
        label: "bash",
        language: "bash",
        code: "export BASE_URL='https://YOUR_DOMAIN/v1'\nexport CORVO_API_KEY='corvo_test_your_key'\n\ncurl \"$BASE_URL/companies\" -H \"X-API-Key: $CORVO_API_KEY\"",
      },
      {
        kind: "text",
        body: "All paths in this documentation are relative to `BASE_URL` (the origin of your installation plus `/v1`).",
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
          ["Issue / fetch an invoice", "`{ \"data\": { \"props\": Invoice } }`"],
          ["List invoices and events", "`{ \"data\": [{ \"props\": ... }], \"pagination\": {...} }`"],
          ["Download URL / email", "`{ \"data\": ... }`"],
          ["Webhooks and deliveries", "`{ \"data\": ... } or paginated listing`"],
          ["Credit balance", "`{ \"data\": { \"tenantId\", \"balance\", ... } }`"],
          ["Plans / credit history", "`{ \"data\": [...], \"pagination\": {...} }`"],
          ["Billing", "`{ \"data\": ... }`"],
        ],
      },
      {
        kind: "text",
        body: "Resource content is preserved: an invoice still carries `props` inside `data` (`data.props`). Read `data` exactly once. PDF/XML, redirects, OAuth, MCP/JSON-RPC, health checks and `204` responses keep their own formats.",
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
          ["GET", "`/v1/credits`", "Fetch balance", "200"],
          ["GET", "`/v1/credits/plans`", "List plans", "200"],
          ["GET", "`/v1/credits/history`", "List transactions", "200"],
          ["POST", "`/v1/credits/purchase/preview`", "One-off purchase (retired)", "410"],
          ["GET", "`/v1/billing/plan`", "Fetch plan and consumption", "200"],
          ["GET", "`/v1/billing/usage`", "Fetch availability and quotas", "200"],
          ["POST", "`/v1/billing/upgrade`", "Schedule a plan change", "200"],
          ["POST", "`/v1/billing/downgrade`", "Schedule a plan change", "200"],
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
          "In `live`, provide municipal registration and upload a valid A1 certificate (.p12) with its password (`POST /v1/companies/:companyId/certificates`).",
          "`POST /v1/invoices` — use `companyTaxId` (company CNPJ) to request issuance (the `live` environment requires the company to be ready).",
          "Track the lifecycle with `GET /v1/invoices/:id` and webhooks — issuance is asynchronous.",
        ],
      },
    ],
  },
  pages: {
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
            "In `live`, issuance verifies the company, municipal registration, blocks and active certificate; credits and issuance limits also apply.",
            "In `test`, issuance requires an existing company but skips the readiness and certificate checks of the `live` flow.",
            "Webhook deliveries use the explicit `?environment=test|live` filter; without it, they may return both of the account's environments, regardless of the key's environment.",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Credits, plan and webhook settings belong to the account. A `test` key with `full_access` can also change plans: do not treat the whole API as a financial sandbox.",
        },
        { kind: "callout", tone: "accent", body: "The server resolves the tenant from authentication: never send `tenantId` in a body. Resources of another tenant return `404`." },
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
          code: "export BASE_URL='https://YOUR_DOMAIN/v1'\nexport CORVO_API_KEY='corvo_test_your_key'\n\ncurl \"$BASE_URL/companies\" -H \"X-API-Key: $CORVO_API_KEY\"",
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
            ["`ERROR_COMPANY_NOT_READY` / `ERROR_COMPANY_BLOCKED`", "Company missing municipal registration/certificate in `live`, or blocked."],
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
            ["Pre-authentication protection, per IP", "1200"],
          ],
        },
        {
          kind: "text",
          body: "Sensitive routes (OTP/magic link, Turnstile) have extra per-route budgets on top of the general limit. Health checks, preflight and Stripe receiving are exempt.",
        },
        {
          kind: "text",
          body: "Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (Unix timestamp in seconds). On `429`, the `Retry-After` header gives the seconds until you can retry and the body carries `code: \"ERROR_RATE_LIMIT_EXCEEDED\"`. On sensitive routes, the route-specific headers replace the general ones.",
        },
        {
          kind: "callout",
          tone: "accent",
          body: "Honor `Retry-After` before retrying and use exponential backoff during spikes. Do not treat the plan's `throughputRps` as the HTTP limit.",
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
              { name: "municipalReg", type: "string or null", required: false, description: "Required and nonblank when registering in `live`; optional in test mode. `null` on test creation means do not set." },
              { name: "municipalityCode", type: "string", required: true, description: "Exactly 7 digits (IBGE), required in test and live mode. Used as the issuer municipality and default service location." },
              { name: "defaultServiceCode", type: "string", required: false, description: "Exactly 6 digits (cTribNac); default for new invoices. Without it, provide `service.code` when issuing." },
              { name: "simpleNational", type: "boolean", required: false, description: "Defaults to `false`." },
              { name: "specialRegime", type: "string", required: false, description: "Up to 50 characters." },
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
            { kind: "callout", tone: "accent", body: "The input body uses `address`, but the response exposes flat fields: `addressStreet`, `addressNumber`, `addressCity`, `addressState`, `addressZip` etc. `status` is `pending_setup`, `ready` or `blocked`; `setupGaps` lists pending items (`municipality_code`, `municipal_registration`, `certificate`)." },
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
            { kind: "callout", tone: "warn", body: "A company that does not exist, was deleted, or belongs to another environment/account returns `404`." },
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
              { name: "municipalReg", type: "string or null", required: false, description: "Municipal registration. `null` clears the registration." },
              { name: "municipalityCode", type: "string", required: false, description: "Exactly 7 digits when provided; omit to keep the existing value. Cannot be cleared." },
              { name: "defaultServiceCode", type: "string or null", required: false, description: "Exactly 6 digits when provided. Omit to keep; null clears the default." },
              { name: "simpleNational", type: "boolean", required: false, description: "Defaults to `false`." },
              { name: "specialRegime", type: "string", required: false, description: "Up to 50 characters." },
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
              { name: "customer", type: "object", required: true, description: "`name` (required), `taxId` (required: valid CPF or CNPJ, normalized), `email` (optional; required when email sending is enabled; no email format validation in this DTO/domain) and `address` (optional: `street`, `city`, `state`, `zip`, `country` are optional strings; if you fill in city or state, fill in both; state must be valid)." },
              { name: "service", type: "object", required: true, description: "`code` optional when the company has `defaultServiceCode`; exactly 6 digits when provided. `municipalityCode` inherits the company municipality; when provided, exactly 7 digits and sets the service location. `description` is an optional string. Empty, null or invalid values do not use the defaults." },
              { name: "amount", type: "number", required: true, description: "Value in reais, positive, up to 9999999999.99 with at most 2 decimals." },
              { name: "competenceDate", type: "string ISO 8601", required: true, description: "Valid competence date, not in the future." },
              { name: "email", type: "boolean", required: false, description: "Requests a notification; defaults to `false`." },
              { name: "options.email.send", type: "boolean", required: false, description: "When set, takes precedence over `email`." },
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
console.log(body.data.props.id); // { data: { props: Invoice } }`,
          },
          response: {
            label: "202 Accepted",
            json: `{
  "data": {
    "props": {
      "id": "6c4d2e81-0a3b-4c5d-9e7f-1a2b3c4d5e6f",
      "companyId": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
      "environment": "test",
      "externalId": "pedido_123",
      "idempotencyKey": "pedido_123_emissao",
      "status": "queued",
      "amount": 150.5,
      "currency": "BRL",
      "competenceDate": "2026-10-01",
      "stage": "pending",
      "createdAt": "2026-10-10T12:00:00.000Z"
    }
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Send an `Idempotency-Key` header: with the same key, account and environment and equivalent content, the hash recovers the same invoice; different content returns `409` (`IdempotencyConflictError`). The hash is computed before fiscal normalization, with canonical JSON keys and the competence date. Do not change how fields are represented between retries: a CNPJ with and without punctuation can produce different hashes. Without a key there is no deduplication." },
            { kind: "callout", tone: "warn", body: "Issuance is asynchronous — see the Async issuance guide. Track the invoice with `GET /v1/invoices/:id` or webhooks. The customer address is reduced to `city` and `state` in the snapshot; `street`, `zip` and `country` are not preserved — do not rely on them in the response." },
          ],
        },
        { kind: "heading", level: 2, body: "Invoice schema" },
        { kind: "text", body: "The object sits inside `props`:" },
        {
          kind: "table",
          head: ["Fields", "Type / notes"],
          rows: [
            ["`id`, `companyId`, `tenantId`", "Identification strings."],
            ["`environment`", "`test` or `live`."],
            ["`externalId`, `idempotencyKey`", "String or null."],
            ["`status`", "Enum described below."],
            ["`customerSnapshot`", "`taxId`, `name`, `email?`, `address?: { city, state, country? }`."],
            ["`serviceSnapshot`", "`description`, `code`, `municipalityCode`."],
            ["`taxSnapshot`", "Fiscal information object."],
            ["`amount`, `currency`, `competenceDate`", "Number in reais, currency and ISO date."],
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
const { data: invoices, pagination } = await res.json(); // { data: [{ props: Invoice }], pagination }
console.log(invoices.length, pagination.nextCursor);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "props": {
        "id": "6c4d2e81-0a3b-4c5d-9e7f-1a2b3c4d5e6f",
        "status": "authorized",
        "amount": 150.5,
        "competenceDate": "2026-10-01",
        "createdAt": "2026-10-10T12:00:00.000Z"
      }
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
console.log(body.data.props.status); // { data: { props: Invoice } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "props": {
      "id": "6c4d2e81-0a3b-4c5d-9e7f-1a2b3c4d5e6f",
      "status": "authorized",
      "stage": "documents_ready",
      "documentsStatus": "ready",
      "accessKey": "35260712345678900000350010000000011000000019",
      "nfseNumber": 123
    }
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Returns `404` if the invoice is not found in the account/environment." },
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
          summary: "Fetches the status history of an invoice. No pagination on this route.",
          examples: {
            curl: `curl "$BASE_URL/invoices/$INVOICE_ID/events" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${process.env.INVOICE_ID}/events\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data: events, pagination } = await res.json(); // { data: [{ props: InvoiceEvent }], pagination }
console.log(events.length, pagination.hasMore);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "props": {
        "id": "e1d2c3b4-5a6f-4b7c-8d9e-0f1a2b3c4d5e",
        "invoiceId": "6c4d2e81-0a3b-4c5d-9e7f-1a2b3c4d5e6f",
        "fromStatus": "queued",
        "toStatus": "authorized",
        "reason": null,
        "createdAt": "2026-10-10T12:01:00.000Z"
      }
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
          summary: "Cancels an invoice. A `queued` invoice (scheduled or not yet processed) is cancelled immediately; an `authorized` NFS-e moves to `cancelling` while event 101101 is sent to the Sefin.",
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
console.log(res.status, body.data.props.status); // 202 "cancelling"`,
          },
          response: {
            label: "202 Accepted",
            json: `{
  "data": {
    "props": {
      "id": "6f1c0e2a-4b7d-4c1e-9a55-2b8f7c3d9e10",
      "status": "cancelling",
      "stage": "completed",
      "cancellationReason": "issue_error",
      "cancellationDescription": "Service amount was informed incorrectly",
      "cancelledAt": null
    }
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "`reason`: `issue_error`, `service_not_provided` or `other`. `description` is required (15–255 characters) for an authorized NFS-e and optional for a queued invoice. Repeating the request for a `cancelling` or `cancelled` invoice returns its current state." },
            { kind: "callout", tone: "warn", body: "`202` does not confirm the cancellation: wait for `nfse.invoice.cancelled` or `nfse.invoice.cancellation_rejected` (the invoice returns to `authorized` with `lastErrorCode`). Cancelling an issued NFS-e does not refund the credit; cancelling a queued invoice releases the live reservation. Errors: `404` invoice missing; `409` `ERROR_INVOICE_NOT_CANCELLABLE` or `ERROR_CONCURRENT_INVOICE_TRANSITION`; `422` `ERROR_INVALID_CANCELLATION_REASON`." },
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
            { kind: "callout", tone: "accent", body: "The listing never returns `secret` or `tenantId`." },
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
            { kind: "callout", tone: "accent", body: "`{ \"sent\": true }` is returned when the attempt succeeds. A failed test attempt does not schedule the normal retries." },
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
            { kind: "callout", tone: "accent", body: "Fields include `id`, `tenantId`, `webhookConfigId`, `eventType`, `environment`, `url`, `payload?`, `statusCode?`, `responseBody?`, `errorMessage?`, `status`, `durationMs?`, `retryCount`, `nextRetryAt?`, `lastError?`, `createdAt`. Delivery `status` values: `pending`, `sent`, `delayed`, `failed`, `manual_retry`. Without `?environment`, the listing may return both environments of the account." },
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
console.log(body.data.balance); // { data: { tenantId, balance, overageUnits, ... } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "tenantId": "9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
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
const { data: plans, pagination } = await res.json(); // { data: [{ props: Plan }], pagination }
console.log(plans.length, pagination.hasMore);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "props": {
        "id": "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        "slug": "developer",
        "name": "Developer",
        "monthlyCreditAllowance": 100,
        "dailyLimit": null,
        "maxActiveCompanies": 1,
        "creditUnitPriceCents": 10,
        "supportTier": "email",
        "active": true
      }
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
const { data: txs, pagination } = await res.json(); // { data: [{ props: CreditTransaction }], pagination }
console.log(txs.length, pagination.nextCursor);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "props": {
        "id": "f4e3d2c1-5b6a-4c7d-8e9f-0a1b2c3d4e5f",
        "amount": 100,
        "type": "purchase",
        "description": null,
        "createdAt": "2026-10-10T12:00:00.000Z"
      }
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
      "monthly_allowance": 100,
      "daily_limit": null,
      "max_active_companies": 1,
      "monthly_price_cents": 1000
    },
    "usage": {
      "overage_units": 0,
      "overage_amount_cents": 0,
      "hard_limit": null,
      "credits_used": 10,
      "credits_reserved": 2,
      "credits_remaining": 88,
      "monthly_allowance": 100,
      "daily_usage": 3,
      "daily_limit": null,
      "active_companies": 1,
      "max_active_companies": 1,
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
    "creditsRemaining": 88,
    "creditsUsed": 10,
    "creditsReserved": 2,
    "monthlyAllowance": 100,
    "dailyUsage": 3,
    "dailyLimit": null,
    "activeCompanies": 1,
    "maxActiveCompanies": 1,
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
          scopes: ["full_access"],
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
          scopes: ["full_access"],
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
          body: "The same key, account and environment with content equivalent to the computed hash recovers the same invoice; different content returns `409` (`IdempotencyConflictError`). The hash is computed before fiscal normalization, with canonical JSON keys and the competence date — do not change how fields are represented between retries (a CNPJ with and without punctuation can produce different hashes).",
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
      // IdempotencyConflictError — payload differs; fix the data, don't retry
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
            "3. In `live`, fill in the municipal registration and upload a valid A1 certificate matching the CNPJ (`POST /v1/companies/:companyId/certificates`).",
            "4. Check readiness with `GET /v1/companies/:id` — `status` must be `ready` and `setupGaps` empty.",
            "5. Issue the first invoices in `test` with a stable `Idempotency-Key` and store `data.props.id`.",
            "6. Register a webhook (`POST /v1/webhooks`) and confirm delivery with `POST /v1/webhooks/:id/test`.",
            "7. Track status via `GET /v1/invoices/:id` or signed webhooks; generate download URLs and request email only after documents are ready — check `emailStatus` separately.",
          ],
        },
        {
          kind: "callout",
          tone: "accent",
          body: "Going live requires: municipal registration filled in, an active certificate matching the CNPJ, and credits/quota available (`GET /v1/billing/usage` — `canEmit` must be `true`). Before production, verify the domain and the published version: this documentation describes the current local checkout and does not assume the deployed contracts are identical.",
        },
      ],
    },
  },
};
