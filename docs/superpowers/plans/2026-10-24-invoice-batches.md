# Invoice Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue up to 50 NFS-e in one request (one or many companies), saving every valid item in a single database commit and returning a per-item result for the rejected ones.

**Architecture:** `POST /invoices/batches` validates each item separately (reusing the single-emission preparation), then persists all accepted items in ONE `UnitOfWork` under ONE billing lock (invoice + event + credit reservation + outbox row per item, exactly like `InvoiceLifecycleService.submit`). Items that fail validation, idempotency or credit/quota checks are rejected and never written. The outbox relay delivers to the queue as it does today. The MCP gets `nfse_issue_batch`, mapped onto the same service.

**Tech Stack:** NestJS, TypeORM (`UnitOfWorkPort`), class-validator, Jest, MCP tool registry (`mcp.service.ts`).

**Spec:** No separate spec file. The design was agreed in the brainstorming conversation of 2026-10-24 and is restated under "Global Constraints" below.

## Global Constraints

- Route: `POST /invoices/batches`, HTTP 202, `@ApiKeyEndpoint()`, `@RequirePermission('nfse.invoices.issue')`, `@UseGuards(ExecutionEnvironmentGuard)` (inherited from `InvoiceController`), `@Throttle({ default: { limit: 10, ttl: 60_000 } })`.
- Body: `{ "invoices": [ ...1 to 50 items ] }`. Each item has the same fields as `CreateInvoiceDto` plus an optional `idempotencyKey`. Items may reference different companies (`companyId` or `companyTaxId`).
- Batch-level problems (not an object/array, empty list, more than 50) return 422 for the whole request. Nothing else fails the whole request except an unexpected infrastructure error (500, nothing saved).
- Item-level problems NEVER fail the batch: the item is `rejected`, the others proceed.
- Response: `{ data: { total, accepted, rejected, results } }`; `results` has one entry per input item, in input order: `{ index, status: 'accepted', replayed?: true, invoice }` or `{ index, status: 'rejected', error: { code, message, details? } }`.
- Persistence: every accepted item is written in ONE transaction and ONE billing lock; commit saves all accepted items or none.
- Idempotency is per item (`idempotencyKey`). The `Idempotency-Key` header does not apply to batches. An item whose key already exists with the same payload hash is `accepted` with `replayed: true` and the existing invoice, nothing written. Same key with a different hash is rejected with `ERROR_IDEMPOTENCY_CONFLICT`. A key repeated inside the same batch: first occurrence wins, later ones are rejected with code `ERROR_DUPLICATE_IDEMPOTENCY_KEY_IN_BATCH`.
- Credits: in `live`, one reservation per accepted item through `BillingUsageService.reserve`. An item that fails the reservation (`BillingRuleError`: `monthly_limit_exceeded`, `daily_limit_exceeded`, `plan_blocked`) is rejected with that error's code and the batch continues. `test` environment reserves nothing.
- MCP tool: `nfse_issue_batch`, scope `nfse:write`, snake_case input mirroring `nfse_issue` per item, same result shape in snake_case.
- `InvoiceService.emit` keeps its exact behavior (its existing specs must stay green).
- Docs: OpenAPI annotations, web docs (`en.ts` and `pt.ts`), `llms.txt` (both copies), `api.http`, `FRONTEND_API.md`.

## Review Focus

- Whole batch of 50 where every item is invalid: 202 with `accepted: 0`, nothing written, no lock error.
- Same company repeated 50 times: credit reservation runs 50 times in one transaction and stops accepting when the limit is hit; items past the limit are rejected, earlier ones saved.
- Retry of the same batch after a timeout: previously saved items come back `replayed: true`, no duplicate invoice, no second credit reservation.
- A database error during the commit (simulated): zero invoices, zero events, zero outbox rows, zero credit reservations remain.
- Mixed `test`/`live` is impossible (environment comes from the API key), but an item referencing a company from another tenant must be rejected as company-not-found, not leak data.
- Item with `customer: {}` or without `customer` (anonymous) must work like in the single emission.

---

### Task 1: Extract `prepareEmission` from `InvoiceService.emit`

**Files:**
- Modify: `api/src/modules/invoice/application/invoice.service.ts:99-225`
- Test: `api/src/modules/invoice/application/invoice.service.prepare-emission.spec.ts` (new; copy the Nest `Test.createTestingModule` + mock-provider setup from the existing `invoice.service.*.spec.ts` files)

**Interfaces:**
- Produces, exported from `invoice.service.ts`:
  ```ts
  export type PreparedEmission =
    | { kind: 'replay'; invoice: Invoice }
    | { kind: 'ready'; invoice: Invoice; event: InvoiceEvent; requestHash: string };
  ```
  and `InvoiceService.prepareEmission(dto: CreateInvoiceDto, tenantId: string, authContext: AuthContext, idempotencyKey?: string): Promise<PreparedEmission>`.
- `emit` keeps its signature and behavior.

- [ ] **Step 1: Write failing tests** in the new spec:
  - `returns replay when the idempotency key exists with the same hash` (repo `findByIdempotencyKey` returns an invoice whose snapshot `requestHash` equals the computed hash → `{ kind: 'replay' }`, no `intake.prepare` call).
  - `throws IdempotencyConflictError when the key exists with a different hash`.
  - `returns ready with an unsaved queued invoice and its queued event` (`lifecycle.submit` is NOT called; `event` has `invoiceId === invoice.id`).
  - `runs company ready and active certificate checks only in live` (mirror the checks currently in steps 3 of `emit`).
- [ ] **Step 2: Run** `cd api && npx jest src/modules/invoice/application/invoice.service.prepare-emission.spec.ts` → FAIL (`prepareEmission` is not a function).
- [ ] **Step 3: Implement** `prepareEmission` by moving steps 1-4 of `emit` (idempotency lookup, `intake.prepare`, company/certificate checks, `Invoice.create`, `InvoiceEvent.create`) into it. Move the `PLAN_BLOCKED` quota pre-check (`quotaService.getStatus`) into `emit` only (the batch gets the same signal from the reservation). `emit` becomes: `prepareEmission` → return on replay → quota pre-check → `lifecycle.submit` with the existing 23505 race handling.
- [ ] **Step 4: Run** the new spec and every existing `invoice.service*.spec.ts` plus `invoice.controller.spec.ts` → all PASS.
- [ ] **Step 5: Commit** `refactor(invoice): separar a preparação da emissão da gravação`

---

### Task 2: `InvoiceLifecycleService.submitBatch` (single transaction)

**Files:**
- Modify: `api/src/modules/invoice/application/invoice-lifecycle.service.ts` (next to `submit`, lines 56-116)
- Test: `api/src/modules/invoice/application/invoice-lifecycle.service.spec.ts` (extend) and `api/src/modules/invoice/outbox-intake.postgres.integration.spec.ts` (extend; follow its schema setup helpers)

**Interfaces:**
- Consumes: `PreparedEmission` entries of kind `ready` (Task 1).
- Produces:
  ```ts
  export type BatchSubmitEntry = { invoice: Invoice; event: InvoiceEvent };
  export type BatchSubmitOutcome =
    | { ok: true }
    | { ok: false; code: string; message: string };
  submitBatch(tenantId: string, entries: BatchSubmitEntry[]): Promise<BatchSubmitOutcome[]>; // same length and order as entries
  ```

- [ ] **Step 1: Write failing unit tests** (mocked ports, same style as the existing `submit` tests):
  - `runs one unit of work and one billing lock for N entries` (assert `unitOfWork.execute` and `billing.locked` called once with 3 entries).
  - `saves invoice, event and outbox row for every accepted entry` (dedupeKey `calc:<id>` each).
  - `rejects an entry whose idempotency key already exists, without writing it` → outcome `{ ok:false, code:'ERROR_IDEMPOTENCY_CONFLICT' }`.
  - `rejects entries once usage.reserve throws BillingRuleError, keeps the earlier ones` (reserve resolves twice then throws `monthly_limit_exceeded` → outcomes `[ok, ok, {ok:false, code:'ERROR_MONTHLY_LIMIT_EXCEEDED'}]`, only 2 inserts). A `BillingRuleError` is thrown before any write, so the transaction stays usable.
  - `does not reserve credits in test environment`.
  - `rethrows unexpected errors so nothing is committed`.
- [ ] **Step 2: Write failing integration test** in `outbox-intake.postgres.integration.spec.ts`: `batch commits all accepted invoices atomically` (3 entries → 3 rows in `nfse_invoices`, 3 events, 3 outbox rows) and `batch rolls back everything when the last insert fails` (force a failure by making the last entry's invoice id duplicate an earlier one; expect 0 rows in all tables and no credit reservations).
- [ ] **Step 3: Run** both → FAIL.
- [ ] **Step 4: Implement** `submitBatch`: `runWithTenant(tenantId)` → `unitOfWork.execute` → `billing.locked(tenantId)`; loop entries in order; for each: idempotency existence check (same query as `submit`, plus a `Set` of keys already accepted in this call), then in `live` `usage.reserve` + `credits.save` (same payload as `submit`) inside `try/catch` that converts only `BillingRuleError` into a rejected outcome; then `invoices.insert`, `events.save`, `outbox.enqueue` (same payload as `submit`). After the transaction, in `live` do the same cache delete and `creditsUsageChanged` event once (not per item), only if at least one entry was accepted. Reject code format: `publicErrorCode(error.code, ...)` from `@/shared/http/api-error`.
- [ ] **Step 5: Run** unit + integration specs → PASS (integration needs the Postgres the other `*.postgres.integration.spec.ts` use).
- [ ] **Step 6: Commit** `feat(invoice): gravar um lote de notas em uma única transação`

---

### Task 3: `InvoiceBatchService` and the DTO

**Files:**
- Create: `api/src/modules/invoice/http/invoice-batch.dto.ts`
- Create: `api/src/modules/invoice/application/invoice-batch.service.ts`
- Create: `api/src/modules/invoice/application/invoice-batch-error.ts`
- Modify: `api/src/modules/invoice/invoice.module.ts` (provide and export `InvoiceBatchService`)
- Test: `api/src/modules/invoice/application/invoice-batch.service.spec.ts`, `api/src/modules/invoice/application/invoice-batch-error.spec.ts`

**Interfaces:**
- Consumes: `InvoiceService.prepareEmission` (Task 1), `InvoiceLifecycleService.submitBatch` (Task 2).
- Produces:
  ```ts
  // invoice-batch.dto.ts
  export const MAX_INVOICE_BATCH_SIZE = 50;
  export class CreateInvoiceBatchDto { invoices!: unknown[] } // @IsArray @ArrayMinSize(1) @ArrayMaxSize(50); items intentionally NOT @ValidateNested so a bad item cannot fail the batch
  export class BatchInvoiceItemDto extends CreateInvoiceDto { idempotencyKey?: string } // @IsOptional @IsString @MaxLength(255)

  // invoice-batch-error.ts
  export type BatchItemError = { code: string; message: string; details?: unknown };
  export function toBatchItemError(error: unknown): BatchItemError | null; // null = unexpected, caller rethrows

  // invoice-batch.service.ts
  export type BatchItemResult =
    | { index: number; status: 'accepted'; replayed?: true; invoice: Invoice }
    | { index: number; status: 'rejected'; error: BatchItemError };
  export type BatchResult = { total: number; accepted: number; rejected: number; results: BatchItemResult[] };
  InvoiceBatchService.emitBatch(items: unknown[], tenantId: string, authContext: AuthContext): Promise<BatchResult>
  ```

- [ ] **Step 1: Write failing tests** for `toBatchItemError`: `FiscalValidationError` → `ERROR_VALIDATION` with `details` from `issues`; class-validator failures → `ERROR_VALIDATION` with `details` `{field, code, message}`; `HttpException` below 500 → its code/message via `apiErrorBody`; `IdempotencyConflictError`, `CompanyNotFoundError`, `CompanyNotReadyError`, `QuotaExceededError` → the code from `DOMAIN_ERRORS[error.name]`; `ApplicationError` → its `code`/`safeMessage`; a plain `Error` and a `QueryFailedError` → `null`.
- [ ] **Step 2: Write failing tests** for `emitBatch` (mock `InvoiceService` and `InvoiceLifecycleService`):
  - `rejects an item that fails DTO validation and still submits the others`.
  - `maps each prepared item back to its original index` (items 0 and 2 valid, 1 invalid).
  - `returns replayed items as accepted with replayed true and does not submit them`.
  - `rejects the second occurrence of an idempotencyKey inside the batch with ERROR_DUPLICATE_IDEMPOTENCY_KEY_IN_BATCH`.
  - `merges submitBatch rejections (e.g. monthly limit) into the results`.
  - `does not call submitBatch when every item is rejected`.
  - `prepares at most 5 items concurrently` (track max in-flight calls).
  - `rethrows when toBatchItemError returns null`.
  - `counts total, accepted and rejected` (replays count as accepted).
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement.** Per item: `plainToInstance(BatchInvoiceItemDto, raw)` → `validate` → `prepareEmission(dto, tenantId, authContext, dto.idempotencyKey)`; pool of 5 workers over the items (hand-written, no new dependency); errors go through `toBatchItemError`. Then one `submitBatch(tenantId, readyEntries)` call and merge outcomes by index. `InvoiceService.prepareEmission` derives the request hash from the dto, so strip `idempotencyKey` from the dto before passing it (otherwise the hash differs from the single-emission hash for the same payload).
- [ ] **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(invoice): serviço de emissão em lote com resultado por item`

---

### Task 4: HTTP endpoint `POST /invoices/batches`

**Files:**
- Modify: `api/src/modules/invoice/http/invoice.controller.ts` (new handler after `emit`, line ~88; inject `InvoiceBatchService`)
- Create: `api/src/modules/invoice/http/invoice-batch-response.dto.ts` (Swagger-only response classes `InvoiceBatchResponseDto`, `InvoiceBatchResultDto`)
- Test: `api/src/modules/invoice/http/invoice.controller.spec.ts` (extend), `api/src/modules/invoice/http/invoice-batch.dto.spec.ts` (new, style of `invoice.dto.spec.ts`)

**Interfaces:**
- Consumes: `InvoiceBatchService.emitBatch` (Task 3), `CreateInvoiceBatchDto`.
- Produces: `InvoiceController.emitBatch(dto: CreateInvoiceBatchDto, req: RequestWithAuthContext)` returning `{ total, accepted, rejected, results }` (the response interceptor wraps it in `data`).

- [ ] **Step 1: Write failing tests:** DTO spec (`rejects empty invoices`, `rejects 51 items`, `accepts 50`, `rejects non-array`, `accepts an item that is invalid for CreateInvoiceDto` — proves item errors don't fail the request); controller spec (`delegates to InvoiceBatchService with tenantId and authContext`, `declares status 202`). Also assert via `Reflect.getMetadata` that the permission is `nfse.invoices.issue`, the route is `batches` and the throttle limit is 10, using the pattern the controller spec already uses for `emit`.
- [ ] **Step 2: Run** `npx jest src/modules/invoice/http` → FAIL.
- [ ] **Step 3: Implement** the handler with `@Post('batches') @HttpCode(202) @ApiKeyEndpoint() @RequirePermission('nfse.invoices.issue') @Throttle(...)`, `@ApiOperation({ summary: 'Emit up to 50 NFS-e in one request', description })` (explain: per-item results, atomic commit of accepted items, per-item `idempotencyKey`, one or many companies), `@ApiAcceptedResponse` with `InvoiceBatchResponseDto`, and `@ApiResponse({ status: 422, ... })`.
- [ ] **Step 4: Run** → PASS; then `npx jest src/modules/invoice` fully.
- [ ] **Step 5: Commit** `feat(invoice): POST /invoices/batches`

---

### Task 5: MCP tool `nfse_issue_batch`

**Files:**
- Create: `api/src/modules/mcp/tools/nfse-issue-batch.tool.ts`
- Modify: `api/src/modules/mcp/dto/tool-input.dto.ts` (add `NfseIssueBatchInput`), `api/src/modules/mcp/tools/nfse-issue.tool.ts` (export the snake_case→`CreateInvoiceDto` mapping so both tools share it: `toCreateInvoiceDto(params: NfseIssueInput): CreateInvoiceDto`), `api/src/modules/mcp/mcp.service.ts:84` (register with `'nfse:write'`), `api/src/modules/mcp/mcp.controller.ts:100` (usage count)
- Test: `api/src/modules/mcp/tools/nfse-issue-batch.tool.spec.ts`; extend `api/test/mcp-tools.e2e-spec.ts` with a `tools/list` assertion that `nfse_issue_batch` exists

**Interfaces:**
- Consumes: `InvoiceBatchService.emitBatch` (Task 3).
- Produces: `NFSE_ISSUE_BATCH_TOOL` and `createNfseIssueBatchHandler(batchService: InvoiceBatchService)`; handler returns `{ total, accepted, rejected, results: Array<{ index, status, replayed?, invoice_id?, access_key?, invoice_status?, error?: { code, message, details? } }> }`.

- [ ] **Step 1: Write failing tests:** `maps snake_case items to CreateInvoiceDto and passes idempotency_key per item`; `an item with invalid input is rejected in place, not thrown` (the handler must not use `invalidInput` for per-item problems; it only throws when `invoices` is missing or longer than 50); `shares mapping with nfse_issue` (existing `nfse-issue.tool.spec.ts` must stay green after the refactor); `returns accepted items with invoice_id, access_key and status`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Tool description (written for the model) must say: use it for spreadsheets or many invoices; max 50 per call, split larger lists; each item needs `company_tax_id` or `company_id` and `amount` or `services`; always send a stable `idempotency_key` per row (e.g. `<planilha>-<linha>`) so a retry never duplicates; read `results` by `index` and report the rejected rows with their `error.message`; accepted rows are already saved, never resend them as new. Per item, validate with `NfseIssueInput` and apply the same customer/amount checks as `nfse_issue` (move those into the shared mapper and turn their thrown errors into item rejections with code `ERROR_VALIDATION`). Items that map cleanly are sent to `emitBatch`; items that fail mapping are merged back by index. In `mcp.controller.ts` `recordUsage`, add `accepted` (from the tool result's JSON) to `invoicesIssued` when the tool is `nfse_issue_batch` (inspect `McpResponse` to read it from the same place the tool result text/structured content is stored).
- [ ] **Step 4: Run** `npx jest src/modules/mcp` and the e2e `npx jest --config test/jest-e2e.json test/mcp-tools.e2e-spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): ferramenta nfse_issue_batch`

---

### Task 6: Documentation

**Files:**
- Modify: `web/lib/docs/content/en.ts` and `web/lib/docs/content/pt.ts` (endpoint table near line 80 and a new "Emitting in batch" section with request/response examples for both use cases: accountant spreadsheet with several companies, nightly job for one company; mention the 50 limit, per-item idempotency, retry behavior and the MCP tool), `web/messages/en.json` and `pt.json` only if the MCP tools list is rendered from them, `api/llms.txt` and `web/public/llms.txt`, `api/FRONTEND_API.md`, `api.http` (two examples), `api/README.md` if it lists endpoints
- Test: existing docs tests under `web/tests` (run them; add an assertion in the docs content test that the batch endpoint row exists in both languages if such a test already enumerates endpoints)

- [ ] **Step 1:** In the docs content tests, add the failing assertion that `POST /v1/invoices/batches` appears in the `en` and `pt` endpoint tables.
- [ ] **Step 2: Run** `cd web && npx vitest run lib/docs tests` (or the project's test command from `web/package.json`) → FAIL.
- [ ] **Step 3:** Write the docs. Portuguese copy in `pt.ts` must be natural, not translated line by line. Include a result example with one `accepted`, one `replayed` and one `rejected` item.
- [ ] **Step 4: Run** web tests and `npm run lint` in `web` → PASS.
- [ ] **Step 5: Commit** `docs: emissão em lote (POST /invoices/batches e nfse_issue_batch)`

---

### Task 7: Final verification

- [ ] **Step 1:** `cd api && npx tsc --noEmit && npx eslint src --max-warnings=0 && npx jest` → all PASS (known flaky timeouts in `web` are unrelated; re-run in isolation before concluding).
- [ ] **Step 2:** Smoke test against a local API with a `corvo_test_` key: send a 3-item batch with one invalid item; expect `accepted: 2, rejected: 1`; resend the same body with `idempotencyKey`s set and expect `replayed: true` on the two accepted ones and no new rows.
- [ ] **Step 3:** Open the PR (title in Portuguese like the recent history, e.g. `feat(invoice): emissão de notas em lote`).
