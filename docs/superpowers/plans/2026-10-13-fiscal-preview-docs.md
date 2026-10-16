Renomeado: preview → calculate em 2026-10-15

# Cálculo pré-emissão, observabilidade e documentação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor a FiscalEngine sem emitir (`POST /v1/invoices/calculate`), alinhar a observabilidade ao padrão `corvo.*` do repositório e documentar contratos, runbooks e exemplos.

**Architecture:** Um `InvoiceIntakeService` (extraído do `InvoiceService.emit`) valida/normaliza a entrada e é usado por emissão e calculate. O `InvoiceCalculationService` roda o **mesmo** `FiscalEngineService` do worker, de forma síncrona, em contexto novo e sem nenhuma escrita. O pipeline ganha `executeWithPartial` para devolver o contexto parcial quando uma etapa bloqueia, o que permite ao calculate informar campos pendentes e cálculos já disponíveis.

**Disponibilidade:** endpoint sempre ativo, como o motor fiscal, com autenticação e permissão `nfse.invoices.issue`. Reutilizar exatamente o rate limit HTTP autenticado existente (`RATE_LIMIT_AUTHENTICATED`, padrão 300/min por API key/sessão), sem configuração ou orçamento próprios de cálculo.

**Tech Stack:** NestJS 11, class-validator, OpenTelemetry (`@opentelemetry/api`), Redis rate limiter existente, Jest.

**Spec:** `docs/superpowers/specs/2026-10-13-fiscal-preview-docs-design.md` (depende dos planos `outbox-intake-schedule`, `fiscal-engine-core` e `rtc-dps-reconciliation`).

## Global Constraints

- Caminhos `src/`, `test/`, `scripts/` são relativos a `api/`; `docs/` e `deploy/` são relativos à raiz do repositório.
- Branch `feat/invoice-calculate`; nunca na `main`.
- Cálculo pré-emissão: **zero escrita** em `nfse_invoices`, `nfse_invoice_events`, `nfse_dps_sequences`, `outbox_messages`, `invoice_fiscal_snapshots`, `invoice_fiscal_reconciliations`, `credit_transactions`, `webhook_deliveries`, filas BullMQ e S3; nenhuma chamada à Sefin. Verificado por teste.
- Permissão: reutiliza `nfse.invoices.issue` (nenhuma permissão nova — `TenantPermission` e o catálogo ficam intactos).
- Envelope de erro do app (não o do spec): corpo `{ statusCode, code, message, details?, requestId }` produzido por `apiErrorBody`; códigos públicos ganham o prefixo `ERROR_` (`FISCAL_CLASSIFICATION_REQUIRED` → `ERROR_FISCAL_CLASSIFICATION_REQUIRED`). `details` é `[{ field?, code, message }]`.
- Valores monetários e alíquotas como **strings decimais** na resposta.
- Convenção de métricas do repositório: meter `corvo.<area>`, nomes `corvo.<area>.<métrica>` (separador `.`).
- Sem `any`; sem dados pessoais completos em logs; nenhum XML em log.

## Desvios deliberados do spec

1. Falhas **fiscais** do calculate (VALIDATION, CONFIGURATION, CLASSIFICATION, UNSUPPORTED, CALCULATION) respondem `200` com `status: 'blocked'`, `blocking` e `pendingFields`, em vez de `422`: o filtro global descarta campos extras em corpos 4xx e um 422 não conseguiria carregar cálculos parciais. Erros da **requisição** (DTO inválido, empresa inexistente, `FiscalValidationError` de normalização) seguem 4xx normais; `INTEGRATION` ⇒ `503` com `Retry-After`; `INTERNAL` ⇒ `500` genérico.
2. Sem permissão `invoices:calculate`; reutiliza `nfse.invoices.issue`.
3. Nomes de métricas do briefing (`fiscal_step_duration` etc.) são renomeados para o padrão `corvo.fiscal.step.duration` (tabela na Task 5); `docs/fiscal/observability.md` mantém o mapeamento briefing → nome real.

## Review Focus

- Cálculo pré-emissão chamado em loop não consome crédito, número DPS nem linhas no banco (Task 4).
- Cálculo pré-emissão com RTC fora do ar devolve 503 com `Retry-After`, nunca valor presumido (Task 3).
- Cálculo pré-emissão de competência futura funciona sem `options.type`, não cria agendamento e respeita o horizonte de `OUTBOX_SCHEDULE_MAX_DAYS` (15 dias por padrão) (Task 2).
- Cálculo pré-emissão de MEI sem tomador não exige tomador; de regime regular sem tomador volta `blocked` com `customer` pendente (Task 2).
- Resultado do calculate deve coincidir com o worker para as mesmas entradas e mesma data (paridade, Task 4). Limitação descoberta: persistência legada perde desconto; a verificação de paridade cobre entradas sem desconto, sem alterar emissão (ver `docs/fiscal/limitations.md`).
- Tenant A não enxerga perfis do tenant B no calculate; o rate limit é o mesmo HTTP autenticado dos demais endpoints (Task 3/4).
- Resposta não ecoa documentos completos do cliente (Task 2).

---

## Task 1: `InvoiceIntakeService` (entrada compartilhada por emissão e calculate)

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
    constructor(companyService: CompanyService, invoiceDomain: InvoiceDomainService)
    prepare(dto: CreateInvoiceDto, tenantId: string, environment: ExecutionEnvironment, mode?: { allowFutureCompetence?: boolean }): Promise<PreparedInvoiceInput>;
  }
  ```
  `prepare` = resolver empresa (`companyId` vence `companyTaxId`; `BadRequestException('companyId or companyTaxId is required')`), validar `municipalityCode` da empresa (mesmo `FiscalValidationError` de hoje) e `invoiceDomain.normalizeAndValidate({ ...dto, companyId: company.id, ...(mode?.allowFutureCompetence ? { options: { ...dto.options, type: 'SCHEDULE' } } : {}) }, environment, defaults)`. **Não** executa `ensureReady`, certificado, quota, idempotência nem escrita (esses passos continuam no `emit`).

- [ ] **Step 1: Write the failing tests** — `invoice-intake.service.spec.ts` (mocks de `CompanyService`/`InvoiceDomainService` reais onde possível): `companyId` tem prioridade; só `companyTaxId` ⇒ `findByTaxId`; nenhum ⇒ `BadRequestException`; empresa sem `municipalityCode` de 7 dígitos ⇒ `FiscalValidationError` com campo `company.municipalityCode`; defaults da empresa (`defaultServiceCode`, `municipalityCode`) chegam ao `normalizeAndValidate`; `allowFutureCompetence` converte `options.type` para `SCHEDULE` **sem** mutar o `dto` original; nenhuma chamada a `ensureReady`/`certificateService`.

- [ ] **Step 2: Run (FAIL)** — `yarn jest src/modules/invoice/application/invoice-intake.service.spec.ts`.

- [ ] **Step 3: Implement** o serviço e refatore `InvoiceService.emit` para `const { company, normalized } = await this.intake.prepare(dto, tenantId, environment)` mantendo, na mesma ordem, hash/idempotência **antes**, e `ensureReady`/certificado (live) **depois**. Injete `InvoiceIntakeService` em `InvoiceService` (último parâmetro do construtor) e atualize os três specs que fazem `new InvoiceService(...)`.

- [ ] **Step 4: Run (PASS)** — `yarn jest src/modules/invoice && yarn typecheck && yarn typecheck:tests` (nenhuma regressão no `emit`).

- [ ] **Step 5: Commit** — `git commit -m "refactor(invoice): extract the shared intake step from emit"`

---

## Task 2: Núcleo do calculate (serviço, resposta e pipeline parcial)

**Files:**
- Modify: `src/modules/invoice/domain/fiscal/fiscal-pipeline.ts` (`executeWithPartial`)
- Modify: `src/modules/invoice/application/fiscal/fiscal-engine.service.ts` (`calculateNormalized`, `calculatePartial`)
- Create: `src/modules/invoice/application/fiscal/invoice-calculation.service.ts`
- Create: `src/modules/invoice/application/fiscal/calculation-response.ts` (função pura `toCalculationResponse`)
- Create: `src/modules/invoice/http/invoice-calculation-response.dto.ts`
- Test: `fiscal-pipeline.spec.ts` (acrescentar), `calculation-response.spec.ts`, `invoice-calculation.service.spec.ts`

**Interfaces:**
- Consumes: `FiscalPipeline`, `FiscalEngineService`, `InvoiceIntakeService`, `FiscalContext`, `FiscalCalculationResult`, `buildFiscalCalculationResult`.
- Produces:
  ```ts
  // fiscal-pipeline.ts
  executeWithPartial(initial: FiscalContext): Promise<{ context: FiscalContext; error: FiscalError | null }>;   // execute() passa a delegar a este
  // fiscal-engine.service.ts
  calculatePartial(normalized: NormalizedInvoice): Promise<{ context: FiscalContext; error: FiscalError | null; result: FiscalCalculationResult | null }>;
  toNormalizedInvoice(...)   // extrair mapeamento compartilhado para NormalizedInvoiceInput; calculate(invoice, company) preserva o comportamento do worker
  // calculation-response.ts
  export const CALCULATION_DISCLAIMER = 'Pre-emission calculation. Values are not a fiscal document and may differ from the final validation by Sefin.';
  export type CalculationStatus = 'ready' | 'blocked';
  export interface CalculationPendingField { field: string; reason: string }
  export function toCalculationResponse(input: { context: FiscalContext; error: FiscalError | null; result: FiscalCalculationResult | null }): InvoiceCalculationResponse;
  ```
  `InvoiceCalculationResponse`: `{ preEmission: true; status: CalculationStatus; disclaimer: string; competenceDate: string; taxRegime: TaxRegimeKind | null; classification: {serviceCode, nbsCode, cst, classCode, operationIndicator, source, catalogValidated, catalogVersions} | null; applicability: Record<'iss'|'issWithheld'|'federalWithholding'|'cbs'|'ibs'|'specialTreatment', {status, reason?, missingFields?}> | null; taxes: {...TaxAmount} | {}; withholdings: WithholdingAmount[]; netReceivableAmount: string | null; collectionWaived: boolean | null; calculation: { source, calculatorVersion, rulesVersion, legalReferences } | null; warnings: FiscalWarning[]; pendingFields: CalculationPendingField[]; blocking: { code, message, step, category, retryable, details } | null; trace: Array<{ step, status, durationMs, reason? }> }`.
  `pendingFields` vem de: `error.details.missingFields` / `error.details.fields` (strings), mais todo `Obligation` `MISSING_CONFIGURATION.missingFields` do contexto parcial. `taxes`/`withholdings`/`netReceivableAmount` refletem **somente o que as etapas já calcularam** (parcial quando `blocked`). **Não ecoa** `customer.taxId` nem nome do cliente.
  ```ts
  @Injectable() export class InvoiceCalculationService {
    calculate(dto: CreateInvoiceDto, tenantId: string, environment: ExecutionEnvironment): Promise<{ response: InvoiceCalculationResponse } | { httpError: FiscalError }>;
  }
  ```
  Regras: `prepare(..., { allowFutureCompetence: true })`; monta `NormalizedInvoice` com `invoiceId = randomUUID()` (nunca persistido); `calculatePartial`; se `error?.category === 'INTEGRATION'` ou `'INTERNAL'` ⇒ `{ httpError }`; senão `{ response: toCalculationResponse(...) }` (`status 'blocked'` quando `error` existe, `'ready'` caso contrário).

- [ ] **Step 1: Write failing tests**
  - Pipeline: `executeWithPartial` devolve o contexto até a última etapa aplicada e o erro da etapa que falhou (`context.trace` contém as etapas anteriores e **não** a falha); `execute` continua igual (regressão: todos os testes antigos do pipeline passam).
  - `calculation-response.spec.ts`: MEI 2026 sem tomador ⇒ `ready`, `taxes {}`, aplicabilidade com `NOT_APPLICABLE` e razões; regular sem classificação ⇒ `blocked` com `blocking.code 'FISCAL_CLASSIFICATION_REQUIRED'`, `pendingFields` listando `service.fiscal.nbsCode` etc. e `classification` parcial já resolvida; regular sem tomador ⇒ `blocked`, `pendingFields [{ field: 'customer', … }]`; resposta nunca contém `taxId` do cliente (stringify e `not.toContain`); `disclaimer` presente; valores como strings.
  - `invoice-calculation.service.spec.ts`: competência futura sem `options.type` aceita e devolve `competenceDate` futura; RTC retryable ⇒ `{ httpError }`; erro interno ⇒ `{ httpError }`; erro fiscal de configuração ⇒ `response.status 'blocked'`; `FiscalValidationError` da normalização propaga (vira 422 pelo filtro); nenhuma dependência de escrita é chamada (os mocks de repositórios/filas/lifecycle não são sequer injetados — o construtor do serviço só recebe `intake`, `engine`).

- [ ] **Step 2: Run (FAIL)** — `yarn jest src/modules/invoice` → FAIL.

- [ ] **Step 3: Implement** — `executeWithPartial` é o laço atual do `execute` retornando `{ context, error }` (sem lançar); `execute` = `const r = await executeWithPartial(initial); return r.error ? err(r.error) : ok(r.context)`. `FiscalEngineService.calculatePartial` cria o pipeline com `OtelPipelineObserver({ invoiceId: normalized.invoiceId, companyId: normalized.company.id })`, chama `executeWithPartial` e, sem erro, `buildFiscalCalculationResult(context)` (se esse construir falhar ⇒ `error` do resultado). `toCalculationResponse` é função pura; `InvoiceCalculationResponseDto` é a classe com `@ApiProperty` espelhando `InvoiceCalculationResponse` para o Swagger.

- [ ] **Step 4: Run (PASS)** — `yarn jest src/modules/invoice && yarn typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): add calculate service and partial pipeline results"`

---

## Task 3: Rota `POST /v1/invoices/calculate` (rate limit existente e mapeamento de erros)

**Files:**
- Reuse: `src/shared/http/rate-limit.guard.ts` já instalado; não criar guard, metadado ou configuração dedicada
- Create: `src/modules/invoice/http/fiscal-error-http.ts`
- Modify: `src/modules/invoice/http/invoice.controller.ts`, `src/modules/invoice/invoice.module.ts` (providers `InvoiceCalculationService`)
- Test: specs do rate limit HTTP existente, `fiscal-error-http.spec.ts`, `invoice.controller.spec.ts` e rate limit HTTP padrão

**Interfaces:**
- Produces:
  ```ts
  // fiscal-error-http.ts
  export function calculationHttpFailure(error: FiscalError): { exception: ApplicationError; retryAfterSeconds?: number }
  // INTEGRATION → ApplicationError({ code: error.code, kind: 'dependency', retryable: true, safeMessage: 'Fiscal calculation is temporarily unavailable' }) + retryAfterSeconds (details.retryAfterMs/1000 arredondado para cima, mínimo 1, padrão 5)
  // INTERNAL (e qualquer outro inesperado) → ApplicationError({ code: 'FISCAL_INTERNAL_ERROR', kind: 'internal', safeMessage: 'Internal server error' })
  // controller
  @Post('calculate') @HttpCode(200) @ApiKeyEndpoint() @RequirePermission('nfse.invoices.issue') // proteção pelo HttpApiRateLimitGuard global existente
  calculate(@Body() dto: CreateInvoiceDto, @Req() req, @Res({ passthrough: true }) res): Promise<ReturnType<typeof data>>
  ```
  Comportamento do controller: rota sempre disponível para API key/sessão autorizada com `nfse.invoices.issue`; chama `calculation.calculate(dto, tenantId, executionEnvironment(auth))`, define `Retry-After` antes de lançar a exceção em falhas HTTP, ou retorna `data(response)`.
  `HttpApiRateLimitGuard` global existente, sem configuração adicional na rota: orçamento autenticado padrão por API key/sessão (`RATE_LIMIT_AUTHENTICATED=300` por minuto), 429 com `Retry-After` e `X-RateLimit-*`. Isolamento dos dados continua sendo por tenant/ambiente.

- [ ] **Step 1: Write failing tests** — INTEGRATION ⇒ 503 e Retry-After (2500 ms ⇒ 3 s; padrão 5; mínimo 1); INTERNAL ⇒ 500 genérico; limite HTTP padrão e cabeçalhos 429; rota disponível sem configuração adicional.

- [ ] **Step 2: Run (FAIL)** → FAIL.

- [ ] **Step 3: Implement.** Declare `@Post('calculate')` **acima** de `@Post(':id/…')` no controller (não há conflito com `@Post()`, mas mantenha a rota estática antes das parametrizadas). Swagger: `@ApiOperation({ summary: 'Calculate taxes before issuing an invoice' })` e `@ApiOkResponse({ type: InvoiceCalculationResponseDto })`.

- [ ] **Step 4: Run (PASS)** — `yarn jest src/modules/invoice src/infra/config && yarn typecheck && yarn typecheck:tests`.


---

- [ ] **Commit da Task 3:** `feat(api): expose invoice pre-emission calculation`

## Task 4: Cálculo pré-emissão sem efeitos colaterais e paridade com o worker (Postgres)

**Files:**
- Create: `src/modules/invoice/calculate.postgres.integration.spec.ts`

**Interfaces:** Consumes `InvoiceCalculationService`, `FiscalEngineService`, `CalculateTaxesHandler`, o harness Postgres dos planos 1–3.

- [ ] **Step 1: Write the integration tests** (Postgres com role de runtime + RLS, `FakeRtcCalculator`, fila BullMQ fake que registra `add`):
  1. **Zero efeitos**: antes/depois de 20 chamadas de calculate (mix MEI, regular válido, regular bloqueado), as contagens de `nfse_invoices`, `nfse_invoice_events`, `nfse_dps_sequences`, `outbox_messages`, `invoice_fiscal_snapshots`, `invoice_fiscal_reconciliations`, `credit_transactions`, `webhook_deliveries` e `webhook_deliveries` são idênticas; a fila fake e o storage S3 fake não receberam chamadas; o `FiscalProvider` não foi invocado.
  2. **Paridade**: para as mesmas entradas, `blocked/ready` e os valores do calculate coincidem com o `FiscalCalculationResult` gravado pelo `CalculateTaxesHandler` (compare `taxes`, `withholdings`, `netReceivableAmount`, `classification`, `rulesVersion`).
  3. **Competência futura**: calculate de `competenceDate` daqui a 7 dias usa o perfil vigente **naquela** data (perfil futuro com regime diferente muda o resultado) e não cria agendamento.
  4. **Isolamento**: tenant A com perfil MEI, tenant B com regular; calculate do tenant A com `companyId` do tenant B ⇒ `CompanyNotFoundError` (404).
  5. **Idempotência de leitura**: mesma chamada duas vezes ⇒ respostas iguais exceto `trace[].durationMs`.

- [ ] **Step 2: Run** — `MIGRATION_TEST_DATABASE_URL=… yarn jest src/modules/invoice/calculate.postgres.integration.spec.ts` → deve PASSAR (o comportamento foi implementado nas tasks anteriores); se algum caso falhar, corrija a causa (não o teste).

- [ ] **Step 3: Commit** — `git commit -m "test(fiscal): calculate has no side effects and matches the worker"`

---

## Task 5: Observabilidade — nomes `corvo.*`, crons e alertas

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
| `fiscal_pipeline_duration` | `corvo.fiscal.pipeline.duration` (histograma, `s`, atributo `ok`) |
| `fiscal_step_duration` | `corvo.fiscal.step.duration` (`step`, `status`) |
| `fiscal_step_failed_total` | `corvo.fiscal.step.failed.total` (`step`, `code`) |
| `fiscal_step_skipped_total` | `corvo.fiscal.step.skipped.total` (`step`) |
| `fiscal_review_required_total` | `corvo.fiscal.review_required.total` |
| `fiscal_classification_failure_total` | `corvo.fiscal.classification.failure.total` (`code`) |
| `rtc_calculation_duration` / `rtc_calculator_latency` | `corvo.rtc.calculation.duration` / `corvo.rtc.request.duration` (`outcome`) |
| `rtc_calculation_failed_total` / `rtc_calculator_errors_total` | `corvo.rtc.calculation.failed.total` (`reason`) |
| `fiscal_validation_failed_total` / `dps_validation_failures_total` | `corvo.fiscal.validation.failed.total` / `corvo.fiscal.dps.validation.failed.total` |
| `nfse_authorization_failures_total` | `corvo.nfse.authorization.failed.total` (`code`) |
| `tax_reconciliation_mismatches_total` | `corvo.fiscal.reconciliation.mismatch.total` (`status`) |
| `outbox_published_total` / `_publish_failures_total` / `_dead_total` | `corvo.outbox.published.total` / `corvo.outbox.publish.failed.total` / `corvo.outbox.dead.total` (`type`) |
| `outbox_pending_oldest_age_seconds` | `corvo.outbox.pending.oldest_age` (gauge observável, `s`, calculado por consulta barata `MIN(available_at)` a cada coleta, em `runAsSystem('outbox-relay')`) |
| `outbox_claim_to_publish_duration` | `corvo.outbox.claim_to_publish.duration` |
| `calculate` | `corvo.fiscal.calculate.total` (`status`: `ready|blocked|error`) e `corvo.fiscal.calculate.duration` |

- [ ] **Step 1: Write failing tests**: `fiscal.metrics.spec.ts` usa um `MeterProvider` de teste com `InMemoryMetricReader` (`@opentelemetry/sdk-metrics`, já transitiva — confirme em `package.json`; se não estiver nas dependências de desenvolvimento, adicione-a como devDependency) para registrar um passo `failed` e conferir nome do instrumento `corvo.fiscal.step.failed.total` com atributos `step`/`code`; idem para um `skipped`, para a duração do pipeline e para o contador de calculate. `docs-recovery.scheduler.spec.ts`: `handle()` executa dentro de `observeScheduledTask('docs-recovery', …)` (mock do módulo `@/shared/observability/scheduled-task-telemetry` e assert da chamada com o nome e que o corpo ainda roda).

- [ ] **Step 2: Run (FAIL)** → FAIL.

- [ ] **Step 3: Implement.** Centralize os instrumentos fiscais em `fiscal.metrics.ts` (meter `corvo.fiscal`) e faça `OtelPipelineObserver`, `FiscalValidatorStep`, `ServiceTaxClassifierStep`, `DpsBuilder` consumer, `FiscalReconciliationService` e `InvoiceCalculationService` usarem as funções exportadas (`recordStepFinished`, `recordClassificationFailure`, `recordReviewRequired`, `recordDpsValidationFailure`, `recordReconciliationMismatch`, `recordCalculation`). Renomeie as métricas do outbox e do RTC conforme a tabela (meters `corvo.outbox` e `corvo.rtc`). Envolva o corpo de `DocsRecoveryScheduler.handle` com `observeScheduledTask('docs-recovery', …)`. Faça `git grep -n -i greenflow -- src` e classifique as ocorrências remanescentes (identidades, Redis/cookies, Sentry e hosts externos são preservados). Nenhum meter/instrumento/scope/atributo de telemetria mantém o prefixo antigo. O gauge `pending.oldest_age` registra um `ObservableGauge` com callback que consulta `MIN(available_at)` onde `status='pending'` e `available_at <= now()` (idade 0 se vazio), tolerante a falha (retorna sem observar).

- [ ] **Step 4: `docs/fiscal/observability.md`** — tabela briefing → nome real (acima), atributos, e **regras de alerta recomendadas** em prosa/PromQL-like (o repositório não versiona alertas): idade do `pending` mais antigo > 5 min por 10 min; `outbox.dead.total` > 0; `rtc.calculation.failed.total` taxa > 10%/5 min ou circuito aberto; `fiscal.reconciliation.mismatch.total{status=divergent}` > 0; `nfse.authorization.failed.total` pico; latência p95 do pipeline > 5 s. Inclua os campos obrigatórios dos logs (correlationId, invoiceId, companyId, step, errorCode, durationMs, rulesVersion, calculatorVersion, layout) e o que **nunca** logar.

- [ ] **Step 5: Run (PASS)** — `yarn jest src && yarn typecheck && yarn lint:check`.

- [ ] **Step 6: Commit** — `git commit -m "chore(observability): align fiscal and outbox metrics to corvo naming"`

---

## Task 6: Documentação pública, exemplos e verificação final

**Files:**
- Modify: `api/FRONTEND_API.md` (tabela "Todos os endpoints", "Payloads e enums", "Nota (`POST /invoices`)", novo "Cálculo pré-emissão fiscal"), `api/llms.txt`, `api/TENANT_ISOLATION.md` (tabelas novas e RLS)
- Create: `docs/fiscal/examples.md`
- Modify: `docs/fiscal/limitations.md`, `docs/fiscal/homologation.md` (referências cruzadas)
- Modify: DTOs/Swagger (verificar `@ApiPropertyOptional` completos)
- Test: `src/shared/http/http-contract.spec.ts` / `api-contract.postgres.integration.spec.ts` existentes


- [ ] **Step 1: `FRONTEND_API.md`.** Tabela de endpoints com `POST /invoices/calculate` (200 `ready|blocked`, sempre disponível, `nfse.invoices.issue`) e as rotas reais `fiscal-profile`/`service-tax-profiles`. Documentar competência futura sem `options.type` no cálculo (limite de 15 dias), `customer` opcional por regime/operação, `discount` numérico, `service.fiscal`, `service.serviceProfileId` separado e `customer.address.municipalityCode`. Incluir request/response, erros 404/422/429/503, `Retry-After`, envelope `ERROR_*`, aviso pré-emissão, ausência de efeitos colaterais, webhook `nfse.invoice.fiscal_discrepancy` e catálogo de códigos fiscais. O rate limit é exatamente o HTTP autenticado padrão, sem orçamento/configuração próprios de cálculo. Preservar o contrato assíncrono do `POST /invoices`; competência futura na emissão continua exigindo `SCHEDULE`. Registrar limitações reais e resultados de homologação sem presumir execução.

- [ ] **Step 2: `llms.txt`** com o mesmo conteúdo em formato resumido (endpoints, campos novos, erros, calculate).

- [ ] **Step 3: `docs/fiscal/examples.md`** — exemplos `curl` completos e respostas esperadas: barbearia MEI sem tomador (`060101`, R$ 50, `2026-10-13`), barbearia com cliente (CPF **válido** gerado com `isValidCpf`), consultoria de tecnologia com CNPJ válido (`010601`, R$ 1000, `2026-10-13`; a data `2026-12-10` do fixture RTC ultrapassa o horizonte de 15 dias em 15/10/2026), Simples Nacional (`060201`), override fiscal usando **códigos reais dos fixtures** em `docs/fiscal/rtc/fixtures/*.json` ou consultas à Calculadora RTC local (nunca placeholders ou códigos presumidos), agendamento `SCHEDULE`, produto físico (resposta `OPERATION_DOCUMENT_UNSUPPORTED`), calculate `ready` e `blocked`. Cada exemplo indica o regime/perfil pré-requisito (como cadastrar via `PUT fiscal-profile`/`service-tax-profiles`).

- [ ] **Step 4: `limitations.md` e `homologation.md`** — consolide a lista final de limitações reais (consulte o que cada plano registrou) e mantenha o registro de homologação com o que foi efetivamente executado; linhas não executadas ficam "não executado".

- [ ] **Step 5: Contract/Swagger.** Rode o gerador do Swagger (ou o teste de contrato existente) e confirme que `options.type`, `scheduledFor`, `service.fiscal`, `discount`, calculate e endpoints de perfil aparecem; corrija DTOs sem decoradores.

- [ ] **Step 6: Verificação final completa**
```bash
yarn lint:check
yarn typecheck && yarn typecheck:tests
yarn test --runInBand
MIGRATION_TEST_DATABASE_URL=postgres://…_test yarn jest postgres.integration
yarn build && node scripts/verify-build-artifacts.mjs
docker compose -f ../deploy/docker-compose.yml config --quiet
```
Registre os resultados reais: passaram, skipped e falhas pré-existentes. Não execute `test/fiscal-environments.e2e-spec.ts` (depende de S3/Redis/worker). As cinco falhas conhecidas de Postgres devem ser registradas separadamente, sem correção fora do escopo.

- [ ] **Step 7: Commit** — `git commit -m "docs(api): document calculate, scheduling, fiscal fields and error codes"`
