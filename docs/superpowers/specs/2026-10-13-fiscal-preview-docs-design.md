Renomeado: preview → calculate em 2026-10-15

# Spec 4 — Cálculo pré-emissão, observabilidade e documentação

Data da revisão: 2026-10-15 · Depende de: Specs 1–3 · Escopo: `api/`.
Os nomes dos arquivos originais são preservados para manter referências históricas.

## 1. Objetivo

Expor o motor fiscal sem emitir: `POST /v1/invoices/calculate`. Fechar métricas,
runbooks, Swagger e exemplos. O endpoint é sempre disponível para quem possui
API key/sessão válida e `nfse.invoices.issue`, como as demais rotas de emissão.

## 2. Cálculo pré-emissão (`calculate`)

- Mesmo corpo de `CreateInvoiceDto`. `companyId` vence `companyTaxId`; empresa
  inexistente ou de outro tenant/ambiente retorna 404.
- `InvoiceIntakeService.prepare` compartilha resolução e normalização com
  `emit`, preservando o contrato de emissão. Para cálculo, clona o DTO com
  `options.type = 'SCHEDULE'`, permitindo competência futura sem essa opção no
  request. `scheduledFor` é ignorado; nenhum agendamento é criado. O horizonte
  de `OUTBOX_SCHEDULE_MAX_DAYS` continua valendo (15 dias por padrão).
- `InvoiceCalculationService` depende somente de `InvoiceIntakeService` e
  `FiscalEngineService`. O mapeamento de dados normalizados é compartilhado pelo
  worker e pelo caminho em memória, sem precisar persistir uma `Invoice`.
- `FiscalPipeline.executeWithPartial(initial)` devolve `{ context, error }`;
  `execute` delega a ele preservando seu `Result` fail-fast. O contexto parcial
  contém somente as etapas já aplicadas, com trace resumido.
- Não consome créditos, numeração DPS ou filas; não grava em `nfse_invoices`,
  `nfse_invoice_events`, `nfse_dps_sequences`, `outbox_messages`,
  `invoice_fiscal_snapshots`, `invoice_fiscal_reconciliations`,
  `credit_transactions`, `webhook_deliveries`; não acessa S3 nem transmite à Sefin.
- Resposta HTTP 200 em `{ data: InvoiceCalculationResponse }`: `preEmission: true`,
  `status: ready|blocked`, `disclaimer`, `competenceDate`, `taxRegime`,
  `classification`, `applicability` por tributo, `taxes`, `withholdings`,
  `netReceivableAmount`, `collectionWaived`, `calculation` (`source`,
  `calculatorVersion`, `rulesVersion`, `legalReferences`), `warnings`,
  `pendingFields`, `blocking` e `trace` (`step`, `status`, `durationMs`, `reason?`).
  Valores monetários e alíquotas são strings decimais; nunca ecoar documento
  nem nome do cliente. Em `blocked`, só mostrar os valores já calculados.
- `pendingFields` combina `error.details.missingFields`/`fields` e obrigações
  `MISSING_CONFIGURATION.missingFields` do contexto parcial, sem duplicação.
- VALIDATION, CONFIGURATION, CLASSIFICATION, UNSUPPORTED e CALCULATION ⇒ 200 com
  `status: blocked` e `blocking { code, message, step, category, retryable, details }`.
  INTEGRATION ⇒ 503 com `Retry-After = ceil(retryAfterMs/1000)`, mínimo 1 s,
  padrão 5 s. INTERNAL ⇒ 500 genérico sem mensagem original nem stack.
- Erros da requisição (DTO inválido, `FiscalValidationError` na normalização,
  empresa inexistente) seguem 4xx e o envelope do app
  `{ statusCode, code, message, details?, requestId }`, com códigos `ERROR_*`.
  O controller define `Retry-After` antes de lançar `ApplicationError`.
- Reutilizar exatamente `HttpApiRateLimitGuard` e `RedisRateLimiter` existentes:
  mesmo limite autenticado dos demais endpoints, `RATE_LIMIT_AUTHENTICATED`
  (padrão 300/min por API key/sessão), sem orçamento, configuração ou metadado
  próprios de cálculo. Responder 429 com `Retry-After` e `X-RateLimit-*`.
  Nenhum guard dedicado nem permissão nova.
- Declarar a rota estática antes de `:id/...`; Swagger com `@ApiOperation` e
  `@ApiOkResponse({ type: InvoiceCalculationResponseDto })`.

## 3. Observabilidade

Nomes de instrumentos, meters, scopes e atributos de telemetria usam `corvo.*`.
Instrumentos fiscais centralizados em `fiscal.metrics.ts`; cálculo pré-emissão
registra `corvo.fiscal.calculate.total{status=ready|blocked|error}` e
`corvo.fiscal.calculate.duration`. A Calculadora RTC é o motor externo e usa
`corvo.rtc.*`; não confundir com o endpoint `calculate`.
O mapeamento completo e alertas ficam em `docs/fiscal/observability.md`, com
runbooks em `docs/fiscal/runbooks/`. Correlação acompanha HTTP e jobs existentes.
Identidades de serviço, cookies, Redis, Sentry e hosts externos são preservadas.

## 4. Documentação

Atualizar `api/FRONTEND_API.md`, `api/llms.txt`, exemplos completos em
`docs/fiscal/examples.md` e referências de limitações/homologação.
Documentar os endpoints reais de perfil: `fiscal-profile` e
`service-tax-profiles` (o contrato atual não usa `fiscal-services`).
Exemplos com CPF/CNPJ válidos e códigos NBS/CST/cClassTrib apenas dos fixtures
reais da Calculadora RTC. Informar o perfil/regime pré-requisito em cada caso.

## 5. Testes e verificação

TDD por tarefa: teste → falha esperada → implementação → passa → commit.
Cobrir pipeline parcial, response sem dados do cliente, serviço com somente duas
dependências, competência futura, 503/Retry-After, erro interno genérico, rota
sempre ativa, rate limit HTTP padrão e regressão do `emit`.
Postgres: 20 chamadas sem alterar contagens; paridade com `CalculateTaxesHandler`;
perfil vigente na competência futura; empresa de outro tenant retorna 404.
Métricas verificadas com `MeterProvider`/`InMemoryMetricReader`.
Registrar resultados reais, skipped e falhas pré-existentes; testes locais não
constituem homologação na Sefin. Não executar `fiscal-environments.e2e-spec.ts`.

## 6. Escopo comercial e persistência

Cálculo pré-emissão não consome crédito de emissão. Sua proteção de custo é o
rate limit HTTP autenticado existente. Observabilidade sem persistir o payload da requisição.
Fora de escopo: persistência de simulações, cálculo em lote e UI no `web/`.
