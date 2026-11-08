# Arquitetura do Corvo

Como uma NFS-e anda pelo sistema: do pedido na API até a autorização no portal nacional, passando pela outbox, pelos créditos e pelas filas. Para cada passo, diz o que é gravado **junto** na mesma transação e o que acontece se algo falhar no meio.

Este documento descreve a `main`. Os nomes de arquivo apontam para `api/src`.

## Sumário

- [Visão geral](#visão-geral)
- [Caminho de uma nota](#caminho-de-uma-nota)
- [Outbox](#outbox)
- [Créditos: franquia e ledger](#créditos-franquia-e-ledger)
- [Atomicidade: o que é gravado junto](#atomicidade-o-que-é-gravado-junto)
- [Status da nota](#status-da-nota)
- [Filas e rotinas do worker](#filas-e-rotinas-do-worker)
- [Isolamento entre clientes (RLS)](#isolamento-entre-clientes-rls)
- [Garantias e lacunas](#garantias-e-lacunas)
- [Onde está no código](#onde-está-no-código)

## Visão geral

São dois processos com o mesmo código: a **API**, que recebe pedidos e responde rápido, e o **worker**, que faz o trabalho demorado. Eles só conversam pelo banco (outbox) e pelo Redis (filas BullMQ).

```mermaid
flowchart LR
  client["Seu app / ERP / agente de IA"] -->|"REST (X-API-Key) ou MCP"| api

  subgraph corvo["Corvo"]
    api["API (NestJS)<br/>valida, reserva crédito,<br/>grava a nota e responde 202"]
    worker["Worker (NestJS)<br/>outbox relay, filas BullMQ,<br/>rotinas agendadas"]
  end

  subgraph dados["Dados"]
    pg[("PostgreSQL<br/>notas, eventos, outbox,<br/>créditos, franquia")]
    redis[("Redis<br/>filas BullMQ, locks, cache")]
    s3[("S3<br/>XML e PDF")]
  end

  api --> pg
  api --> redis
  worker --> pg
  worker --> redis
  worker --> s3
  worker -->|"DPS assinada"| sefin["Portal nacional NFS-e (Sefin)"]
  worker -->|"cálculo IBS/CBS"| rtc["Calculadora RTC"]
  worker -->|"webhooks assinados (HMAC)"| client
  worker -->|"e-mail com PDF"| customer["Cliente final"]
```

A API nunca fala com o portal. Ela grava a nota com uma mensagem na outbox na mesma transação e responde `202`. Todo o resto é do worker.

## Caminho de uma nota

```mermaid
flowchart TD
  req["POST /v1/invoices"] --> tx1

  subgraph tx1["Transação 1: entrada (API)"]
    direction TB
    a1["lock do cliente<br/>pg_advisory_xact_lock('fiscal:tenant')"]
    a2["confere a idempotency key"]
    a3["reserva 1 nota<br/>(franquia ou saldo avulso)"]
    a4["insere a nota em queued + evento"]
    a5["outbox: invoice.calculate-taxes"]
    a1 --> a2 --> a3 --> a4 --> a5
  end

  tx1 -->|"responde 202"| relay1["Outbox relay (worker)"]
  relay1 --> calc["Motor fiscal + calculadora RTC"]
  calc -->|"erro fiscal definitivo"| rej1["queued → rejected<br/>(crédito devolvido)"]
  calc --> tx2

  subgraph tx2["Transação 2: cálculo"]
    direction TB
    b1["grava o snapshot fiscal imutável"]
    b2["outbox: invoice.emit"]
    b1 --> b2
  end

  tx2 --> relay2["Outbox relay"]
  relay2 -->|"jobId emission-{id}"| q1[["Fila nfse-emission"]]
  q1 --> w["NfseWorkflowService<br/>lock nfse:invoice:{id}"]
  w --> dps["reserva o número da DPS<br/>(UPDATE ... RETURNING)"]
  dps --> sefin["Portal nacional"]
  sefin -->|"autorizada"| auth["authorized<br/>XML no S3, crédito confirmado"]
  sefin -->|"recusada"| rej2["rejected<br/>(crédito devolvido)"]
  sefin -->|"sem resposta / incerto"| rec["reconciliation_required"]
  rec --> q2[["Fila nfse-reconciliation<br/>espera 1, 2, 4… até 30 min"]]
  q2 --> w
  rec -->|"5 respostas inconclusivas"| mr["manual_review"]
  auth --> after["depois do commit:<br/>webhook, nfse-doc-prep (PDF, e-mail),<br/>nfse-fiscal-reconcile"]
```

Pontos que valem a revisão:

1. **O cálculo sempre vem antes da emissão.** O `invoice.emit` só é colocado na outbox na mesma transação que grava o snapshot fiscal. Por isso a DPS nunca é montada sem os tributos calculados (`fiscal/calculate-taxes.handler.ts`).
2. **O número da DPS é reservado uma vez.** `payload()` só reserva se a nota ainda não tem número. Ele é guardado na nota antes do envio e reaproveitado em toda nova tentativa (`nfse-workflow.service.ts`, `typeorm-dps-sequence.repository.ts`).
3. **A emissão não sai em dobro.** Antes de enviar, o provedor consulta o portal pela DPS (`fetchDpsStatus`). Se ela já existe, devolve a nota autorizada. A DPS assinada fica em `pending_emission` antes do envio, então uma queda no meio é retomada com o mesmo XML (`infra/external/nfse/open-nfse.provider.ts`).
4. **Uma nota por vez em cada slot.** Emissão e reconciliação usam o mesmo lock no Redis, `nfse:invoice:{id}`, com validade de 5 min.

## Outbox

A outbox garante que "gravar a nota" e "avisar o worker" acontecem juntos: a mensagem é uma linha no mesmo banco, gravada na mesma transação que a mudança.

```mermaid
flowchart LR
  subgraph tx["Transação de quem grava"]
    change["mudança de estado<br/>(nota, snapshot…)"]
    msg["INSERT outbox_messages<br/>ON CONFLICT (tenant_id, dedupe_key) DO NOTHING"]
  end

  tx --> pending[("outbox_messages<br/>status = pending")]

  subgraph relay["OutboxRelay (só no worker), a cada 2 s"]
    claim["claim até 50<br/>FOR UPDATE SKIP LOCKED<br/>status = claimed, lease 120 s, attempts + 1"]
    handle["handler do tipo<br/>(uma mensagem por vez)"]
    claim --> handle
  end

  pending --> claim
  handle -->|"ok"| done["status = completed"]
  handle -->|"erro"| retry["status = pending<br/>available_at = agora + backoff"]
  handle -->|"erro e attempts ≥ 10"| dead["status = dead"]
  retry --> pending
  claimed_lost["worker caiu com a mensagem"] -.->|"lease vencido: volta a ser pega"| claim
```

| Item | Valor | Onde |
| --- | --- | --- |
| Intervalo entre rodadas | 2 s; uma rodada é pulada se a anterior ainda está rodando | `OUTBOX_RELAY_INTERVAL_MS` |
| Mensagens por rodada | até 50, processadas uma por vez | `OUTBOX_BATCH_SIZE` |
| Reserva da mensagem (lease) | 120 s; se o worker cair, outra rodada pega a mensagem depois | `OUTBOX_LEASE_MS` |
| Espera entre tentativas | 2 s, 4 s, 8 s… até 5 min | `outbox-backoff.ts` |
| Tentativas | 10; depois a mensagem fica `dead` | `OUTBOX_MAX_ATTEMPTS` |
| Duplicidade | `dedupe_key` única por cliente (`calc:{id}`, `emission:{id}`) | `typeorm-outbox.repository.ts` |

Tipos de mensagem e o que cada handler faz:

| Tipo | Handler | Faz |
| --- | --- | --- |
| `invoice.calculate-taxes` | `CalculateTaxesHandler` | Roda o motor fiscal. Em sucesso, grava o snapshot e coloca `invoice.emit` na mesma transação. Erro fiscal definitivo rejeita a nota. Erro temporário (por exemplo, a calculadora RTC fora) relança, e a outbox tenta de novo. |
| `invoice.emit` | `InvoiceEmitHandler` | Só coloca o job na fila `nfse-emission` com `jobId = emission-{id}`. Se o job já existe, o BullMQ ignora. |
| `invoice.cancel` | `InvoiceCancelHandler` | Coloca o job na fila `nfse-cancellation`. |

`complete`, `release` e `markDead` só valem se a mensagem ainda está `claimed` com o mesmo número de tentativas. Assim, um worker atrasado não sobrescreve o resultado de outro que pegou a mensagem depois que o lease venceu.

## Créditos: franquia e ledger

Uma nota em `live` gasta crédito. Em `test`, não. O controle tem duas partes que andam juntas:

- **Franquia do plano** (`billing_periods`): contadores do mês, `included`, `reserved` e `authorized`. Limite: `authorized + reserved` não pode passar do teto do plano.
- **Ledger** (`credit_transactions`): um lançamento por movimento, nunca apagado. O saldo avulso é a soma dos lançamentos com `source` igual a `avulso` ou `bonus`.

A franquia paga primeiro. Quando ela acaba (ou o plano venceu), o saldo avulso paga.

```mermaid
flowchart TD
  start["Nota live entra"] --> lock["lock fiscal:tenant"]
  lock --> plan{"Franquia tem espaço?"}
  plan -->|"sim"| p1["billing_period.reserved + 1"]
  plan -->|"não, mas há saldo avulso"| p2["sem mudança na franquia"]
  plan -->|"não e sem saldo"| block["recusa: monthly_limit_exceeded<br/>(aviso aos admins 1x por dia)"]
  p1 --> r1["ledger: -1, reserva<br/>period_id = mês, is_reservation = true"]
  p2 --> r2["ledger: -1, reserva<br/>source = avulso, is_reservation = true"]

  r1 --> wait(("nota em andamento"))
  r2 --> wait

  wait -->|"authorized"| ok["franquia: reserved - 1, authorized + 1<br/>ledger: reserva confirmada<br/>(is_reservation = false)"]
  wait -->|"rejected / failed /<br/>cancelada antes de emitir"| back["franquia: reserved - 1 (liberada)<br/>ledger: +1 estorno (invoice_rejected)<br/>ligado à reserva, e a reserva é confirmada"]
  wait -->|"reconciliation_required /<br/>manual_review"| hold["nada muda:<br/>a reserva continua presa"]
```

| Para onde a nota vai | Franquia | Ledger | Saldo avulso |
| --- | --- | --- | --- |
| `queued` (entrada) | `reserved + 1` se o plano pagou | `-1` reserva | cai 1 se o avulso pagou |
| `authorized` | `reserved - 1`, `authorized + 1` | reserva confirmada | nada muda |
| `rejected`, `failed`, `cancelled` antes de autorizar | `reserved - 1` | `+1` estorno ligado à reserva | volta 1 se o avulso pagou |
| `reconciliation_required`, `manual_review` | nada muda | nada muda | nada muda |
| `cancelled` depois de autorizada | nada muda | nada muda (cancelar uma NFS-e emitida não devolve crédito) | nada muda |

Essas mudanças acontecem dentro da mesma transação da troca de status (`InvoiceLifecycleService.settleCredit`). Por isso não existe nota autorizada com crédito ainda reservado, nem nota rejeitada sem estorno.

## Atomicidade: o que é gravado junto

Cada caixa é uma transação do PostgreSQL. Tudo dentro dela é gravado junto ou nada é gravado.

```mermaid
flowchart TB
  subgraph T1["Entrada da nota: submit e submitBatch (API)"]
    direction LR
    t1a["pg_advisory_xact_lock('fiscal:tenant')"]
    t1b["idempotency key"]
    t1c["franquia: reserved + 1"]
    t1d["ledger: reserva -1"]
    t1e["nota queued + evento"]
    t1f["outbox: calculate-taxes"]
  end

  subgraph T2["Cálculo (worker)"]
    direction LR
    t2a["snapshot fiscal"]
    t2b["outbox: invoice.emit"]
  end

  subgraph T3["Número da DPS (worker)"]
    direction LR
    t3a["UPDATE dps_sequences<br/>SET current_number + 1 RETURNING"]
  end

  subgraph T4["Troca de status: InvoiceLifecycleService.transition (worker e API)"]
    direction LR
    t4a["pg_advisory_xact_lock('fiscal:tenant')"]
    t4b["SELECT nota FOR UPDATE<br/>confere o status de origem"]
    t4c["nota + evento"]
    t4d["outbox opcional"]
    t4e["franquia + ledger<br/>(confirma ou estorna)"]
    t4f["cancelamento pendente<br/>(se já pedido)"]
  end

  T1 --> T2 --> T3 --> sefin(["chamada ao portal<br/>fora de qualquer transação"]) --> T4
  T4 -.->|"depois do commit,<br/>melhor esforço"| after["webhook, cache de saldo,<br/>doc-prep, fiscal-reconcile, aviso"]
```

Como cada regra é garantida:

- **Duas notas do mesmo cliente não furam o limite do plano.** `pg_advisory_xact_lock('fiscal:{tenant}')` faz as reservas e as trocas de status de um cliente acontecerem uma de cada vez. Clientes diferentes não se bloqueiam (`typeorm-billing.repository.ts`, `locked`).
- **Duas trocas de status ao mesmo tempo não se atropelam.** A transição relê a nota com `FOR UPDATE` e só aplica se o status gravado ainda é o de origem esperado. Senão, lança `ConcurrentInvoiceTransitionError` (por exemplo, a nota foi cancelada enquanto o worker emitia).
- **O mesmo pedido não vira duas notas.** A idempotency key é conferida dentro do lock. No lote, uma chave repetida com o mesmo conteúdo devolve a nota existente, e com outro conteúdo devolve `ERROR_IDEMPOTENCY_CONFLICT`.
- **O lote é tudo ou nada para erros inesperados.** `submitBatch` grava todas as notas aceitas numa transação. As recusadas por regra de cobrança ou de chave voltam como erro por item e não gravam nada.
- **A chamada ao portal fica fora das transações.** Ela pode levar segundos, e segurar um lock do banco nesse tempo travaria o cliente. A segurança vem da DPS fixa e da consulta prévia descritas em [Caminho de uma nota](#caminho-de-uma-nota).

## Status da nota

Transições permitidas (`modules/invoice/domain/invoice-status.ts`). Qualquer outra lança `InvalidInvoiceTransitionError`.

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> processing: worker começa a emitir
  queued --> rejected: erro fiscal ou de montagem da DPS
  queued --> cancelled: cancelada antes de emitir
  processing --> authorized: portal autorizou
  processing --> rejected: portal recusou
  processing --> reconciliation_required: sem resposta / incerto
  processing --> retry_pending
  processing --> failed
  retry_pending --> processing
  reconciliation_required --> authorized
  reconciliation_required --> rejected
  reconciliation_required --> manual_review: 5 respostas inconclusivas
  authorized --> cancelling: pedido de cancelamento
  cancelling --> cancelled: evento 101101 aceito
  cancelling --> authorized: cancelamento recusado
  rejected --> [*]
  cancelled --> [*]
  failed --> [*]
  manual_review --> [*]
```

`retry_pending` e `failed` existem no modelo, mas o fluxo atual não leva nenhuma nota para eles. `manual_review` hoje não tem saída: a nota fica parada até alguém agir no banco.

## Filas e rotinas do worker

| Fila ou rotina | Quem coloca | O que faz | Tentativas |
| --- | --- | --- | --- |
| `OutboxRelay` (a cada 2 s) | — | Entrega as mensagens da outbox aos handlers | 10, espera até 5 min |
| `nfse-emission` | `invoice.emit` | Monta, assina e envia a DPS (1 por vez por worker; o PR #175 sobe para 3) | 5, espera de 5 s; esgotou: `queued` vira `rejected` e `processing` vai para reconciliação |
| `nfse-reconciliation` | o próprio workflow | Pergunta de novo ao portal pela mesma DPS | 5 por job; espera de 1 min dobrando até 30 min |
| `nfse-doc-prep` | depois da autorização | Gera o PDF e envia o e-mail | 5, espera de 10 s |
| `nfse-fiscal-reconcile` | depois da autorização | Compara o snapshot calculado com a NFS-e autorizada e registra divergências | 5, espera de 10 s |
| `nfse-cancellation` | `invoice.cancel` | Envia o evento de cancelamento 101101 | — |
| `import-read`, `import-emit` | importação de planilha | Lê as linhas e cria as notas em blocos de 50 | — |
| `docs-recovery` (a cada 5 min) | — | Rede de segurança: reenfileira a reconciliação de notas paradas há mais de 5 min em `processing` ou `reconciliation_required`, e o PDF de notas autorizadas sem documento (até 50 de cada por cliente) | 5 por job |
| Webhooks (a cada 30 s) | `InvoiceWebhookPublisher` grava a entrega como `pending` | Entrega os webhooks assinados (`X-Corvo-Signature: sha256=…`) com timeout de 10 s. A primeira tentativa sai no próximo ciclo, até 30 s depois | 5: 0 s, 60 s, 160 s, 15 min, 30 min |
| `EventProcessorScheduler` (a cada 5 s) | integrações de venda | Ver [docs/integrations/architecture.md](integrations/architecture.md) | — |
| Cobrança (de hora em hora) | — | Reconcilia a cobrança (`billing.reconcile`) | — |

## Isolamento entre clientes (RLS)

As tabelas de cliente têm `tenant_id` e política de Row Level Security. Antes de cada operação, `runWithTenant(tenantId, …)` define `app.current_tenant_id` na conexão (`infra/database/rls-connection-scope.ts`), e o PostgreSQL só devolve as linhas daquele cliente.

O worker precisa enxergar vários clientes, e faz isso de duas formas:

- **Outbox relay:** pega as mensagens de todos os clientes em contexto de sistema (`runAsSystem('outbox-relay')`) e executa cada handler dentro de `runWithTenant` do dono da mensagem.
- **Rotinas agendadas** (`docs-recovery`, entrega de webhooks): `TenantWorkDiscovery.visit` descobre em contexto de sistema quais clientes têm trabalho, de 100 em 100, e executa o trabalho de cada um no contexto dele.

## Garantias e lacunas

O que o sistema garante:

- Uma nota aceita (`202`) sempre tem a reserva de crédito e a mensagem de cálculo gravadas. Não existe nota sem crédito reservado, nem crédito reservado sem nota.
- Uma nota nunca é emitida duas vezes no portal pela mesma DPS.
- Toda troca de status grava junto o evento de auditoria e o efeito no crédito.
- Uma mensagem da outbox ou um job que falha é tentado de novo sozinho. Um worker que cai no meio não perde a mensagem.

O que hoje **não** é atômico (vale revisar):

- **Webhooks e e-mail são colocados na fila depois do commit, em melhor esforço.** Se o processo cair entre a troca de status e o `enqueue` do webhook, a nota fica com o status certo, mas o webhook daquela mudança não é enviado. Não há rotina que reenvie. Para documentos (PDF e e-mail) existe a `docs-recovery`.
- **Os jobs pós-autorização (`nfse-doc-prep`, `nfse-fiscal-reconcile`) também são colocados depois do commit.** A falha é só registrada no log. Para o PDF, a `docs-recovery` cobre; para a reconciliação fiscal, não há rotina de recuperação.
- **`manual_review` não tem saída.** A nota segura a reserva de crédito até alguém resolver no banco. O PR #176 adiciona as ações de tentar de novo e descartar.
- **Um erro de rede na emissão agenda a reconciliação e também relança o erro.** Com isso, o job de emissão é repetido e cada repetição agenda outra reconciliação. Os locks evitam emissão em dobro, mas as filas crescem durante uma queda longa. O PR #176 corrige.
- **A `docs-recovery` coloca mais um job de reconciliação a cada 5 min para toda nota parada em `processing` ou `reconciliation_required`, sem chave de deduplicação.** É ela que retoma uma nota cujo agendamento se perdeu, mas, numa queda longa, cada nota acumula um job novo a cada 5 min além dos que já estão esperando. O lock por nota evita processamento simultâneo; os jobs a mais rodam, não emitem nada novo e somam chamadas ao portal. Um `jobId` fixo por nota resolveria. Isso **não** está no PR #176.

## Onde está no código

| Assunto | Arquivo |
| --- | --- |
| Entrada da nota, reserva e troca de status com crédito | `modules/invoice/application/invoice-lifecycle.service.ts` |
| Lock do cliente (`fiscal:{tenant}`) | `modules/billing/infra/typeorm-billing.repository.ts` |
| Regras da franquia | `modules/billing/domain/billing-period.ts`, `modules/billing/application/billing-usage.service.ts` |
| Ledger de créditos | `modules/credits/infra/typeorm-credit-transaction.repository.ts` |
| Outbox (gravar, pegar, concluir) | `modules/invoice/application/outbox.service.ts`, `modules/invoice/infra/typeorm-outbox.repository.ts` |
| Relay da outbox | `modules/invoice/application/outbox-relay.ts` |
| Cálculo e emissão | `modules/invoice/application/fiscal/calculate-taxes.handler.ts`, `modules/invoice/application/invoice-emit.handler.ts` |
| Workflow de emissão e reconciliação | `modules/invoice/application/nfse-workflow.service.ts` |
| Número da DPS | `modules/invoice/infra/typeorm-dps-sequence.repository.ts` |
| Chamada ao portal | `infra/external/nfse/open-nfse.provider.ts` |
| Status e transições | `modules/invoice/domain/invoice-status.ts` |
| Webhooks | `modules/invoice/application/invoice-webhook.publisher.ts`, `modules/webhooks-config/application/webhook-outbox.service.ts` |
| RLS | `infra/database/rls-connection-scope.ts` |
