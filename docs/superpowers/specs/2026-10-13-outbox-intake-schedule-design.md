# Spec 1 — Outbox na entrada + `SCHEDULE`

Data: 2026-10-13 · Status: rascunho para revisão (v2) · Escopo: `api/` (NestJS + TypeORM + BullMQ)

Primeiro de uma série de specs da FiscalEngine da Corvo; a decomposição está na seção 11.

## 1. Objetivo

Trocar o enfileiramento direto da **entrada** do pipeline por um **transactional outbox**: o `POST /v1/invoices` salva invoice e mensagem na mesma transação, e um relay publica a mensagem na fila BullMQ existente. Adicionar `options.type = SCHEDULE`, que permite `competenceDate` futura: a mensagem só é liberada na data.

**Depois da entrada nada muda:** `nfse-emission`, `nfse-doc-prep`, `nfse-email` e `nfse-reconciliation` continuam enfileirados por `queues.add` como hoje, com os mesmos processors.

O spec também cria o ponto de extensão onde o Spec 2 encaixa a FiscalEngine. Aqui, o handler de `invoice.emit` só publica no `nfse-emission`.

## 2. Entendimento acordado

Dito pelo usuário:
- O `POST` persiste invoice + outbox; a outbox dispara o processamento e publica na fila; o restante segue como hoje (emitir → PDF/XML → e-mail).
- A outbox é **só a entrada**.
- `options.type = SCHEDULE` aceita `competenceDate` futura; o relay só pega mensagens `pending` cuja data chegou.
- A parte de `queued` do `DocsRecoveryScheduler` passa para a outbox; a recuperação do meio do pipeline permanece.
- Erros fiscais reusam `rejected`/`failed` (relevante no Spec 2).
- Não há produção: **sem backfill**.

Premissas minhas (revisar):
- Reserva de crédito `live` no **agendamento**, na mesma transação.
- Liberação às **00:00 de `competenceDate` em America/Sao_Paulo**.
- Horizonte máximo configurável, padrão 15 dias.
- Cancelar invoice agendada fica fora do escopo.

## 3. Fora de escopo

FiscalEngine, perfil fiscal, RTC, DPS IBS/CBS, conciliação, preview, cancelamento de agendamento, mudanças em `NfseWorkflowService` e nos processors, `WebhookOutboxService`, novos status de invoice.

## 4. Situação atual (verificada)

- `InvoiceService.emit()` valida, cria a invoice, chama `InvoiceLifecycleService.submit()` (invoice + evento + reserva de crédito numa transação) e **depois**, fora da transação, `queueService.add('nfse-emission', …, {idempotencyKey: 'emission-{id}'})` via `enqueueEmission`. O mesmo `enqueueEmission` roda nos replays idempotentes e na corrida `23505`. Se o processo cair entre a transação e o `add`, a invoice fica `queued` sem job.
- `DocsRecoveryScheduler` (`@Cron('*/5 * * * *')`) cobre esse buraco reenfileirando `queued` parada >5 min, e também `processing`/`reconciliation_required` e `authorized` sem documentos.
- `InvoiceDomainService.normalizeAndValidate` rejeita `competenceDate` futura (`future_date`).
- Processors já são idempotentes por status e usam lock Redis por invoice.
- `POST /v1/invoices` responde `202`.
- Há RLS por tenant (`infra/database/rls-tables.ts`), `runAsSystem`, `TenantWorkDiscovery` e specs `*.postgres.integration.spec.ts`; migrations no schema `corvo`.

**Bug latente que o SCHEDULE exporia:** uma invoice agendada ficaria `queued` por dias e o scheduler a emitiria cedo. Por isso a recuperação de `queued` precisa sair do scheduler.

## 5. Arquitetura

```
POST /v1/invoices ─▶ InvoiceDomainService (valida/normaliza, regra SCHEDULE)
        │
        ▼  UMA transação
  nfse_invoices + nfse_invoice_events + reserva de crédito + outbox_messages(invoice.emit)
        │
        ▼
  OutboxRelay (worker) ─ claim SKIP LOCKED ─▶ OutboxHandler[type] ─▶ BullMQ 'nfse-emission'
        │                                                              (jobId 'emission-{id}')
        ▼ marca completed ao publicar
                                      daqui em diante: pipeline atual, sem mudanças
```

Camadas (padrão `domain/application/infra/jobs` do módulo `invoice`):
- **Domínio**: regras de `SCHEDULE` e `scheduledFor`; tipo `OutboxMessage`; port `IOutboxRepository`.
- **Aplicação**: `OutboxService.enqueue` (aceita a transação em curso), `OutboxRelay`, `OutboxHandler` por `type`.
- **Infra**: `OutboxMessageOrmEntity`, `TypeOrmOutboxRepository`, publicação via `BullmqQueueService`.

A outbox pertence ao domínio de invoice: tipos e contrato em `modules/invoice/domain`, service, registry, relay e handlers em `modules/invoice/application`, repositório e entidade em `modules/invoice/infra`, métricas em `modules/invoice/observability`. O `InvoiceModule` registra service, registry, repositório e entidade; apenas o `WorkerAppModule` registra o relay como provider. Correção de arquitetura solicitada pelo usuário: sem módulo genérico separado.

## 6. Modelo de dados

### 6.1 `corvo.outbox_messages`

| coluna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid | RLS; FK para tenants |
| environment | text | `test`/`live`, CHECK |
| type | text | `invoice.emit` (Spec 2 acrescenta `invoice.calculate_taxes`) |
| aggregate_id | uuid | id da invoice |
| payload | jsonb | `{invoiceId, companyId, tenantId}` |
| dedupe_key | text | `emission:{invoiceId}` |
| status | text | `pending` → `claimed` → `completed` ou `dead` |
| available_at | timestamptz | futuro para `SCHEDULE` e para backoff de publicação |
| lease_until | timestamptz null | só protege o claim contra crash do relay |
| attempts | int | tentativas de publicação |
| last_error | text null | |
| created_at, updated_at, completed_at | timestamptz | |

Índices: `UNIQUE (tenant_id, dedupe_key)`; parcial `(available_at)` onde `status = 'pending'`; parcial `(lease_until)` onde `status = 'claimed'`; `(tenant_id, aggregate_id)`. A tabela entra em `TENANT_RLS_TABLES` com as mesmas policies.

### 6.2 `nfse_invoices`

Coluna nullable `scheduled_for timestamptz`. `status` continua `queued` para agendadas; nenhum status novo.

## 7. Comportamento

### 7.1 Intake

1. `CreateInvoiceDto.options.type?: 'IMMEDIATE' | 'SCHEDULE'` (padrão `IMMEDIATE`), validado com `@IsIn`.
2. `normalizeAndValidate` recebe o tipo:
   - `IMMEDIATE`: regra atual (`future_date`).
   - `SCHEDULE` com data futura: aceita; `scheduledFor` = 00:00 America/Sao_Paulo do dia; `schedule_horizon_exceeded` (422) se passar do horizonte (`OUTBOX_SCHEDULE_MAX_DAYS`, padrão 15).
   - `SCHEDULE` com data hoje ou passada: tratada como imediata.
3. `Invoice.create` recebe `scheduledFor?`; a regra mora no domínio.
4. `InvoiceLifecycleService.submit()` insere também a mensagem `invoice.emit` (`available_at` = agora ou `scheduledFor`) na mesma transação, depois da reserva de crédito.
5. `emit()` deixa de chamar `enqueueEmission`: o replay idempotente e a corrida `23505` apenas retornam a invoice existente (a mensagem original já garante a entrega).
6. Resposta `202` com campo aditivo `scheduledFor` (ISO ou `null`).

### 7.2 Relay

- Roda só no worker (`main.worker.ts`), com `@Interval` curto (padrão 2 s, configurável).
- A cada ciclo, em `runAsSystem('outbox-relay')`:
  1. **Claim**: até N mensagens com `status = 'pending' AND available_at <= now()` **ou** `status = 'claimed' AND lease_until < now()`, `FOR UPDATE SKIP LOCKED`; atualiza para `claimed` com `lease_until = now() + lease` e `attempts + 1`.
  2. **Publish**: `OutboxHandler` do `type`, sob o escopo do tenant, chama `BullmqQueueService.add` com o **mesmo `jobId` de hoje** (`emission-{id}`); republicar nunca duplica o job.
  3. Sucesso: `completed`. Falha: `last_error` e volta a `pending` com backoff em `available_at`.
- `attempts >= OUTBOX_MAX_ATTEMPTS` → `dead`, log, métrica e Sentry; sem transição automática da invoice.
- O ack é **o handler concluir**: neste spec, publicar no BullMQ; no Spec 2, rodar a FiscalEngine e gravar a próxima mensagem. Dali em diante, a durabilidade é da fila e a rede de segurança é o scheduler reduzido (7.3).

### 7.3 `DocsRecoveryScheduler` reduzido

- **Remove** a recuperação de `status = 'queued'` (agora da outbox; também evita emitir invoice agendada antes da data).
- **Mantém**: `processing` e `reconciliation_required` (reenfileirar `nfse-reconciliation`) e `authorized` sem documentos (`nfse-doc-prep`), como hoje.
- Ajusta `TenantWorkDiscovery('invoice-recovery')` e a query para não incluir `queued`.
- Atualiza o spec existente do scheduler.

### 7.4 Pipeline posterior

`NfseWorkflowService`, `NfseEmissionProcessor`, `NfseDocPrepProcessor`, `NfseEmailProcessor`, `nfse-reconciliation` e `InvoiceService.requestEmail` **não mudam**.

### 7.5 Extensão para o Spec 2

`OutboxHandler` é registrado por `type`. O Spec 2 adiciona `invoice.calculate_taxes`: com a flag ligada, `submit()` grava essa mensagem em vez de `invoice.emit`; o handler roda a FiscalEngine e, em sucesso, grava o snapshot e a mensagem `invoice.emit` na mesma transação. Nada deste spec precisa mudar.

## 8. Erros e contrato

- `422 schedule_horizon_exceeded` (campo `competenceDate`), no formato de `FiscalValidationError`.
- `future_date` permanece para `IMMEDIATE`.
- Contrato só ganha `options.type` (entrada) e `scheduledFor` (saída). Swagger, `FRONTEND_API.md` e `llms.txt` atualizados.
- `GET /v1/invoices?status=queued` continua listando agendadas; o cliente distingue por `scheduledFor`.

## 9. Observabilidade

Métricas: `outbox_pending_oldest_age_seconds`, `outbox_published_total{type}`, `outbox_publish_failures_total{type}`, `outbox_dead_total{type}`, `outbox_claim_to_publish_duration`. Logs estruturados com `invoiceId`, `tenantId`, `type`, `attempts`; sem dados fiscais sensíveis.

## 10. Testes

- **Domínio (unit):** `normalizeAndValidate` com `IMMEDIATE`/`SCHEDULE` (hoje, passada, futura, além do horizonte); `scheduledFor` na virada de dia em America/Sao_Paulo; `Invoice.create` com agendamento.
- **Outbox (Postgres):** dois relays concorrentes não publicam a mesma mensagem; mensagem futura não é liberada antes da hora; `claimed` com lease expirado é reassumido; `dedupe_key` única por tenant; `dead` após o limite; RLS impede leitura entre tenants; falha ao publicar volta a `pending` com backoff.
- **Atomicidade:** falha ao gravar a outbox desfaz invoice, evento e reserva de crédito.
- **Aplicação:** `emit()` não chama `queues.add`; replay idempotente e `23505` não enfileiram; o job publicado tem o `jobId` esperado.
- **Scheduler:** não reenfileira `queued`; continua recuperando `processing`, `reconciliation_required` e `authorized` sem documentos; invoice agendada não é emitida antes de `scheduledFor`.
- **Regressão:** specs atuais de invoice, módulo e scheduler ajustados; fluxo ponta a ponta com `NfseClientFake` e relay real contra Postgres.
- Nenhum teste emite em produção.

## 11. Roadmap dos próximos specs

- **Spec 2 — Núcleo da FiscalEngine:** pipeline (Result, Strategy, Specification) no domínio de `invoice`, perfil fiscal com vigência, catálogo de serviços, política de transição, ISS e retenções, snapshot. Detalhes em `2026-10-13-fiscal-engine-core-design.md`.
- **Spec 3 — RTC real e DPS:** adapter da Calculadora, DpsBuilder, `emitirDpsPronta`, conciliação.
- **Spec 4 — Preview e documentação.**

## 12. Riscos e pontos em aberto

- **Reserva longa de crédito** em agendamentos distantes pode cruzar períodos de billing; mitigado só pelo horizonte máximo. Alternativa (reservar na liberação) fica para decisão futura.
- **Dependência do relay:** relay parado = entrada parada. Mitigação: métrica da idade da mensagem `pending` mais antiga e alerta.
- **`dead`** exige ação operacional.
- **Jobs perdidos após a publicação** (ex.: Redis zerado) podem deixar a invoice em `queued`; o scheduler reduzido não recupera `queued`, e a outbox concluída não republica automaticamente. Recuperação operacional exige ação explícita.
- **Valores padrão** (intervalo do relay 2 s, lote, lease, `OUTBOX_MAX_ATTEMPTS`) definidos no plano, em `env.schema.ts`.
- **Rollback:** reverter o deploy; linhas da outbox ficam inertes sem o relay. Sem produção, não há dado legado a migrar.
