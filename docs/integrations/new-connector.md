# How to build a connector

A connector teaches Corvo to talk to one sales or payment platform (Woovi, Stripe, Hotmart and so on). It does four things and nothing else: it checks that a webhook really comes from the platform and belongs to the connection, tells Corvo what kind of event it is, turns the event into Corvo's common sale model, and checks the customer's credentials when they connect. Everything after that (rules, tax data, issuing, cancelling, retries) is shared code that never changes per platform. Connectors are reviewed code in this repository: there is no plugin system.

This guide is for contributors. For the design behind it, see [architecture.md](architecture.md) (in Portuguese).

## 1. Start from a real connector

Copy the closest one and change it. Do not invent APIs; the types are in [`api/src/modules/integrations/domain/connector.ts`](../../api/src/modules/integrations/domain/connector.ts).

| If the platform... | Copy |
|---|---|
| sends a complete webhook and you only compare a token (smallest) | `pushinpay/` |
| signs the body with a public key | `woovi/` |
| signs with a shared secret and the webhook only carries an id (you then read the payment with the customer's key) | `stripe/` or `abacatepay/` (they have a `*.client.ts`) |
| is a digital-product platform (orders, refunds, chargebacks, "my share" vs total) | `kiwify/` or `hotmart/` |

All of them live in [`api/src/modules/integrations/connectors/`](../../api/src/modules/integrations/connectors).

## 2. Checklist of files

Replace `<id>` with the connector id (lowercase letters, digits and hyphen only; the registry refuses anything else) and `<Name>` with the class prefix.

New files, in `api/src/modules/integrations/connectors/<id>/`:

- `<id>.connector.ts`: the connector class.
- `<id>.module.ts`: registers it (copy `pushinpay.module.ts`).
- `<id>.connector.spec.ts`: unit spec for `authenticate`, `parse`, `normalize` and `validateConnection`.
- `<id>.flow.postgres.integration.spec.ts`: the whole flow against Postgres (copy `woovi.flow.postgres.integration.spec.ts`).
- `__fixtures__/*.json` and `__fixtures__/README.md`: payloads taken from the platform's documentation.
- `<id>.client.ts` and `<id>.client.spec.ts`: only if you must call the platform's API (see `stripe.client.ts`).

Existing files to edit:

| File | Change |
|---|---|
| `api/src/app.module.ts` | add `<Name>ConnectorModule` to `imports` (API process, receives webhooks) |
| `api/src/worker-app.module.ts` | add it to `imports` too (worker process, normalizes events) |
| `api/src/runtime-wiring.spec.ts` | assert the module is imported by both `AppModule` and `WorkerAppModule` |
| `api/src/modules/integrations/connectors/no-buyer-email.spec.ts` | add the connector if it can send a paid sale without a buyer e-mail |
| `api/src/modules/credits-alerts/account-notice.listener.ts` | add the display name to `PLATFORM_NAMES` (used in e-mails to the account admins) |
| `.gitleaks.toml` | add your spec files to the `paths` allowlist (fake tokens in specs) |
| `web/lib/invoice-origin.ts` | add the provider to the `provider` type and to `PROVIDER_BY_REFERENCE` (the key is the part before `:` in your operation key) |
| `web/components/dashboard/integrations/connect-flow.tsx` | add the id to `providerDescriptionKey` |
| `web/components/dashboard/integrations/pending-sales-panel.tsx` | add the name to `PROVIDER_NAMES` (and to `PIX_PROVIDERS` if it is Pix) |
| `web/messages/pt.json` and `web/messages/en.json` | copy what `kiwify` has: the invoice-origin label ("Sale (Kiwify)", near the top of the file), the connect-flow description ("Approved sales on Kiwify.") and the card text under `IntegrationsPage.platforms` |
| `web/lib/docs/content/pt.ts` and `en.ts` | a section for the platform under `payment-integrations` (credentials, steps, events, refunds), and update the page description |
| `web/tests/docs-integrations.test.ts` | assert the terms your docs section must contain |
| `web/lib/integrations-catalog.ts` | add the card to `INTEGRATION_PLATFORMS`; this is what the public [/integrations](https://corvo.tech/integrations) page lists |
| `web/tests/integrations-page.test.tsx`, `web/tests/invoice-origin.test.tsx` | extend the existing assertions |

To see all of this in one diff, open a recent connector PR (for example `git diff origin/main...origin/feat/conector-mercadopago --stat` while that branch exists, or the Hotmart and Kiwify PRs in the history). The list above was taken from there.

## 3. Step by step

### 3.1 Manifest

The manifest describes the connection form and the instructions the customer sees. Fields that matter:

- `id`, `name`, `version: '1'`.
- `credentialFields`: one entry per value the customer (or Corvo) provides.
  - `secret: true`: stored encrypted, never returned by the API.
  - `generate: true`: Corvo creates the value when the connection is created (use it for a shared token, so the customer does not invent a weak one).
  - `inWebhookUrl: true`: the value is appended to the webhook URL as a query parameter named after `key` (see `webhookSecret` in `pushinpay`, `stripe`, `kiwify`).
  - `revealOnce: true`: shown to the customer once, to paste into the platform (not part of the URL).
  - `optional: true`: the customer may leave it empty.
  - `afterUrl: true`: the platform only gives this value after the webhook endpoint exists (a signing secret). The connection is created without it and cannot be activated until it is set; deliveries are rejected meanwhile (see `webhookSigningSecret` in `stripe`).
  - `options: [...]`: a choice. The first is the default. `kiwify` and `hotmart` use `invoiceValue` with `['total', 'mine']` so the customer can issue the invoice for the full price or only their share.
- `webhookInstructions: { pt, en }`: step by step, both languages, no secrets.
- `webhookEvents` (optional): the exact events the customer must tick (see `stripe`).
- `supportedFlows`: what you really support (`['pix']`, `['order']`, ...). Do not claim more.

### 3.2 authenticate

`authenticate(req, connection)` runs before anything is stored. Return `{ ok: true }` or `{ ok: false, reason }`.

- Compare secrets and tokens in constant time. Copy `sameText` from `pushinpay.connector.ts` (`timingSafeEqual` after a length check). Never use `===` on a secret.
- If the platform signs the body, verify the signature over `req.rawBody` (the bytes as received, not re-serialized JSON). See `createVerify` in `woovi.connector.ts` or the HMAC check in `stripe.connector.ts`.
- If the platform signs nothing, a long random secret in the URL (`inWebhookUrl`) plus a header token is the model (`pushinpay`).
- Header names are lowercase in `req.headers`.
- The reason string goes to logs: it must be a short code like `bad_secret`, never the value you compared.

### 3.3 parse

`parse(req)` returns `{ kind: 'test' }` (the platform's "send a test" button), `{ kind: 'ignored', externalType }` (an event you do not handle) or `{ kind: 'operation', deliveryId, externalType }`.

- It must depend only on `rawBody`. The worker calls it again later from the stored body, without headers or query.
- `deliveryId` must be the same on every redelivery of the same event, and different for a different state of the same sale (`pushinpay` uses `<id>:<status>`).
- A malformed body should throw `ConnectorDataError`, not crash with a `TypeError`.

### 3.4 normalize (toOperation)

`normalize` returns a `NormalizedOperation`. The important fields:

- `operationKey`: `<provider>:<id>`, the identity of one individual charge. A subscription id is not one: each paid cycle needs its own key. The part before `:` is what `web/lib/invoice-origin.ts` maps back to the platform.
- `commercialState`: `pending | paid | refunded | disputed | canceled`. Only `paid` issues an invoice.
- `amountCents`, `discountCents`: integer cents, never floats. `currency`: only `BRL` issues; anything else is blocked by the shared code.
- `customer`: `{ name, email, taxId, taxIdMasked }`. Use `normalizeTaxID` from `@/shared/tax-id` for the document. If the platform masks it (`***`), set `taxIdMasked: true` and `taxId: null`. If it sends no buyer e-mail, use `null`: the invoice is still issued, just not e-mailed.
- `externalRefs`: ids used to link later events to this sale.
- `items`, `description`, `paidAt`, `occurredAt`.
- `sellerIssuesInvoice`: `false` when the platform says someone else issues the invoice.

Refunds and disputes are not special cases in the shared code: they are the same operation with a different `commercialState`.

- If the event names the sale (a refund webhook that carries the order), use the same `operationKey` with `commercialState: 'refunded'` (or `'disputed'` for a chargeback or dispute).
- If the event only names the original payment, set `refersTo: { ref, value }` and Corvo finds the sale whose `externalRefs[ref]` equals `value`. If there is no such sale, the event is ignored with `refund_sale_not_found` (see `pushinpay` and `woovi`).
- What happens next is decided by the customer's rule: with "cancel invoice on refund" on (`cancelOnRefund`), a refund cancels the issued invoice; without it, and always for a dispute, the sale is only flagged (`refund_after_invoice`) for a person to decide. The connector never cancels anything itself.
- Partial refunds: only treat one as a refund if you can tell it apart from a full one. If you cannot, say so in the fixtures README.

Throw `ConnectorDataError` when the data cannot become an invoice without a person looking at it, `ConnectorTransientError` for a failure worth retrying (network, 5xx), and `ConnectorAuthError` when the customer's credentials were rejected (the connection then asks to be reauthorized).

### 3.5 validateConnection and checkCredentials

`validateConnection(credentials, environment, connection)` runs when the customer connects. Return `{ externalAccountId }`: ask the platform who the account is when you can. If the platform identifies nothing (as with PushinPay), derive a stable id from the connection secret. Set `accountIdOptional = true` on the class only if the account may stay unidentified (Stripe with no API key).

`checkCredentials` (optional) refuses credentials of the wrong kind before they are stored by throwing `ConnectorCredentialRejected`. Stripe uses it to refuse a full-access `sk_` key. The message must not echo the secret.

### 3.6 Module and wiring

Copy `pushinpay.module.ts`: it imports `IntegrationsModule` and registers the connector with `ConnectorRegistry` in `onModuleInit`. Then add the module to `app.module.ts` and `worker-app.module.ts` and assert both in `runtime-wiring.spec.ts`. Forgetting the worker is the classic mistake: webhooks are accepted and then never processed.

## 4. Security rules

- Never log a token, secret, signature, webhook body or any personal data (name, e-mail, CPF/CNPJ). Errors you throw must not contain them either; use codes.
- Constant-time compare for every secret. Verify signatures over `rawBody`.
- When the platform supports a shared token or secret, let Corvo generate it (`generate: true`); do not ask the customer to invent one.
- Ask for the least access: a read-only restricted key, never a full-access one, and refuse the wrong kind in `checkCredentials`.
- A valid signature from the platform proves the sender, not that the event belongs to this connection. If every customer's events are signed with the same key, also require the per-connection secret or token.
- A connector never calls the platform to charge, refund or change anything.
- No dynamic `RegExp` (`new RegExp(variable)`): Semgrep fails the PR. Use string methods or fixed literals.
- No real credentials anywhere, including fixtures and specs.

## 5. Fixtures from the official documentation

Build fixtures from the platform's public webhook documentation, not from a real account.

1. Save each documented example payload as a JSON file in `__fixtures__/` (paid, refunded, disputed, a payload without buyer e-mail or document, a "test" event, an event you ignore).
2. Keep the documented field names and shapes. Invent only the values, and never use real people, documents or tokens.
3. Write `__fixtures__/README.md` ("exemplo da documentação"): the documentation URL, what each file is, and a list of what is **not** confirmed and needs a real sale in the platform's sandbox to verify (units of the amount, optional fields, whether a refund carries the same id as the payment, whether a legacy event is still sent). The existing READMEs (for example `woovi/__fixtures__/README.md`) are in Portuguese and show the format; matching them is welcome, English is fine too.
4. Load them in the specs with `readFileSync(join(__dirname, '__fixtures__', ...))`.

## 6. Tests

Write both specs.

- Unit spec (`<id>.connector.spec.ts`): authentication accepts the right secret or signature and rejects a wrong or missing one; `parse` for each fixture (operation, ignored, test, malformed); `normalize` for paid, with and without buyer data, masked document, refund, dispute, bad amount; `validateConnection`. `pushinpay.connector.spec.ts` is the smallest example.
- Flow spec (`<id>.flow.postgres.integration.spec.ts`): receives a signed webhook, processes it and checks the invoice request that comes out, then a refund (with and without cancel-on-refund), a refund of an unknown sale, the platform's test webhook, a bad signature or token, and the same webhook delivered twice (no duplicate invoice). It runs only when `MIGRATION_TEST_DATABASE_URL` is set (otherwise it is skipped, and CI treats a skip as a failure).
- Add your connector to `no-buyer-email.spec.ts` if applicable.

### Running them

Node 24 (see `.nvmrc`) and Yarn 1.22.

```bash
cd api
yarn install --frozen-lockfile

# unit spec only, no database
yarn jest src/modules/integrations/connectors/<id>
```

For the flow spec you need Postgres. The `api/docker-compose.yml` file starts one (port 5434) with a `corvo_test` database already created by `api/docker/init-db.sh`:

```bash
cd api
docker compose up -d postgres redis
MIGRATION_TEST_DATABASE_URL=postgresql://corvo:changeme@localhost:5434/corvo_test \
  NODE_ENV=test \
  yarn jest --runInBand src/modules/integrations/connectors/<id>
```

The URL must point to localhost and a database whose name ends in `_test`; the spec refuses anything else. If you changed `POSTGRES_USER` or `POSTGRES_PASSWORD` in your `api/.env`, use those values. Redis is not needed by the connector specs, but other suites in a full `yarn test` need it (`REDIS_URL`).

Before opening the PR:

```bash
cd api
yarn lint:check
yarn typecheck
yarn typecheck:tests
cd ../web
yarn lint
yarn typecheck
yarn test
```

## 7. CI rules

CI (`.github/workflows/ci.yml`, `.github/workflows/security.yml`) will block the PR if:

- Any test is skipped. Specs that need Postgres must really run (`scripts/assert-no-skipped-tests.mjs`). Do not add `it.skip`, `describe.skip` or `.only`.
- `api` lint, typecheck, tests or build fail, or the `web` lint, typecheck, tests or build fail.
- The public OpenAPI is out of date. A connector normally does not change the HTTP contract, but if the PR touches controllers or DTOs run `yarn openapi:generate` in `api/` and commit `docs/openapi` and `web/public/openapi.json`; CI fails on any diff.
- Semgrep finds an issue (for example a dynamic `RegExp`).
- gitleaks finds something that looks like a secret. Fake tokens in your specs are allowed only through the `.gitleaks.toml` entries; prefer obviously fake values.

## 8. What to put in the pull request

- Links to the platform documentation pages you used (webhook events, signature scheme, payload examples, sandbox).
- The events you handle and the ones you deliberately ignore.
- How a refund and a dispute behave.
- What you could not confirm without a real sale (copy the "not confirmed" list from the fixtures README) so a maintainer can run it in the platform's sandbox.
- The checks you ran and their output (unit and flow specs, lint, typecheck).
- Whether the PR changes any HTTP contract (normally it does not).

## 9. The public page

The public [/integrations](https://corvo.tech/integrations) page lists platforms from `web/lib/integrations-catalog.ts`; the text on each card comes from `IntegrationsPage.platforms` in `web/messages/pt.json` and `en.json`. Add your platform there in the same PR, so the page and the code do not disagree.
