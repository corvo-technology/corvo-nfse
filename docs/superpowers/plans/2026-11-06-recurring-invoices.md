# Notas recorrentes e agendadas: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /v1/invoices` aceita `SCHEDULE` e `RECURRING`; um cron às 09h (seg-sex, São Paulo) transforma as agendas vencidas em notas, com log, e-mails de falha e pausa automática após 3 falhas; tudo gerenciável pela API, pelo MCP e pelo painel.

**Architecture:** módulo novo `api/src/modules/invoice-schedule/` (domínio puro de datas e estado, repositório com RLS, serviço, runner do cron, controller, e-mails). O runner reusa `InvoiceService.prepareEmissionInEnvironment` e `InvoiceLifecycleService.submitBatch` sem alterá-los. A emissão fiscal (`nfse-workflow`, `dpsIssuedAt`, DPS) não é tocada. Painel e MCP consomem as mesmas rotas e serviços.

**Tech Stack:** NestJS, TypeORM, Postgres (RLS forçada), `@nestjs/schedule`, Jest; Next.js, next-intl, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-06-recurring-invoices-design.md` (a fonte de verdade em caso de conflito).

## Global Constraints

- Cron: `@Cron('0 9 * * 1-5', { timeZone: 'America/Sao_Paulo', waitForCompletion: true })`. Não roda na inicialização da API.
- Frequências: `WEEKLY` (+7 dias), `BIWEEKLY` (+14 dias), `MONTHLY` (mesmo dia; mês sem esse dia usa o último dia), sempre contadas a partir de `anchor_on`, sem acumular erro.
- Ocorrência de sábado/domingo fica vencida e roda na segunda (consulta `next_run_on <= hoje`). Depois de processar, `next_run_on` = primeira ocorrência **estritamente depois de hoje** (uma nota por execução, sem recuperar atrasos).
- Competência da nota de uma agenda = dia em que roda (`todayInSaoPaulo`), nunca `occurrence_on`.
- 1ª data: a partir de **amanhã** e até `OUTBOX_SCHEDULE_MAX_DAYS` (padrão 15) à frente. `endsOn` depois da 1ª data. Teto de **200 agendas ativas** por tenant.
- 3 falhas seguidas na mesma ocorrência: pausa (`pause_reason = 'failures'`). Falhas 1 e 2: aviso. Qualquer motivo de falha segue o mesmo fluxo.
- Chave de idempotência da execução: `schedule:<schedule_id>:<occurrence_on>` (sem a tentativa).
- Respostas de `SCHEDULE`/`RECURRING` em `POST /v1/invoices`: HTTP 202 com `{ data: <agenda> }`. `IMMEDIATE` não muda.
- Permissões: `nfse.invoices.issue` (criar/alterar/pausar/retomar/cancelar), `nfse.invoices.view` (ler). MCP: `nfse:write` e `nfse:read`.
- E-mail: 1 aviso de tentativa por tenant por dia (lista as agendas); 1 e-mail de pausa por agenda; nada em `test` nem em pausa manual. Destinatários: os mesmos do aviso de crédito baixo.
- **Não alterar** `nfse-workflow.service.ts`, `dpsIssuedAt`, `invoice-domain.service.ts` nem o relay da outbox (`available_at` continua existindo para o backoff). Agendamentos legados (outbox com `available_at` futuro) seguem funcionando sem migration.
- Migrations: próximos timestamps livres são `1792680000000` e seguintes; tabelas com `tenant_id`, `environment`, `FORCE ROW LEVEL SECURITY` e a política `tenant_isolation_policy` no padrão de `1791770000000-CreateOutboxMessages.ts`.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Trabalhar na branch `feat/recurring-invoices`, criada a partir de `docs/recurring-invoices-design`.

## Review Focus

Condições que o spec implica e que mais machucam quem usa; cada uma tem teste na tarefa dona:

1. Duas instâncias do cron rodando ao mesmo tempo não emitem a mesma ocorrência duas vezes (Task 5).
2. Queda entre criar a nota e avançar a agenda: a próxima execução faz replay e não duplica (Task 5).
3. Mensal no dia 31 atravessando fevereiro e abril volta ao dia 31 nos meses que têm (Task 1).
4. Crédito acaba no meio do lote: as mais antigas emitem, as demais falham e contam 1 tentativa (Task 5).
5. Agenda pausada/cancelada entre a seleção e a emissão não emite (Task 5).

---

### Task 1: Datas da recorrência (domínio puro)

**Files:**
- Create: `api/src/modules/invoice-schedule/domain/recurrence.ts`
- Test: `api/src/modules/invoice-schedule/domain/recurrence.spec.ts`

**Interfaces:**
- Produces:
  - `type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'`; datas são strings `YYYY-MM-DD`.
  - `occurrenceOn(anchorOn: string, frequency: Frequency, index: number): string`
  - `firstOccurrenceAfter(anchorOn: string, frequency: Frequency, after: string): { index: number; on: string }` (primeira ocorrência estritamente depois de `after`)
  - `todayInSaoPaulo(now?: Date): string`
  - `tomorrowInSaoPaulo(now?: Date): string`
  - `isBusinessDay(date: string): boolean` (segunda a sexta)

- [ ] **Step 1: Write the failing tests** (`recurrence.spec.ts`): `occurrenceOn('2026-11-02','WEEKLY',3)` = `2026-11-23`; `BIWEEKLY` índice 2 = `2026-11-30`; `occurrenceOn('2026-01-31','MONTHLY',1)` = `2026-02-28`, índice 2 = `2026-03-31`, índice 3 = `2026-04-30` (sem escorregar); ano bissexto `2028-01-31` índice 1 = `2028-02-29`; `firstOccurrenceAfter('2026-11-07','WEEKLY','2026-11-09')` = `{ index: 1, on: '2026-11-14' }` (sábado, depois de segunda); com atraso longo só devolve uma; `todayInSaoPaulo(new Date('2026-11-07T02:30:00Z'))` = `2026-11-06` (ainda é dia 6 em SP); `isBusinessDay('2026-11-07')` false, `'2026-11-09'` true.
- [ ] **Step 2: Run** `yarn jest src/modules/invoice-schedule/domain/recurrence.spec.ts`. Expected: FAIL (módulo inexistente).
- [ ] **Step 3: Implement** as funções acima em `recurrence.ts`, com `luxon` (já usado no projeto, zona `America/Sao_Paulo`); mensal usa `min(dia_do_anchor, último dia do mês alvo)` calculado do `anchor` a cada chamada.
- [ ] **Step 4: Run** o mesmo comando. Expected: PASS.
- [ ] **Step 5: Commit** `feat(schedule): datas da recorrência`.

---

### Task 2: Agregado `InvoiceSchedule` (estado e regras, puro)

**Files:**
- Create: `api/src/modules/invoice-schedule/domain/invoice-schedule.ts`
- Test: `api/src/modules/invoice-schedule/domain/invoice-schedule.spec.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `type ScheduleKind = 'once' | 'recurring'`; `type ScheduleStatus = 'active' | 'paused' | 'completed' | 'cancelled'`; `type PauseReason = 'customer' | 'failures'`.
  - `class InvoiceSchedule` com `props` (campos da tabela da spec, em camelCase) e métodos:
    - `static create(input: { tenantId; environment; companyId; kind; frequency: Frequency | null; firstOn: string; endsOn: string | null; invoiceInput: Record<string, unknown>; createdBy: string | null }, now: Date, horizonDays: number): InvoiceSchedule` (valida: `firstOn >= tomorrow` e `<= hoje + horizonDays`; `frequency` obrigatória só em `recurring`; `endsOn > firstOn`; senão lança `ScheduleValidationError` com `field` e `code`)
    - `recordIssued(today: string): void` (zera `attempts`; `once` ou próxima ocorrência > `endsOn` → `completed`; senão avança `next_run_on`/`occurrence_index` com `firstOccurrenceAfter`)
    - `recordFailure(today: string): { paused: boolean }` (`attempts + 1`; ao chegar em 3 → `paused`, `pauseReason = 'failures'`, `nextRunOn = null`)
    - `pause()`, `resume(today: string)` (volta a `active`, `attempts = 0`, `next_run_on` = 1ª ocorrência depois de hoje), `cancel()`, `update(patch, today)` (dados da nota, `endsOn`, frequência e `anchor`; mudar frequência/`anchor` recalcula `next_run_on` e zera `attempts`)
    - `isRunnable(): boolean` (`status === 'active'`)
  - `ScheduleValidationError`, `ScheduleStateError` (ex.: alterar agenda `completed`/`cancelled`).

- [ ] **Step 1: Write the failing tests**: criação válida/ inválida (amanhã vs hoje, além do horizonte, `endsOn` anterior, `recurring` sem frequência); `recordIssued` em `once` → `completed`; em `recurring` semanal numa segunda → `next_run_on` na segunda seguinte; ocorrência de sábado processada na segunda → próxima é o sábado seguinte; `endsOn` ultrapassado → `completed`; `recordFailure` 1ª e 2ª `paused:false`, 3ª `paused:true`; `resume` zera tentativas e não recupera atraso; `update`/`resume` em `cancelled` lançam `ScheduleStateError`.
- [ ] **Step 2: Run** `yarn jest src/modules/invoice-schedule/domain/invoice-schedule.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** a classe e os erros.
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(schedule): agregado InvoiceSchedule`.

---

### Task 3: Migration, entidades e repositório

**Files:**
- Create: `api/src/infra/database/migrations/1792680000000-CreateInvoiceSchedules.ts`
- Create: `api/src/modules/invoice-schedule/infra/invoice-schedule.orm-entity.ts`, `invoice-schedule-run.orm-entity.ts`, `typeorm-invoice-schedule.repository.ts`
- Create: `api/src/modules/invoice-schedule/domain/invoice-schedule.repository.ts`
- Test: `api/src/modules/invoice-schedule/infra/typeorm-invoice-schedule.repository.postgres.integration.spec.ts` (padrão dos `*.postgres.integration.spec.ts` existentes)

**Interfaces:**
- Consumes: Task 2 (`InvoiceSchedule`).
- Produces: `abstract class InvoiceScheduleRepository` + token, com:
  - `insert(schedule: InvoiceSchedule): Promise<void>`
  - `findById(id: string, tenantId: string): Promise<InvoiceSchedule | null>`
  - `list(tenantId: string, filter: { status?: ScheduleStatus; companyId?: string }, page: { limit: number; offset: number }): Promise<{ items: InvoiceSchedule[]; total: number }>`
  - `save(schedule: InvoiceSchedule): Promise<void>`
  - `countActive(tenantId: string): Promise<number>`
  - `claimDue(today: string, limit: number): Promise<InvoiceSchedule[]>` (escopo de sistema; `FOR UPDATE SKIP LOCKED`, `status = 'active' AND next_run_on <= today`, ordem `next_run_on ASC, created_at ASC`; as linhas ficam travadas até o fim da transação do runner, ver Task 5)
  - `addRun(run: ScheduleRun): Promise<void>` e `listRuns(scheduleId: string, tenantId: string, page): Promise<{ items: ScheduleRun[]; total: number }>`
  - `ScheduleRun = { id; tenantId; scheduleId; occurrenceOn: string; ranOn: string; attempt: number; outcome: 'issued' | 'failed'; invoiceId: string | null; errorCode: string | null; errorMessage: string | null; createdAt: Date }`

- [ ] **Step 1: Write the failing integration test**: cria agenda, lê de volta; outro tenant não enxerga (RLS); `claimDue` ignora `paused`/`cancelled`/futuras e ordena por `next_run_on`; duas transações concorrentes de `claimDue` nunca devolvem a mesma linha; `addRun` único em `(schedule_id, occurrence_on, attempt)`.
- [ ] **Step 2: Run** `yarn jest src/modules/invoice-schedule/infra --config <o mesmo usado pelos *.postgres.integration.spec.ts existentes>`. Expected: FAIL.
- [ ] **Step 3: Implement** a migration (tabelas `invoice_schedules` e `invoice_schedule_runs` com as colunas da spec, checks de `kind/frequency/status/pause_reason/outcome`, índice parcial `(next_run_on) WHERE status = 'active'`, FK `ON DELETE CASCADE` para `tenants`/`invoice_schedules`, RLS forçada), as entidades, o mapper e o repositório (`runWithTenant`/`runAsSystem` como o `TypeOrmOutboxRepository`).
- [ ] **Step 4: Run** o integration test e `yarn jest src/infra/database`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(schedule): tabelas e repositório`.

---

### Task 4: `ScheduleService` (criar e gerenciar)

**Files:**
- Create: `api/src/modules/invoice-schedule/application/schedule.service.ts`
- Create: `api/src/modules/invoice-schedule/invoice-schedule.module.ts` (importa `InvoiceModule`, `ConfigModule`; exporta o serviço)
- Modify: `api/src/modules/invoice/invoice.module.ts` (exportar `InvoiceLifecycleService` se ainda não exporta)
- Test: `api/src/modules/invoice-schedule/application/schedule.service.spec.ts`

**Interfaces:**
- Consumes: Tasks 2-3; `InvoiceService.prepareEmissionInEnvironment(dto, tenantId, environment, key?)`; `OutboxConfig.scheduleMaxDays`.
- Produces:
  - `class ScheduleService` com
    - `createFromEmission(dto: CreateInvoiceDto, tenantId: string, authContext: AuthContext): Promise<InvoiceSchedule>` (`type` `SCHEDULE` → `once`; `RECURRING` → `recurring`; `competenceDate` vira `firstOn`)
    - `get(id, tenantId)`, `list(tenantId, filter, page)`, `runs(id, tenantId, page)`
    - `update(id, tenantId, patch)`, `pause(id, tenantId)`, `resume(id, tenantId)`, `cancel(id, tenantId)`
  - Erros mapeáveis para HTTP: `ScheduleNotFoundError` (404), `ScheduleValidationError`/`ScheduleStateError` (422), `ScheduleLimitError` (422, `ERROR_SCHEDULE_LIMIT`, teto de 200).

- [ ] **Step 1: Write the failing tests**: criar `once`/`recurring` valida o corpo da nota chamando `prepareEmissionInEnvironment` com `competenceDate = hoje` e `type` imediato (a validação fiscal é a mesma de uma nota normal) e guarda em `invoiceInput` o corpo **sem** `competenceDate` nem `options.type`/`recurrence`; empresa inexistente/dado fiscal inválido propaga o erro da validação; 201ª agenda ativa → `ScheduleLimitError`; `get` de outro tenant → `ScheduleNotFoundError`; `pause`/`resume`/`cancel` persistem; `update` só dos dados da nota não mexe em `next_run_on`.
- [ ] **Step 2: Run** `yarn jest src/modules/invoice-schedule/application/schedule.service.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** o serviço e o módulo; registrar o módulo em `app.module.ts`.
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(schedule): serviço de agendas`.

---

### Task 5: `ScheduleRunner` e o cron

**Files:**
- Create: `api/src/modules/invoice-schedule/application/schedule-runner.service.ts`, `api/src/modules/invoice-schedule/jobs/schedule.cron.ts`
- Test: `api/src/modules/invoice-schedule/application/schedule-runner.service.spec.ts`, `api/src/modules/invoice-schedule/application/schedule-runner.concurrency.spec.ts`

**Interfaces:**
- Consumes: Tasks 1-4; `InvoiceService.prepareEmissionInEnvironment`; `InvoiceLifecycleService.submitBatch(tenantId, entries): Promise<BatchSubmitOutcome[]>` (recusa item a item sem gravar; erro inesperado aborta o lote).
- Produces:
  - `class ScheduleRunner { runDue(today: string): Promise<{ issued: number; failed: number; paused: number }> }`
  - `interface ScheduleFailureNotifier { retryNotice(tenantId: string, items: FailedScheduleItem[]): Promise<void>; paused(schedule: InvoiceSchedule, reason: string): Promise<void> }` (implementada na Task 6; aqui é só a porta, com um fake nos testes)
  - `class ScheduleCron { @Cron('0 9 * * 1-5', { timeZone: 'America/Sao_Paulo', waitForCompletion: true }) run(): Promise<void> }` (chama `runDue(todayInSaoPaulo())`, captura e loga erro, nunca lança)

Fluxo de `runDue`: `claimDue` numa transação (páginas); agrupa por tenant; para cada tenant monta, por agenda, o `CreateInvoiceDto` = `invoiceInput` + `competenceDate: today` e a chave `schedule:<id>:<occurrenceOn>`; chama `prepareEmissionInEnvironment` (item recusado na preparação = falha) e `submitBatch` para os preparados; aplica `recordIssued`/`recordFailure`, grava `ScheduleRun` (`attempt = attempts + 1` antes de aplicar) e salva a agenda na mesma transação que fez o `claimDue`; no fim notifica (apenas `live`). Replay (`prepared.kind === 'replay'`) conta como emitida e o log aponta para a nota existente.

- [ ] **Step 1: Write the failing tests** (`schedule-runner.service.spec.ts`, fakes do repositório/`InvoiceService`/`submitBatch`/notifier): emitida → `ScheduleRun issued` com `invoiceId`, agenda avança; `once` → `completed`; ocorrência de sábado rodando numa segunda usa competência da segunda; falha de crédito 1ª e 2ª → continua `active`, `retryNotice` chamado **uma vez por tenant** com as agendas; 3ª → `paused` + `paused()` chamado; atraso de duas semanas gera **uma** nota; **Review Focus 4**: crédito para 2 de 3 agendas do tenant → as 2 mais antigas emitem, a 3ª falha; **Review Focus 5**: agenda pausada entre `claimDue` e emissão (conferida dentro da transação) não emite; `test` não chama o notifier.
- [ ] **Step 2: Write the failing concurrency tests** (`schedule-runner.concurrency.spec.ts`, Postgres real como os outros `*.postgres.integration.spec.ts`): **Review Focus 1**: dois `runDue` simultâneos para a mesma agenda produzem **uma** nota; **Review Focus 2**: simular falha entre `submitBatch` e o salvamento da agenda e rodar de novo → continua **uma** nota e a agenda avança.
- [ ] **Step 3: Run** `yarn jest src/modules/invoice-schedule/application/schedule-runner`. Expected: FAIL.
- [ ] **Step 4: Implement** o runner e o cron; registrar no módulo. Teto de itens por chamada de `submitBatch` = o limite que o `InvoiceBatchService` já usa.
- [ ] **Step 5: Run** os dois specs. Expected: PASS.
- [ ] **Step 6: Commit** `feat(schedule): runner e cron das 09h em dias úteis`.

---

### Task 6: E-mails de falha e de pausa

**Files:**
- Modify: `api/src/infra/external/email/email-template.client.ts` (aliases `'schedule-retry'`, `'schedule-paused'`), `api/src/infra/queues/email-job.types.ts` (tipos `ScheduleRetryEmailJobData`, `SchedulePausedEmailJobData`), `api/src/modules/email/application/email.service.ts` (`enqueueScheduleRetry`, `enqueueSchedulePaused`)
- Modify: `api/src/modules/credits-alerts/credits-low.notifier.ts` (extrair `recipientEmails(tenantId)` para um provider exportado `TenantRecipientsService`, reusado aqui)
- Create: `api/src/modules/invoice-schedule/application/schedule-failure.notifier.ts`
- Test: `api/src/modules/email/application/email.service.spec.ts` (casos novos), `api/src/modules/invoice-schedule/application/schedule-failure.notifier.spec.ts`, `credits-low.notifier.spec.ts` (continua verde)

**Interfaces:**
- Consumes: Task 5 (`ScheduleFailureNotifier`).
- Produces:
  - `EmailService.enqueueScheduleRetry(input: { to: string; items: { companyName: string; amount: string; reason: string }[]; billingUrl: string; schedulesUrl: string }): Promise<void>`
  - `EmailService.enqueueSchedulePaused(input: { to: string; companyName: string; reason: string; scheduleUrl: string }): Promise<void>`
  - `TenantRecipientsService.emailsFor(tenantId: string): Promise<string[]>`

- [ ] **Step 1: Write the failing tests**: `retryNotice` envia 1 e-mail por destinatário com **todas** as agendas do dia do tenant; `paused` envia 1 por agenda; sem destinatários só loga; texto traz motivo e links para Cobrança e Agendas; o notifier do crédito baixo continua com o mesmo comportamento depois da extração.
- [ ] **Step 2: Run** `yarn jest src/modules/email src/modules/credits-alerts src/modules/invoice-schedule/application/schedule-failure`. Expected: FAIL.
- [ ] **Step 3: Implement** os métodos, os tipos de job e o notifier; ligar o notifier ao runner no módulo. Os templates `schedule-retry`/`schedule-paused` precisam existir no provedor de e-mail (anotar na descrição do PR; o código usa o alias, como `credits-low`).
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(schedule): e-mails de falha e de pausa`.

---

### Task 7: HTTP: contrato estendido e rotas de gestão

**Files:**
- Modify: `api/src/modules/invoice/http/invoice.dto.ts` (`InvoiceEmissionType` ganha `'RECURRING'`; `InvoiceOptionsDto.recurrence?: RecurrenceOptionsDto` com `frequency` e `endsOn`)
- Create: `api/src/modules/invoice-schedule/application/emission-router.service.ts`, `http/schedule.controller.ts`, `http/schedule.dto.ts`
- Modify: `api/src/modules/invoice/http/invoice.controller.ts` (`emit` chama o roteador)
- Modify: `api/src/shared/http/api-error.ts` (mapear os erros novos)
- Test: `api/src/modules/invoice-schedule/application/emission-router.service.spec.ts`, `api/src/modules/invoice-schedule/http/schedule.controller.spec.ts`, `api/test/invoice-schedules.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces:
  - `EmissionRouterService.emit(dto: CreateInvoiceDto, tenantId: string, authContext: AuthContext, idempotencyKey?: string): Promise<{ kind: 'invoice'; invoice: Invoice } | { kind: 'schedule'; schedule: InvoiceSchedule }>`; `IMMEDIATE` (ou sem `type`) segue para `InvoiceService.emit`, `SCHEDULE`/`RECURRING` para `ScheduleService.createFromEmission`; `recurrence` com `type` diferente de `RECURRING` e `RECURRING` sem `recurrence.frequency` são erros de validação.
  - Resposta da agenda: `ScheduleResponseDto` = `{ id, kind, frequency, status, pause_reason, company_id, next_run_on, ends_on, attempts, last_run_on, created_at }` (snake_case como o resto da API).
  - Rotas (todas com `@ApiKeyEndpoint()`): `GET /v1/schedules`, `GET /v1/schedules/:id`, `GET /v1/schedules/:id/runs`, `PATCH /v1/schedules/:id`, `POST /v1/schedules/:id/pause|resume|cancel`.

- [ ] **Step 1: Write the failing tests**: roteador (os três tipos; validação de `recurrence`); controller (permissões `nfse.invoices.issue`/`view`, paginação, 404 de outro tenant); e2e: `POST /v1/invoices` com `SCHEDULE` e com `RECURRING` devolve 202 com `data.id` de agenda, `IMMEDIATE` continua devolvendo a nota (regressão), e pausar/retomar/cancelar funcionam; **regressão do legado**: uma nota já agendada pelo caminho antigo (outbox com `available_at` futuro) continua sendo liberada (os testes existentes de `outbox-relay` e `invoice-lifecycle` seguem verdes).
- [ ] **Step 2: Run** `yarn jest src/modules/invoice-schedule/http src/modules/invoice-schedule/application/emission-router && yarn test:e2e --testPathPattern invoice-schedules`. Expected: FAIL.
- [ ] **Step 3: Implement** DTOs, roteador, controllers, mapeamento de erros e a documentação OpenAPI dos campos novos.
- [ ] **Step 4: Run** os mesmos comandos mais `yarn jest src/modules/invoice`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(schedule): SCHEDULE e RECURRING em POST /invoices e rotas de gestão`.

---

### Task 8: MCP

**Files:**
- Modify: `api/src/modules/mcp/dto/tool-input.dto.ts` (`emission_type` aceita `RECURRING`; `recurrence_frequency`, `recurrence_ends_on`), `api/src/modules/mcp/tools/nfse-issue.tool.ts` (propriedades, descrições e mapeamento para `options.recurrence`; o handler passa a usar o `EmissionRouterService` e devolve a agenda quando for o caso), `api/src/modules/mcp/mcp.service.ts`
- Create: `api/src/modules/mcp/tools/schedule-{list,get,update,pause,resume,cancel,runs}.tool.ts` (+ `.spec.ts` de cada)
- Test: `nfse-issue.tool.spec.ts` (casos novos), `mcp.server.spec.ts`/`test/mcp-tools.e2e-spec.ts` (lista de tools)

**Interfaces:**
- Consumes: Tasks 4 e 7.
- Produces: tools `schedule_list`, `schedule_get`, `schedule_update`, `schedule_pause`, `schedule_resume`, `schedule_cancel`, `schedule_runs` (leitura com `nfse:read`, as demais com `nfse:write`; entrada e saída em snake_case); `nfse_issue_batch` continua só imediato (rejeita `SCHEDULE`/`RECURRING` com erro claro).

- [ ] **Step 1: Write the failing tests**: `nfse_issue` com `emission_type: 'RECURRING'` + `recurrence_frequency` monta `options.recurrence` e devolve a agenda; frequência ausente → erro de entrada; cada tool de gestão valida o `id` UUID, exige o escopo certo e devolve a agenda/lista; `nfse_issue_batch` com `RECURRING` é recusado; `tools/list` inclui as 7 tools novas.
- [ ] **Step 2: Run** `yarn jest src/modules/mcp`. Expected: FAIL.
- [ ] **Step 3: Implement** os DTOs, as tools e o registro em `McpService.registerTools`.
- [ ] **Step 4: Run** `yarn jest src/modules/mcp`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcp): recorrências e agendas`.

---

### Task 9: Painel: cliente, proxy e lista

**Files:**
- Modify: `web/lib/types.ts` (`InvoiceSchedule`, `ScheduleRun`), `web/lib/api.ts` (`schedules.list/get/runs/update/pause/resume/cancel`, `invoices.createSchedule`), `web/app/api/proxy/[...path]/route.ts` (allowlist de `schedules/...`), `web/components/dashboard/sidebar.tsx` (item "Agendadas e recorrentes" → `/app/schedules`, permissão `nfse.invoices.view`), `web/messages/pt.json` e `en.json`
- Create: `web/app/(dashboard)/app/schedules/page.tsx`, `web/components/schedules/schedule-list.tsx`
- Test: `web/tests/schedules-page.test.tsx`, `web/tests/proxy.test.ts` (casos), `web/tests/api.test.ts` (casos)

**Interfaces:**
- Consumes: rotas da Task 7.
- Produces: tela com lista (empresa, valor, frequência, próxima execução, prazo, status e tentativas), ações pausar/retomar/cancelar (somente com `nfse.invoices.issue`), estado vazio, erro de carga e o motivo da pausa.

- [ ] **Step 1: Write the failing tests**: lista renderiza as colunas e o estado; "Pausar" chama `schedules.pause` e atualiza; "Cancelar" pede confirmação; sem permissão não há botões; erro de carga mostra mensagem; o proxy permite as rotas novas e nega outras; `api.test.ts` cobre os novos métodos.
- [ ] **Step 2: Run** `cd web && yarn vitest run tests/schedules-page.test.tsx tests/proxy.test.ts tests/api.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** tipos, cliente, allowlist, sidebar, página e mensagens pt/en (seguindo o kit e os tokens atuais; usar a skill `antiwebslop` na revisão visual).
- [ ] **Step 4: Run** os mesmos comandos, `yarn typecheck`, `yarn lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): tela de agendadas e recorrentes`.

---

### Task 10: Painel: criar, editar e ver o log

**Files:**
- Create: `web/components/schedules/schedule-form.tsx`, `web/components/schedules/schedule-runs.tsx`
- Modify: `web/app/(dashboard)/app/schedules/page.tsx`, `web/messages/pt.json`, `en.json`
- Test: `web/tests/schedule-form.test.tsx`, `web/tests/schedule-runs.test.tsx`

**Interfaces:**
- Consumes: Task 9; `invoices.createSchedule(body)` e `schedules.update(id, patch)`.
- Produces: formulário (empresa, valor, descrição, tomador, e-mail, tipo único/recorrente, frequência semanal/quinzenal/mensal, 1ª data com mínimo = amanhã, prazo opcional) que cria e edita; painel do log por agenda com data, resultado e motivo.

- [ ] **Step 1: Write the failing tests**: tipo "único" esconde frequência e prazo; 1ª data não aceita hoje; criar envia `options.type` e `recurrence` corretos; editar só envia o que mudou; erro 422 da API aparece inline; o log lista tentativas e aponta para a nota emitida.
- [ ] **Step 2: Run** `cd web && yarn vitest run tests/schedule-form.test.tsx tests/schedule-runs.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** os componentes e ligar à página (diálogo para criar/editar, gaveta ou linha expansível para o log).
- [ ] **Step 4: Run** os testes, `yarn typecheck`, `yarn lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): criar, editar e ver log das agendas`.

---

### Task 11: Documentação e fechamento

**Files:**
- Modify: `web/lib/docs/content/pt.ts` e `en.ts` (`options.type` com `RECURRING`, `recurrence`, resposta 202 da agenda, rotas `/schedules`, tools MCP novas, regra de dias úteis e das 3 falhas, a mudança de contrato do `SCHEDULE`), `api/llms.txt`/`web/public/llms*.txt` se listarem a API, `api/FRONTEND_API.md`, `api/src/modules/invoice/http/invoice.dto.ts` (descrição do `SCHEDULE`)
- Test: testes de docs existentes (`web/tests/docs-*.test.ts`) devem continuar como estão (as 30 falhas de `docs-integrations.test.ts` são anteriores a este trabalho)

- [ ] **Step 1: Write the failing test**: um teste em `web/tests/docs-schedules.test.ts` que garante que as páginas pt e en citam `RECURRING`, `recurrence.frequency`, `/v1/schedules` e as 3 tentativas.
- [ ] **Step 2: Run** `cd web && yarn vitest run tests/docs-schedules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** os textos.
- [ ] **Step 4: Run** a suíte completa: `cd api && yarn typecheck && yarn jest && yarn test:e2e`; `cd web && yarn typecheck && yarn lint && yarn vitest run`. Expected: tudo verde, exceto as 30 falhas conhecidas de `docs-integrations.test.ts`. Relatar qualquer outra falha pelo nome.
- [ ] **Step 5: Commit** `docs: recorrentes e agendadas` e abrir o PR (descrever a mudança de contrato do `SCHEDULE`, os templates de e-mail `schedule-retry`/`schedule-paused` a criar no provedor, e rodar `yarn migration:run`).
