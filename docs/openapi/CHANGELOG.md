# Public API changelog

What changed in the public API since **2026-10-26** (version `0.2.0` of the SDKs), so each SDK repository knows what to update. The contract itself is [openapi.json](./openapi.json); the route list is in [README.md](./README.md).

Built from `git log --since=2026-10-26` and the diff of the controllers and DTOs against commit `0543600` (the last one of 2026-10-26).

## Unreleased

- New `GET /companies/{id}/nfe-readiness` (`companies_getNfeReadiness`): asks the SEFAZ "Consulta Cadastro" with the company certificate and answers `status` (`ready`, `ie_suggested`, `ie_choose`, `no_registration`, `not_enabled`, `not_credentialed`, `ie_mismatch`, `unavailable`, `no_certificate`, `company_incomplete`), a plain `message` and `suggestedStateRegistration`. `PUT /companies/{id}/nfe-settings` may now leave `stateRegistration` out (the IE the SEFAZ has is used when exactly one is enabled; else `422 STATE_REGISTRATION_REQUIRED`), answers `registrationWarning` when the SEFAZ says the saved IE will be refused, and an NF-e/NFC-e is stopped with `422 STATE_REGISTRATION_NOT_ENABLED` when a fresh consulta says so. Additive.
- `GET /fiscal-portal/status` answers a new field, `connection` (`state`, `since`, `ourSide`): what the connection tests see (`ok`, `portal_down`, `gov_unreachable_from_us`, `no_internet`, `emission_failures`). Additive; invoices wait in the queue in every state.

## Next: NFC-e in test mode (homologação)

NFC-e (consumer sale, model 65) joins the same `/invoices` routes with `type: "nfce"`. It is open to every account (no release; production answers `422 NFE_PRODUCTION_DISABLED` until it is turned on), runs only against the SEFAZ test environment and starts in SP. Nothing about NFS-e or NF-e changed: the NFC-e only adds values and optional fields.

- `invoices_create`, `invoices_validate` and `invoices_resubmit` accept the NFC-e body (`recipient` optional, `indPres` 1, 4 or 5, `payments[].card`; no `natOp`); the `202` answer is `{ type: "nfce", id, status, replayed? }`. `invoices_list` takes `type=nfce`, and `type=all` also brings the NFC-e.
- `invoices_get` of an NFC-e adds `qrCode` and `urlChave`. `invoices_downloadPdf` answers the DANFCE (80 mm cupom); `?layout=a4` answers the same note on an A4 page (the NF-e and the NFS-e ignore `layout`).
- `invoices_correct` on a NFC-e answers `422 INVOICE_OPERATION_NOT_SUPPORTED` (there is no correction letter). `invoices_cancel` is meant for the first 30 minutes. `invoices_createInutilization` and `invoices_numberGaps` take `type=nfce`.
- Company settings (`companies_getNfeSettings` / `companies_updateNfeSettings`) gain `nfceDefaultSeries` (0 to 999, default 1).
- New codes (open string): `NFCE_CONSUMER_ID_REQUIRED`, `NFCE_DELIVERY_ADDRESS_REQUIRED`, `NFCE_IND_PRES_INVALID`, `NFCE_CARD_DATA_REQUIRED`, `NFCE_CARD_BRAND_INVALID`, `NFCE_CARD_NOT_ALLOWED`, `NFCE_NO_PAYMENT_AMOUNT`, `NFCE_SCOPE_NOT_SUPPORTED`.
- New webhook events, with `data.documentType: "nfce"`: `nfce.document.authorized`, `.rejected`, `.denied`, `.failed`, `.reconciliation_required`, `.manual_review`, `.documents_ready`, `.email_sent`, `.email_failed`, `.cancelled`, `.cancellation_rejected`, and `nfce.inutilization.completed` / `nfce.inutilization.rejected`.
- MCP: `type: "nfce"` in `nfse_issue`, `nfse_list` (and `all`), `nfse_get`, `nfse_cancel`, `nfse_review` and the downloads; `nfe_validate` takes `type`; `nfe_inutilize` and `nfe_number_gaps` take `model` 55 or 65; `nfe_settings_update` takes `nfce_default_series`.

## Next: NF-e in test mode (homologação)

NF-e (goods, model 55) joins the API **inside the existing `/invoices` routes**, chosen by a `type`. It is open to every account (no release; production answers `422 NFE_PRODUCTION_DISABLED` until it is turned on), runs only against the SEFAZ test environment, and is for Simples Nacional / MEI companies in every state. Corvo does not calculate NF-e taxes: the caller sends CFOP, NCM and CSOSN.

### Note for SDK and client generators: nothing about NFS-e changed

- No NFS-e route, field, enum value, status or error code was renamed or removed. A request without `type` is an NFS-e, and an NFS-e answer still has no `type` (absent means `nfse`).
- `invoices_create` accepts `type: "nfe"` in the body; its `202` answer for an NF-e (`200` when the same `Idempotency-Key` is repeated) is `{ type: "nfe", id, status, replayed? }`. `invoices_list` takes `type=nfse|nfe|all` (default `nfse`): `nfe` lists NF-e, `all` answers a summary shape with a keyset cursor, and the NFS-e-only filters (`from`, `to`, `externalId`, `customerTaxId`, `origin`) are refused with `400` for `nfe` and `all`.
- Every route that has an `{id}` (`invoices_get`, `_cancel`, `_listEvents`, `_downloadXml`, `_downloadPdf`, `_createDownloadUrl`) finds the document by its id, so the same operation serves both types. An operation that exists for only one type answers `422 INVOICE_OPERATION_NOT_SUPPORTED` when asked for the other (for example `invoices_correct`, `invoices_discard` or inutilization for an NFS-e). The cancel body of an NF-e is `{ justification }` (15 to 255 characters), not `{ reason, description }`.
- An NF-e issue (`POST`) and a resubmission (`PUT`) require the `Idempotency-Key` header (1 to 200 characters); for an NFS-e it stays optional.
- Treat `code` as an open string: new ones appear (`NFE_VALIDATION_FAILED`, `COMPANY_NFE_INCOMPLETE`, `STATE_REGISTRATION_INVALID`, `UF_NOT_ENABLED`, `NFE_PRODUCTION_DISABLED`, `NFE_INVALID_STATE`, `JUSTIFICATION_LENGTH`, `CORRECTION_LENGTH`, `CORRECTION_LIMIT_REACHED`, `INUTILIZATION_RANGE_*`, `IDEMPOTENCY_KEY_*`, `INVOICE_OPERATION_NOT_SUPPORTED`, ...). NF-e errors add `type` (`communication`, `validation` or `configuration`).

### New operations (tag `NF-e` for the company settings; the others are tagged `Invoices`)

| Operation | Route | What it does |
| --- | --- | --- |
| `companies_getNfeSettings` / `companies_updateNfeSettings` | `GET` / `PUT /companies/{id}/nfe-settings` | IE, CRT, default series, nature of the operation and CSOSN; `missing` lists what the company still lacks |
| `invoices_validate` | `POST /invoices/validate` | Dry-run of an NF-e (`type` in the body); `?includeXml=true` adds the XML |
| `invoices_resubmit` | `PUT /invoices/{id}` | Fix and send a rejected NF-e again, same number |
| `invoices_sync` | `POST /invoices/{id}/sync` | Ask the SEFAZ about the note by its access key |
| `invoices_discard` | `POST /invoices/{id}/discard` | Give up a rejected NF-e |
| `invoices_correct` | `POST /invoices/{id}/corrections` | Correction letter (CC-e), up to 20 per note |
| `invoices_createInutilization` / `invoices_listInutilizations` | `POST` / `GET /invoices/inutilizations` | Inutilize a range of numbers (`type` required) |
| `invoices_numberGaps` | `GET /invoices/number-gaps?type=nfe` | Skipped numbers per company and series |

Existing operations that gained the NF-e behaviour: `invoices_create`, `invoices_list`, `invoices_get`, `invoices_cancel`, `invoices_listEvents` (for an NF-e it answers the timeline of states and fiscal events, not paginated), `invoices_downloadXml` (authorized `nfeProc`), `invoices_downloadPdf` (DANFE) and `invoices_createDownloadUrl`.

### Webhooks

New events, with `data.documentType: "nfe"` and `data.documentId` instead of `invoiceId`: `nfe.document.authorized`, `.rejected`, `.denied`, `.failed`, `.reconciliation_required`, `.manual_review`, `.cancelled`, `.cancellation_rejected`, `.corrected`, `.documents_ready`, `.email_sent`, `.email_failed`, and `nfe.inutilization.completed` / `nfe.inutilization.rejected`. The NFS-e events and their payload did not change; the filter by `invoiceId` keeps working.

### MCP

`nfse_issue`, `nfse_list`, `nfse_get`, `nfse_cancel`, `nfse_review`, `nfse_get_download_url` and `nfse_download_pdf` take an optional `type` (`nfse` default, `nfe`; `nfse_list` also `all`); without it they behave exactly as before. New tools, listed for every account: `nfe_validate`, `nfe_correct`, `nfe_inutilize`, `nfe_number_gaps`, `nfe_settings_get`, `nfe_settings_update`.

## 0.3.0 (2026-11-24)

### Breaking changes

Update these first. Each one changes something an SDK built for 0.2.0 sends or reads.

1. **Plan slugs were renamed.** `developer`, `growth`, `scale` and `volume` no longer exist. The slugs are now `free`, `solo`, `equipe`, `empresa` and `escala` (plus `self-hosted` on a self-hosted instance). Where it shows: `plan.slug` in `GET /billing/plan` and `slug` of each item in `GET /credits/plans`. Do not hard-code the list: treat the slug as an open string and read the allowances from the plan (`monthlyCreditAllowance`: `solo` 100, `equipe` 250, `empresa` 600, `escala` 1200; extra notes cost R$ 0,99).
2. **`POST /invoices` with `options.type` `SCHEDULE` no longer answers with an invoice.** `SCHEDULE` and the new `RECURRING` create a *schedule* and answer `202` with it (see `Schedule`, `snake_case` fields). The note only exists when the schedule runs (09:00 America/Sao_Paulo, Monday to Friday; a weekend date runs on Monday). `competenceDate` is now the date of the first run and must be from tomorrow on. Handle both bodies in `invoices_create`: `data` is an `Invoice` for `IMMEDIATE` and a `Schedule` otherwise. Follow the runs with `schedules_listRuns`.
3. **`GET /credits` changed its fields.** `overageUnits` and `overageAmountCents` are gone (there is no overage billing). `balance` is now the plan notes left plus the loose notes bought separately (plan notes of a lapsed plan count 0). New: `planRemaining`, `avulsoBalance`. `hardLimit` stays.
4. **`GET /billing/plan` changed its fields.** `usage.overage_units` and `usage.overage_amount_cents` are gone; `usage.avulso_balance` is new. `subscription` gained `stripe_portal_available` (boolean), `stripe_subscription` (boolean: `true` while the account has a live Stripe subscription) and `pix_subscription` (an object with the active or pending Pix subscription, or `null`). `plan.monthly_price_cents` follows the new price table. The 404 of a workspace without a plan now has `code: "NO_PLAN_ASSIGNED"`.
5. **`POST /credits/purchase/preview` is now `GET /credits/purchase/preview?units=N`.** The old route only answered `410 Gone`. The new one prices a one-off purchase: `{ units, unitPriceCents, totalCents }` (R$ 0,99 each, at least 3 notes, whole numbers). Buying is done in the dashboard.
6. **A test key can no longer reach live webhooks.** Webhooks created with an API key are tied to that key's environment (`environment` is `test` or `live`) and only receive its events; `GET /webhooks`, `GET /webhooks/deliveries` and the delivery stats show only the key's environment. A client that managed live webhooks with a `corvo_test_` key must use a `corvo_live_` key. (Integration connections and operations follow the same rule from their first release.)
7. **Webhook destinations are checked more strictly.** URLs that resolve to private, loopback, link-local, CGNAT, benchmarking, multicast or NAT64/6to4 addresses are refused when the webhook is registered and when it is delivered.

### Corrections of the documented shapes

The old Swagger (served only in development) did not match the real answers. If an SDK model was copied from it, check these against `openapi.json`:

- **Invoice.** The API returns the stored fields plus the derived `documentsStatus` (`pending` or `ready`), `emailStatus` and `stage`. It has `documentsReadyAt`, `lastEmailStatus` and `lastEmailSentAt`. The fields `documentsReady` and `lastEmail` shown by the old Swagger do not exist in the invoice (`documentsReady` exists only inside webhook payloads). Dates are ISO 8601; unknown values are `null`, not absent.
- **Envelope.** Every JSON answer is `{ data }` (lists add `pagination`), with two exceptions: `GET /health/live` answers the bare status object, and the file downloads (`invoices_downloadXml`, `invoices_downloadPdf`, `invoicePackage_download`, `imports_downloadTemplate`, `imports_downloadErrors`) answer the file itself, not JSON. `invoices_calculate` answers `{ data: InvoiceCalculation }`, not the bare calculation.
- **Numbers.** `Invoice.nfseNumber` and `Invoice.dpsNumber` are JSON integers (`int64`, at most 15 digits, so safe in JavaScript); the leading zeros of the printed number are not kept. `PackageSummary.total` is a decimal string (`"1234.50"`); money elsewhere is a number or `...Cents`.
- **Nullable fields.** Where a field can be `null` the schema says so (`nullable`, and `null` is listed in enums such as `emailStatus`, `cancellationReason` and `portalFlag`; an optional object is `anyOf` the object or `null`). `Company.tradeName`, the `address*` fields and the rates are `null` when not set.
- **Lists** answer `{ data, pagination: { limit, hasMore, nextCursor } }` (camelCase). The cursor is opaque. In `customers_search` and the schedule lists it is the offset of the next page, still to be passed back untouched.
- **Errors** are `{ statusCode, code, message, details?, requestId }`; a few feature codes have no `ERROR_` prefix (`CNPJ_INVALID`, `CNPJ_LOOKUP_UNAVAILABLE`, `CHECKOUT_INVALID`, `PACKAGE_TOO_LARGE`, `NO_PLAN_ASSIGNED`, `DPS_NUMBER_BELOW_CURRENT`, ...). `code` is not an enum: new codes appear.
- **Casing.** `GET /billing/plan`, `/schedules` and `/imports` answer in `snake_case`; everything else in `camelCase`.
- **Invoice statuses** (10, unchanged): `queued`, `processing`, `authorized`, `rejected`, `retry_pending`, `reconciliation_required`, `manual_review`, `failed`, `cancelling`, `cancelled`. New transitions: `authorized` can go straight to `cancelled` (the Sefin cancelled it because a substitute was authorized, or the cancellation was made on the national portal); `manual_review` can be resolved to `reconciliation_required`, `authorized` or `rejected` (see `invoices_review`).

### New operations

| Area | Operations |
| --- | --- |
| Invoices | `invoices_substitute` (`POST /invoices/{id}/substitute`), `invoices_review` (resolve `manual_review`), `invoicePackage_download` / `invoicePackage_summary` (monthly ZIP for the accountant), `fiscalPortal_status` |
| Companies | `dpsSequence_get` / `dpsSequence_set` / `dpsSequence_check` / `dpsSequence_confirm` (check the numbering with the government before the first note; error `DPS_NUMBERING_CHECK_UNAVAILABLE`; continue the DPS numbering from another system; error `DPS_NUMBER_BELOW_CURRENT`), `accountantPackage_get` / `_update` / `_send` / `_listSends` |
| Customers | `cnpj_lookup` (`GET /cnpj/{cnpj}`), `customers_search`, `customers_get`, `customers_update`, `customers_delete` |
| Service favorites | `serviceFavorites_list` / `_create` / `_delete` |
| Schedules | `schedules_list` / `_get` / `_update` / `_pause` / `_resume` / `_cancel` / `_listRuns` |
| Imports | `imports_start` / `_list` / `_get` / `_emit` / `_listRows` / `_updateRow` / `_discard` / `_downloadTemplate` / `_downloadErrors` |
| Integrations | `integrations_listProviders`, `integrationConnections_*` (create, list, get, validate, updateCredentials, activate, pause, disconnect, listRules, replaceRules, listEvents, listOperations), `integrationOperations_completeCustomer` / `_retry` |
| Credits | `credits_previewPurchase` (see breaking change 5) |
| Plans | `plans_list` and `plans_get` (`GET /plans`, `GET /plans/{slug}`): the public price list of the paid plans, with `monthlyAllowance`, `basePriceCents`, `monthlyEquivalentCents` and `chargeTotalCents` for the `monthly` or `annual` cycle. They need no API key |
| Health | `health_live` (existed, now documented) |

The fiscal profile and the service tax profile routes (`fiscalProfiles_*`, `serviceTaxProfiles_*`) already existed in 0.2.0; they are documented now.

### New and changed fields

Requests (`POST /invoices`, `POST /invoices/calculate`, batch items, schedules):

- `options.type` accepts `RECURRING`, with `options.recurrence: { frequency: WEEKLY | BIWEEKLY | MONTHLY, endsOn? }` (required for `RECURRING`, refused otherwise).
- `purchaseOrder` (up to 60 characters, DPS `xPed`) and `notes` (up to 2000, DPS `xInfComp`) on the invoice. They come back in `serviceSnapshot.purchaseOrder` and `serviceSnapshot.notes`.
- `customer.foreign` for a customer outside Brazil (`taxId` or `noTaxIdReason`, `country`, `postalCode`, `city`, `region`, `street`, `number`, `district`, `complement?`). It cannot be combined with `customer.taxId` or `customer.address`; `customer.name` is then required.
- `customer.name` may be omitted when the customer was already saved: it is filled from the CPF/CNPJ.
- `GET /invoices` accepts `customerTaxId` (CPF or CNPJ, digits).
- `POST /invoices/{id}/email` accepts `{ email }` to send to another address than the customer's.
- `POST /invoices/{id}/substitute` replaces an authorized invoice: only `description` (why), `service.description`, `purchaseOrder` and `notes` can change.
- Company: `municipalityAgreement` (what the Receita says about the municipality's adhesion to the national system).

Responses:

- Invoice: `substitutesInvoiceId`, `substitutionDescription` (on a substitute), `portalFlag` (`taker_rejected` or `blocked`, from the national portal).
- Invoice events: `source` (`portal` or `null`), `portalEvent`, `portalNsu`.
- Webhook event type `nfse.invoice.taker_rejected` (the customer rejected the invoice on the portal). The full list is `WebhookEventType` in the document: 12 `nfse.invoice.*` types.
- Error codes added: `ERROR_INVOICE_NOT_SUBSTITUTABLE`, `ERROR_SCHEDULE_NOT_FOUND`, `ERROR_SCHEDULE_LIMIT`, `ERROR_SCHEDULE_STATE`, `ERROR_IMPORT_*`. `lastErrorCode` of an invoice can be a Sefin rule (`E0014`, ...) or a Corvo code such as `DPS_NUMBER_ALREADY_USED`.

### Behavior changes that are not breaking

- `GET /invoices/overview` without `period` now answers the documented 7 days (it answered 30 days and left `period` out of the body).
- `POST /imports/{id}/emit` and `POST /invoices/{id}/email` accept a request without a body: `requestBody.required` is `false`, and the schemas stay documented (`EmitImport` with the optional boolean `sendEmail`, `RequestInvoiceEmail` with the optional `email`). A call to `imports_emit` without a body answered 500 and now works.
- Request integers are typed `integer`: `SetDpsSequence.lastNumber` (`int64`, 0 to 999999999999999, required), `CreateServiceFavorite.amountCents` (`int64`, at least 1) and `CursorPagination.limit`. SDKs that generated `number`/`double` for them should now use an integer type.
- `PATCH /companies/{id}` no longer lists `taxId` in the request: the CNPJ cannot change (the same value is ignored, any other is a 422).
- `POST /invoices/batches`: `results[].error.details` is a list of issues (it was documented as an object).

- A competence date in the future is refused for an immediate emission (`422` with `ERROR_FUTURE_DATE` in `details[].code`; Sefin rule `E0015`); use `SCHEDULE` to issue later. `competenceDate` may be at most 15 days ahead (31 for `RECURRING`).
- Test-environment DPS numbering starts at a high number so it does not collide with notes issued before (`E0014`). Use `dpsSequence_set` to continue from the last number issued elsewhere.
- A MEI or Simples Nacional issuer can only change the description, the purchase order and the notes in a substitute (`E0061`).
- Removing a member from the workspace revokes the API keys that member created.
- `GET /webhooks/deliveries` takes the filters `invoice_id`, `event_type` and `status`, and `hours` may be up to 720 (30 days); a larger value is a 400. Each `WebhookDelivery` has the new `invoiceId` (`null` for events without an invoice, such as `webhook.test`).

## 0.2.0 (2026-10-26)

First contract the SDKs were written for. It was never published as a document: it had to be read from the controllers.
