# Preview fiscal, observabilidade e documentação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor a FiscalEngine sem emitir (`POST /v1/invoices/preview`), alinhar a observabilidade ao padrão `greenflow.*` do repositório e documentar contratos, runbooks e exemplos.

**Architecture:** Um `InvoiceIntakeService` (extraído do `InvoiceService.emit`) valida/normaliza a entrada e é usado por emissão e preview. O `PreviewInvoiceService` roda o **mesmo** `FiscalEngineService` do worker, de forma síncrona, em contexto novo e sem nenhuma escrita. O pipeline ganha `executeWithPartial` para devolver o contexto parcial quando uma etapa bloqueia, o que permite ao preview informar campos pendentes e cálculos já disponíveis.

**Tech Stack:** NestJS 11, class-validator, OpenTelemetry (`@opentelemetry/api`), Redis rate limiter existente, Jest.

**Spec:** `docs/superpowers/specs/2026-10-13-fiscal-preview-docs-design.md` (depende dos planos `outbox-intake-schedule`, `fiscal-engine-core` e `rtc-dps-reconciliation`).

## Global Constraints

- Caminhos `src/`, `test/`, `scripts/` são relativos a `api/`; `docs/` e `deploy/` são relativos à raiz do repositório.
- Branch `feat/fiscal-preview-docs`; nunca na `main`.
- Preview: **zero escrita** em `nfse_invoices`, `nfse_invoice_events`, `nfse_dps_sequences`, `outbox_messages`, `invoice_fiscal_snapshots`, `credit_transactions`, filas BullMQ e S3; nenhuma chamada à Sefin. Verificado por teste.
- Preview exige `FISCAL_ENGINE_ENABLED=true` **e** `FISCAL_PREVIEW_ENABLED=true` (padrão `false`); caso contrário a rota responde `404` (como se não existisse).
- Permissão: reutiliza `nfse.invoices.issue` (nenhuma permissão nova — `TenantPermission` e o catálogo ficam intactos).
- Envelope de erro do app (não o do spec): corpo `{ statusCode, code, message, details?, requestId }` produzido por `apiErrorBody`; códigos públicos ganham o prefixo `ERROR_` (`FISCAL_CLASSIFICATION_REQUIRED` → `ERROR_FISCAL_CLASSIFICATION_REQUIRED`). `details` é `[{ field?, code, message }]`.
- Valores monetários e alíquotas como **strings decimais** na resposta.
- Convenção de métricas do repositório: meter `greenflow.<area>`, nomes `greenflow.<area>.<métrica>` (separador `.`).
- Sem `any`; sem dados pessoais completos em logs; nenhum XML em log.

## Desvios deliberados do spec

1. Falhas **fiscais** do preview (VALIDATION, CONFIGURATION, CLASSIFICATION, UNSUPPORTED, CALCULATION) respondem `200` com `status: 'blocked'`, `blocking` e `pendingFields`, em vez de `422`: o filtro global descarta campos extras em corpos 4xx e um 422 não conseguiria carregar cálculos parciais. Erros da **requisição** (DTO inválido, empresa inexistente, `FiscalValidationError` de normalização) seguem 4xx normais; `INTEGRATION` ⇒ `503` com `Retry-After`; `INTERNAL` ⇒ `500` genérico.
2. Sem permissão `invoices:preview`; reutiliza `nfse.invoices.issue`.
3. Nomes de métricas do briefing (`fiscal_step_duration` etc.) são renomeados para o padrão `greenflow.fiscal.step.duration` (tabela na Task 5); `docs/fiscal/observability.md` mantém o mapeamento briefing → nome real.

## Review Focus

- Preview chamado em loop não consome crédito, número DPS nem linhas no banco (Task 4).
- Preview com RTC fora do ar devolve 503 com `Retry-After`, nunca valor presumido (Task 3).
- Preview de competência futura funciona sem `options.type` e não cria agendamento (Task 2).
- Preview de MEI sem tomador não exige tomador; de regime regular sem tomador volta `blocked` com `customer` pendente (Task 2).
- Resultado do preview é idêntico ao do worker para as mesmas entradas e mesma data (paridade, Task 4).
- Tenant A não enxerga perfis do tenant B no preview; a chave de rate limit é por tenant (Task 3/4).
- Flag desligada ⇒ 404, sem vazar a existência da rota (Task 3).
- Resposta não ecoa documentos completos do cliente (Task 2).

---

## Task 1: `InvoiceIntakeService` (entrada compartilhada por emissão e preview)

**Files:**
- Create: `src/modules/invoice/application/invoice-intake.service.ts`
- Modify: `src/modules/invoice/application/invoice.service.ts` (usa o intake; remove `resolveCompany` privado)
- Modify: `src/modules/invoice/invoice.module.ts`
- Test: `invoice-intake.service.spec.ts`; ajustar `invoice.service*.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PreparedInvoiceInput { company: Company; normalized: NormalizedInvoiceInput; environment: ExecutionEnvironment }
  @Injectable() export class InvoiceIntakeService {
    constructor(companyService: CompanyService, invoiceDomain: InvoiceDomainService, config: ConfigService)
    prepare(dto: CreateInvoiceDto, tenantId: string, environment: ExecutionEnvironment, mode?: { allowFutureCompetence?: boolean }): Promise<PreparedInvoiceInput>;
  }
  ```
  `prepare` = resolver empresa (`companyId` vence `companyTaxId`; `BadRequestException('companyId or companyTaxId is required')`), validar `municipalityCode` da empresa (mesmo `FiscalValidationError` de hoje) e `invoiceDomain.normalizeAndValidate({ ...dto, companyId: company.id, ...(mode?.allowFutureCompetence ? { options: { ...dto.options, type: 'SCHEDULE' } } : {}) }, environment, defaults, { engine: config.fiscal.engineEnabled })`. **Não** executa `ensureReady`, certificado, quota, idempotência nem escrita (esses passos continuam no `emit`).

- [ ] **Step 1: Write the failing tests** — `invoice-intake.service.spec.ts` (mocks de `CompanyService`/`InvoiceDomainService` reais onde possível): `companyId` tem prioridade; só `companyTaxId` ⇒ `findByTaxId`; nenhum ⇒ `BadRequestException`; empresa sem `municipalityCode` de 7 dígitos ⇒ `FiscalValidationError` com campo `company.municipalityCode`; defaults da empresa (`defaultServiceCode`, `municipalityCode`) chegam ao `normalizeAndValidate`; `allowFutureCompetence` converte `options.type` para `SCHEDULE` **sem** mutar o `dto` original; modo `engine` vem de `config.fiscal.engineEnabled`; nenhuma chamada a `ensureReady`/`certificateService`.

- [ ] **Step 2: Run (FAIL)** — `yarn jest src/modules/invoice/application/invoice-intake.service.spec.ts`.

- [ ] **Step 3: Implement** o serviço e refatore `InvoiceService.emit` para `const { company, normalized } = await this.intake.prepare(dto, tenantId, environment)` mantendo, na mesma ordem, hash/idempotência **antes**, e `ensureReady`/certificado (live) **depois**. Injete `InvoiceIntakeService` em `InvoiceService` (último parâmetro do construtor) e atualize os três specs que fazem `new InvoiceService(...)`.

- [ ] **Step 4: Run (PASS)** — `yarn jest src/modules/invoice && yarn typecheck && yarn typecheck:tests` (nenhuma regressão no `emit`).

- [ ] **Step 5: Commit** — `git commit -m "refactor(invoice): extract the shared intake step from emit"`

---

## Task 2: Núcleo do preview (serviço, resposta e pipeline parcial)

**Files:**
- Modify: `src/modules/invoice/domain/fiscal/fiscal-pipeline.ts` (`executeWithPartial`)
- Modify: `src/modules/invoice/application/fiscal/fiscal-engine.service.ts` (`calculateNormalized`, `calculatePartial`)
- Create: `src/modules/invoice/application/fiscal/preview-invoice.service.ts`
- Create: `src/modules/invoice/application/fiscal/preview-response.ts` (função pura `toPreviewResponse`)
- Create: `src/modules/invoice/http/preview-invoice-response.dto.ts`
- Test: `fiscal-pipeline.spec.ts` (acrescentar), `preview-response.spec.ts`, `preview-invoice.service.spec.ts`

**Interfaces:**
- Consumes: `FiscalPipeline`, `FiscalEngineService`, `InvoiceIntakeService`, `FiscalContext`, `FiscalCalculationResult`, `buildFiscalCalculationResult`.
- Produces:
  ```ts
  // fiscal-pipeline.ts
  executeWithPartial(initial: FiscalContext): Promise<{ context: FiscalContext; error: FiscalError | null }>;   // execute() passa a delegar a este
  // fiscal-engine.service.ts
  calculatePartial(normalized: NormalizedInvoice): Promise<{ context: FiscalContext; error: FiscalError | null; result: FiscalCalculationResult | null }>;
  toNormalizedInvoice(...)   // já existe (plano 2); reutilizado sem alteração
  // preview-response.ts
  export const PREVIEW_DISCLAIMER = 'Pre-emission simulation. Values are not a fiscal document and may differ from the final validation by Sefin.';
  export type PreviewStatus = 'ready' | 'blocked';
  export interface PreviewPendingField { field: string; reason: string }
  export function toPreviewResponse(input: { context: FiscalContext; error: FiscalError | null; result: FiscalCalculationResult | null }): PreviewResponse;
  ```
  `PreviewResponse`: `{ preview: true; status: PreviewStatus; disclaimer: string; competenceDate: string; taxRegime: TaxRegimeKind | null; classification: {serviceCode, nbsCode, cst, classCode, operationIndicator, source, catalogValidated, catalogVersions} | null; applicability: Record<'iss'|'issWithheld'|'federalWithholding'|'cbs'|'ibs'|'specialTreatment', {status, reason?, missingFields?}> | null; taxes: {...TaxAmount} | {}; withholdings: WithholdingAmount[]; netReceivableAmount: string | null; collectionWaived: boolean | null; calculation: { source, calculatorVersion, rulesVersion, legalReferences } | null; warnings: FiscalWarning[]; pendingFields: PreviewPendingField[]; blocking: { code, message, step, category, retryable, details } | null; trace: Array<{ step, status, durationMs, reason? }> }`.
  `pendingFields` vem de: `error.details.missingFields` / `error.details.fields` (strings), mais todo `Obligation` `MISSING_CONFIGURATION.missingFields` do contexto parcial. `taxes`/`withholdings`/`netReceivableAmount` refletem **somente o que as etapas já calcularam** (parcial quando `blocked`). **Não ecoa** `customer.taxId` nem nome do cliente.
  ```ts
  @Injectable() export class PreviewInvoiceService {
    preview(dto: CreateInvoiceDto, tenantId: string, environment: ExecutionEnvironment): Promise<{ response: PreviewResponse } | { httpError: FiscalError }>;
  }
  ```
  Regras: `prepare(..., { allowFutureCompetence: true })`; monta `NormalizedInvoice` com `invoiceId = randomUUID()` (nunca persistido); `calculatePartial`; se `error?.category === 'INTEGRATION'` ou `'INTERNAL'` ⇒ `{ httpError }`; senão `{ response: toPreviewResponse(...) }` (`status 'blocked'` quando `error` existe, `'ready'` caso contrário).

- [ ] **Step 1: Write failing tests**
  - Pipeline: `executeWithPartial` devolve o contexto até a última etapa aplicada e o erro da etapa que falhou (`context.trace` contém as etapas anteriores e **não** a falha); `execute` continua igual (regressão: todos os testes antigos do pipeline passam).
  - `preview-response.spec.ts`: MEI 2026 sem tomador ⇒ `ready`, `taxes {}`, aplicabilidade com `NOT_APPLICABLE` e razões; regular sem classificação ⇒ `blocked` com `blocking.code 'FISCAL_CLASSIFICATION_REQUIRED'`, `pendingFields` listando `service.fiscal.nbsCode` etc. e `classification` parcial já resolvida; regular sem tomador ⇒ `blocked`, `pendingFields [{ field: 'customer', … }]`; resposta nunca contém `taxId` do cliente (stringify e `not.toContain`); `disclaimer` presente; valores como strings.
  - `preview-invoice.service.spec.ts`: competência futura sem `options.type` aceita e devolve `competenceDate` futura; RTC retryable ⇒ `{ httpError }`; erro interno ⇒ `{ httpError }`; erro fiscal de configuração ⇒ `response.status 'blocked'`; `FiscalValidationError` da normalização propaga (vira 422 pelo filtro); nenhuma dependência de escrita é chamada (os mocks de repositórios/filas/lifecycle não são sequer injetados — o construtor do serviço só recebe `intake`, `engine`).

- [ ] **Step 2: Run (FAIL)** — `yarn jest src/modules/invoice` → FAIL.

- [ ] **Step 3: Implement** — `executeWithPartial` é o laço atual do `execute` retornando `{ context, error }` (sem lançar); `execute` = `const r = await executeWithPartial(initial); return r.error ? err(r.error) : ok(r.context)`. `FiscalEngineService.calculatePartial` cria o pipeline com `OtelPipelineObserver({ invoiceId: normalized.invoiceId, companyId: normalized.company.id })`, chama `executeWithPartial` e, sem erro, `buildFiscalCalculationResult(context)` (se esse construir falhar ⇒ `error` do resultado). `toPreviewResponse` é função pura; `PreviewInvoiceResponseDto` é a classe com `@ApiProperty` espelhando `PreviewResponse` para o Swagger.

- [ ] **Step 4: Run (PASS)** — `yarn jest src/modules/invoice && yarn typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): add preview service and partial pipeline results"`

---

## Task 3: Rota `POST /v1/invoices/preview` (flag, rate limit, mapeamento de erros)

**Files:**
- Modify: `src/infra/config/env.schema.ts`, `configuration.ts`, `configuration.types.ts` (`FISCAL_PREVIEW_ENABLED` padrão false; `FISCAL_PREVIEW_RATE_LIMIT_PER_MIN` padrão 30; seção `fiscal.previewEnabled/previewRateLimitPerMinute`)
- Create: `src/modules/invoice/http/preview-rate-limit.guard.ts`
- Create: `src/modules/invoice/http/fiscal-error-http.ts`
- Modify: `src/modules/invoice/http/invoice.controller.ts`, `src/modules/invoice/invoice.module.ts` (providers `PreviewInvoiceService`, `PreviewRateLimitGuard`)
- Test: `preview-rate-limit.guard.spec.ts`, `fiscal-error-http.spec.ts`, `invoice.controller.spec.ts` (acrescentar), `rtc-env.spec`-estilo `preview-env.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // fiscal-error-http.ts
  export function previewHttpFailure(error: FiscalError): { exception: ApplicationError; retryAfterSeconds?: number }
  // INTEGRATION → ApplicationError({ code: error.code, kind: 'dependency', retryable: true, safeMessage: 'Fiscal calculation is temporarily unavailable' }) + retryAfterSeconds (details.retryAfterMs/1000 arredondado para cima, mínimo 1, padrão 5)
  // INTERNAL (e qualquer outro inesperado) → ApplicationError({ code: 'FISCAL_INTERNAL_ERROR', kind: 'internal', safeMessage: 'Internal server error' })
  // controller
  @Post('preview') @HttpCode(200) @ApiKeyEndpoint() @RequirePermission('nfse.invoices.issue') @UseGuards(PreviewRateLimitGuard)
  preview(@Body() dto: CreateInvoiceDto, @Req() req, @Res({ passthrough: true }) res): Promise<ReturnType<typeof data>>
  ```
  Comportamento do controller: flags `engineEnabled && previewEnabled` falsas ⇒ `throw new NotFoundException()` **antes** de qualquer trabalho; chama `preview.preview(dto, tenantId, executionEnvironment(auth))`; `httpError` ⇒ define `Retry-After` quando houver e lança a exceção; senão `return data(response)`.
  `PreviewRateLimitGuard`: chave `preview:tenant:{authContext.activeTenantId}` no `RedisRateLimiter` (`windowMs 60000`, `max = config.fiscal.previewRateLimitPerMinute`), 429 com `Retry-After` e cabeçalhos `X-RateLimit-*` (padrão do `HttpApiRateLimitGuard`).

- [ ] **Step 1: Write failing tests**: `fiscal-error-http.spec.ts` (INTEGRATION ⇒ `kind dependency`, `retryable true`, `retryAfterSeconds` de `retryAfterMs 2500` ⇒ 3, sem `retryAfterMs` ⇒ 5; INTERNAL ⇒ `kind internal` com mensagem genérica **sem** o texto original); guard (permite até o limite, o limite+1 ⇒ `HttpException` 429 com `Retry-After`; tenants distintos têm contadores distintos); controller (flag desligada ⇒ `NotFoundException`; ligada ⇒ delega e embrulha com `data`; `httpError` ⇒ seta `Retry-After` e lança); env (defaults).

- [ ] **Step 2: Run (FAIL)** → FAIL.

- [ ] **Step 3: Implement.** Declare `@Post('preview')` **acima** de `@Post(':id/…')` no controller (não há conflito com `@Post()`, mas mantenha a rota estática antes das parametrizadas). Swagger: `@ApiOperation({ summary: 'Simulate the fiscal calculation without issuing' })` e `@ApiOkResponse({ type: PreviewInvoiceResponseDto })`.

- [ ] **Step 4: Run (PASS)** — `yarn jest src/modules/invoice src/infra/config && yarn typecheck && yarn typecheck:tests`.

- [ ] **Step 5: Commit** — `git commit -m "feat(api): add POST /invoices/preview behind a feature flag"`

---

## Task 4: Preview sem efeitos colaterais e paridade com o worker (Postgres)

**Files:**
- Create: `src/modules/invoice/fiscal-preview.postgres.integration.spec.ts`

**Interfaces:** Consumes `PreviewInvoiceService`, `FiscalEngineService`, `CalculateTaxesHandler`, o harness Postgres dos planos 1–3.

- [ ] **Step 1: Write the integration tests** (Postgres com role de runtime + RLS, `FakeRtcCalculator`, fila BullMQ fake que registra `add`):
  1. **Zero efeitos**: antes/depois de 20 chamadas de preview (mix MEI, regular válido, regular bloqueado), as contagens de `nfse_invoices`, `nfse_invoice_events`, `nfse_dps_sequences`, `outbox_messages`, `invoice_fiscal_snapshots`, `credit_transactions` e `webhook_deliveries` são idênticas; a fila fake e o storage S3 fake não receberam chamadas; o `FiscalProvider` não foi invocado.
  2. **Paridade**: para as mesmas entradas, `blocked/ready` e os valores do preview coincidem com o `FiscalCalculationResult` gravado pelo `CalculateTaxesHandler` (compare `taxes`, `withholdings`, `netReceivableAmount`, `classification`, `rulesVersion`).
  3. **Competência futura**: preview de `competenceDate` daqui a 30 dias usa o perfil vigente **naquela** data (perfil futuro com regime diferente muda o resultado) e não cria agendamento.
  4. **Isolamento**: tenant A com perfil MEI, tenant B com regular; preview do tenant A com `companyId` do tenant B ⇒ `CompanyNotFoundError` (404).
  5. **Idempotência de leitura**: mesma chamada duas vezes ⇒ respostas iguais exceto `trace[].durationMs`.

- [ ] **Step 2: Run** — `MIGRATION_TEST_DATABASE_URL=… yarn jest src/modules/invoice/fiscal-preview.postgres.integration.spec.ts` → deve PASSAR (o comportamento foi implementado nas tasks anteriores); se algum caso falhar, corrija a causa (não o teste).

- [ ] **Step 3: Commit** — `git commit -m "test(fiscal): preview has no side effects and matches the worker"`

---

## Task 5: Observabilidade — nomes `greenflow.*`, crons e alertas

**Files:**
- Modify: `src/modules/outbox/observability/outbox.metrics.ts`, `src/modules/invoice/application/fiscal/pipeline-observer.ts`, `src/modules/invoice/infra/fiscal/rtc/rtc.metrics.ts`, e a métrica de conciliação (plano 3, Task 8)
- Modify: `src/modules/invoice/jobs/docs-recovery.scheduler.ts` (`observeScheduledTask`)
- Modify: `src/modules/outbox/application/outbox-relay.ts` (não usa cron; apenas confira métricas)
- Create: `src/modules/invoice/application/fiscal/fiscal.metrics.ts` (centraliza os instrumentos fiscais)
- Create: `docs/fiscal/observability.md`
- Test: `docs-recovery.scheduler.spec.ts` (acrescentar), `fiscal.metrics.spec.ts`

**Interfaces:**
- Produces: nomes finais (meter → instrumento):

| Briefing/specs | Nome real |
|---|---|
| `fiscal_pipeline_duration` | `greenflow.fiscal.pipeline.duration` (histograma, `s`, atributo `ok`) |
| `fiscal_step_duration` | `greenflow.fiscal.step.duration` (`step`, `status`) |
| `fiscal_step_failed_total` | `greenflow.fiscal.step.failed.total` (`step`, `code`) |
| `fiscal_step_skipped_total` | `greenflow.fiscal.step.skipped.total` (`step`) |
| `fiscal_review_required_total` | `greenflow.fiscal.review_required.total` |
| `fiscal_classification_failure_total` | `greenflow.fiscal.classification.failure.total` (`code`) |
| `rtc_calculation_duration` / `rtc_calculator_latency` | `greenflow.rtc.calculation.duration` / `greenflow.rtc.request.duration` (`outcome`) |
| `rtc_calculation_failed_total` / `rtc_calculator_errors_total` | `greenflow.rtc.calculation.failed.total` (`reason`) |
| `fiscal_validation_failed_total` / `dps_validation_failures_total` | `greenflow.fiscal.validation.failed.total` / `greenflow.fiscal.dps.validation.failed.total` |
| `nfse_authorization_failures_total` | `greenflow.nfse.authorization.failed.total` (`code`) |
| `tax_reconciliation_mismatches_total` | `greenflow.fiscal.reconciliation.mismatch.total` (`status`) |
| `outbox_published_total` / `_publish_failures_total` / `_dead_total` | `greenflow.outbox.published.total` / `greenflow.outbox.publish.failed.total` / `greenflow.outbox.dead.total` (`type`) |
| `outbox_pending_oldest_age_seconds` | `greenflow.outbox.pending.oldest_age` (gauge observável, `s`, calculado por consulta barata `MIN(available_at)` a cada coleta, em `runAsSystem('outbox-relay')`) |
| `outbox_claim_to_publish_duration` | `greenflow.outbox.claim_to_publish.duration` |
| `preview` | `greenflow.fiscal.preview.total` (`status`: `ready|blocked|error`) e `greenflow.fiscal.preview.duration` |

- [ ] **Step 1: Write failing tests**: `fiscal.metrics.spec.ts` usa um `MeterProvider` de teste com `InMemoryMetricReader` (`@opentelemetry/sdk-metrics`, já transitiva — confirme em `package.json`; se não estiver nas dependências de desenvolvimento, adicione-a como devDependency) para registrar um passo `failed` e conferir nome do instrumento `greenflow.fiscal.step.failed.total` com atributos `step`/`code`; idem para um `skipped`, para a duração do pipeline e para o contador de preview. `docs-recovery.scheduler.spec.ts`: `handle()` executa dentro de `observeScheduledTask('docs-recovery', …)` (mock do módulo `@/shared/observability/scheduled-task-telemetry` e assert da chamada com o nome e que o corpo ainda roda).

- [ ] **Step 2: Run (FAIL)** → FAIL.

- [ ] **Step 3: Implement.** Centralize os instrumentos fiscais em `fiscal.metrics.ts` (meter `greenflow.fiscal`) e faça `OtelPipelineObserver`, `FiscalValidatorStep`, `ServiceTaxClassifierStep`, `DpsBuilder` consumer, `FiscalReconciliationService` e `PreviewInvoiceService` usarem as funções exportadas (`recordStepFinished`, `recordClassificationFailure`, `recordReviewRequired`, `recordDpsValidationFailure`, `recordReconciliationMismatch`, `recordPreview`). Renomeie as métricas do outbox e do RTC conforme a tabela (meters `greenflow.outbox` e `greenflow.rtc`). Envolva o corpo de `DocsRecoveryScheduler.handle` com `observeScheduledTask('docs-recovery', …)`. Faça `git grep -n "corvo\\.\|'outbox_\|'rtc_\|'fiscal_" -- src` e garanta que não restam nomes antigos. O gauge `pending.oldest_age` registra um `ObservableGauge` com callback que consulta `MIN(available_at)` onde `status='pending'` e `available_at <= now()` (idade 0 se vazio), tolerante a falha (retorna sem observar).

- [ ] **Step 4: `docs/fiscal/observability.md`** — tabela briefing → nome real (acima), atributos, e **regras de alerta recomendadas** em prosa/PromQL-like (o repositório não versiona alertas): idade do `pending` mais antigo > 5 min por 10 min; `outbox.dead.total` > 0; `rtc.calculation.failed.total` taxa > 10%/5 min ou circuito aberto; `fiscal.reconciliation.mismatch.total{status=divergent}` > 0; `nfse.authorization.failed.total` pico; latência p95 do pipeline > 5 s. Inclua os campos obrigatórios dos logs (correlationId, invoiceId, companyId, step, errorCode, durationMs, rulesVersion, calculatorVersion, layout) e o que **nunca** logar.

- [ ] **Step 5: Run (PASS)** — `yarn jest src && yarn typecheck && yarn lint:check`.

- [ ] **Step 6: Commit** — `git commit -m "chore(observability): align fiscal and outbox metrics to greenflow naming"`

---

## Task 6: Documentação pública, exemplos e verificação final

**Files:**
- Modify: `api/FRONTEND_API.md` (tabela "Todos os endpoints", "Payloads e enums", "Nota (`POST /invoices`)", novo "Preview fiscal"), `api/llms.txt`, `api/TENANT_ISOLATION.md` (tabelas novas e RLS)
- Create: `docs/fiscal/examples.md`
- Modify: `docs/fiscal/limitations.md`, `docs/fiscal/homologation.md` (referências cruzadas)
- Modify: DTOs/Swagger (verificar `@ApiPropertyOptional` completos)
- Test: `src/shared/http/http-contract.spec.ts` / `api-contract.postgres.integration.spec.ts` existentes

- [ ] **Step 1: `FRONTEND_API.md`.** (a) Tabela "Todos os endpoints": linhas para `POST /invoices/preview` (`K/S, nfse.invoices.issue`, 200, feature flag), `GET|PUT /companies/{id}/fiscal-profile`, `POST /companies/{id}/fiscal-profile/{profileId}/approve`, `GET|POST|PATCH /companies/{id}/fiscal-services[/{serviceId}]` (permissões `nfse.companies.view|manage`). (b) Seção "Nota (`POST /invoices`)": substitua a regra "`competenceDate`: data válida e não futura" por "não futura, exceto com `options.type = SCHEDULE` (liberada às 00:00 America/Sao_Paulo; resposta com `scheduledFor`; máximo `OUTBOX_SCHEDULE_MAX_DAYS`)", e acrescente `customer` opcional (somente quando o regime/operação permitirem), `discount`, `service.fiscal` (`nbsCode`, `cst`, `classCode`, `operationIndicator`, opcionais), `service.serviceProfileId`, `customer.address.municipalityCode`; explique que o `POST` é assíncrono e erros fiscais aparecem em `lastErrorCode`/webhook `nfse.invoice.rejected`. (c) Seção nova "Preview fiscal": request, resposta (`status ready|blocked`, `pendingFields`, `blocking`, `trace`), erros 404/422/429/503, `Retry-After`, nota de que valores são pré-emissão. (d) Catálogo de códigos fiscais (`FISCAL_*`, `TAX_*`, `OPERATION_DOCUMENT_UNSUPPORTED`, `DPS_*`, `TAX_RECONCILIATION_REQUIRED`) com categoria, retryable e ação do cliente; lembre o prefixo `ERROR_` quando vierem pelo envelope HTTP. (e) Webhook `nfse.invoice.fiscal_discrepancy` (payload sem XML/documentos). (f) Atualize "Pendências reais".

- [ ] **Step 2: `llms.txt`** com o mesmo conteúdo em formato resumido (endpoints, campos novos, erros, preview).

- [ ] **Step 3: `docs/fiscal/examples.md`** — exemplos `curl` completos e respostas esperadas: barbearia MEI sem tomador (`060101`, R$ 50, `2026-10-13`), barbearia com cliente (CPF **válido** gerado com `isValidCpf`), consultoria de tecnologia com CNPJ válido (`010601`, R$ 1000, `2026-12-10`), Simples Nacional (`060201`), override fiscal usando **códigos reais lidos dos catálogos importados** (`jq` sobre `src/modules/invoice/infra/fiscal/catalog/*.json` para escolher; nunca os placeholders `*_VALIDADO`), agendamento `SCHEDULE`, produto físico (resposta `OPERATION_DOCUMENT_UNSUPPORTED`), preview `ready` e `blocked`. Cada exemplo indica o regime/perfil pré-requisito (como cadastrar via `PUT fiscal-profile`/`fiscal-services`).

- [ ] **Step 4: `limitations.md` e `homologation.md`** — consolide a lista final de limitações reais (consulte o que cada plano registrou) e mantenha o registro de homologação com o que foi efetivamente executado; linhas não executadas ficam "não executado".

- [ ] **Step 5: Contract/Swagger.** Rode o gerador do Swagger (ou o teste de contrato existente) e confirme que `options.type`, `scheduledFor`, `service.fiscal`, `discount`, preview e endpoints de perfil aparecem; corrija DTOs sem decoradores.

- [ ] **Step 6: Verificação final completa**
```bash
yarn lint:check
yarn typecheck && yarn typecheck:tests
yarn test --runInBand
MIGRATION_TEST_DATABASE_URL=postgres://…_test yarn jest postgres.integration
yarn test:fiscal:integration
yarn build && node scripts/verify-build-artifacts.mjs
docker compose -f ../deploy/docker-compose.yml config --quiet
```
Expected: tudo verde. Anote qualquer falha pré-existente separadamente; não mascare.

- [ ] **Step 7: Commit** — `git commit -m "docs(api): document preview, scheduling, fiscal fields and error codes"`
