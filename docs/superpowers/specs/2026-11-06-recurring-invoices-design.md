# Notas recorrentes e agendadas: desenho

Data: 2026-11-06. Estado: rascunho para aprovação.

## Intenção

Hoje o cliente só consegue agendar **uma** nota para um dia futuro (`options.type = SCHEDULE`). Isso nasce como nota de verdade, reserva o crédito no cadastro e usa o `available_at` da outbox como relógio.

Queremos **notas recorrentes** (semanal, quinzenal, mensal) e queremos que o agendamento avulso e o recorrente vivam no mesmo lugar: uma tabela de cadastro, uma de log, e um cron diário que, nos dias úteis às 09h, transforma o que venceu em notas. A outbox volta a ser só fila.

## Metas

- Criar, listar, alterar, pausar, retomar e cancelar recorrências, pela **API, pelo painel e pelo MCP** (tudo que a API faz, o MCP faz).
- Rodar todas as execuções às **09h de Brasília, de segunda a sexta**.
- Nunca emitir duas notas para a mesma ocorrência, mesmo se o cron cair no meio ou rodar em duas instâncias.
- Avisar o cliente por e-mail quando não conseguir emitir, e pausar sozinho depois da 3ª falha.

## Fora de escopo

- Feriados (só sábado e domingo contam como não úteis).
- Mudar qualquer regra de emissão fiscal: cálculo, montagem da DPS, envio, `dhEmi`.
- Recorrência por cartão ou cobrança do cliente final da nota. É só a emissão da nota fiscal.
- Frequências além de semanal, quinzenal e mensal.

## Anti-metas

- Nota presa na fila com `dhEmi` velho depois de uma falha de crédito.
- Cron que emite nota em duplicidade.
- E-mail todo dia, para sempre.

## Regras decididas (pelo Pedro)

1. Frequências: **semanal, quinzenal, mensal**.
2. Execução às **09h America/Sao_Paulo, segunda a sexta**. O cron só roda nesses dias.
3. Ocorrência que cai em sábado ou domingo **roda na segunda** (ela fica "vencida" e o cron de segunda a pega).
4. Tem **prazo opcional**. Sem prazo, roda até o cliente pausar ou cancelar. Com prazo, encerra ao passar dele.
5. Se a execução das 09h **não consegue emitir** (ex.: sem crédito):
   - tentativas 1 e 2: a recorrência fica para o dia útil seguinte, 09h, e o cliente recebe e-mail "você tem uma nota para rodar, mas está sem crédito; tentamos de novo amanhã; recarregue ou pause";
   - tentativa 3 sem sucesso: a recorrência é **pausada** e o cliente recebe outro e-mail avisando que foi pausada.
6. O cron **escreve em lote** na outbox. A outbox deixa de ser agenda.
7. Tudo que existe na API existe no **MCP** (criar, listar, ver, alterar, pausar, retomar, cancelar, ver log).
8. **A regra de emissão não muda.** O conserto do PR #119 (`dpsIssuedAt = scheduledFor ?? createdAt`) fica intacto.

## Como encaixa na emissão (sem mexer nela)

A nota recorrente nasce **às 09h do dia da execução**, com competência igual a esse dia. Ela passa pelo mesmo caminho de uma nota normal (`prepareEmission` → `InvoiceLifecycleService.submitBatch` → outbox `INVOICE_CALCULATE_TAXES`). Como a competência nunca fica depois do momento de criação, a regra do `dhEmi` (Sefin E0015) é respeitada sem `scheduledFor`. `dpsIssuedAt` e o resto de `nfse-workflow.service.ts` não mudam.

`submitBatch` já recusa uma nota por falta de crédito **sem gravar nada**. Esse é o gancho da falha: nenhuma nota fica presa, só vira uma tentativa no log.

Chave de idempotência da execução: `schedule:<schedule_id>:<occurrence_on>`. Um replay devolve a nota já criada, e a execução conta como emitida.

## Modelo de dados

Duas tabelas novas, ambas com `tenant_id`, `environment`, RLS forçada e a mesma política das demais (`app.current_tenant_id` ou `app.system_context`).

### `invoice_schedules` (o cadastro)

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id`, `environment` | | `test` ou `live` |
| `company_id` | uuid | empresa emissora |
| `kind` | `once` \| `recurring` | `once` é o agendamento avulso de hoje |
| `frequency` | `weekly` \| `biweekly` \| `monthly` \| null | null quando `once` |
| `anchor_on` | date | data da 1ª ocorrência; dia de referência da contagem |
| `ends_on` | date \| null | prazo opcional (inclusivo) |
| `invoice_input` | jsonb | o corpo da nota (valor, serviço, tomador, e-mail...) **sem** `competenceDate` nem `options` |
| `status` | `active` \| `paused` \| `completed` \| `cancelled` | |
| `pause_reason` | `customer` \| `failures` \| null | |
| `occurrence_index` | int | índice da ocorrência pendente, para contar a partir de `anchor_on` sem "escorregar" |
| `next_run_on` | date \| null | ocorrência pendente (pode ser sábado ou domingo). null quando não ativa |
| `attempts` | int | falhas seguidas da ocorrência pendente (0 a 3) |
| `last_run_on` | date \| null | |
| `created_by`, `created_at`, `updated_at` | | |

Índice parcial em `(next_run_on) WHERE status = 'active'` para o cron.

### `invoice_schedule_runs` (o log)

Uma linha por tentativa: `id`, `tenant_id`, `schedule_id`, `occurrence_on` (a data vencida), `ran_on` (o dia em que rodou), `attempt` (1 a 3), `outcome` (`issued` \| `failed`), `invoice_id` (quando emitiu), `error_code`, `error_message`, `created_at`. Único em `(schedule_id, occurrence_on, attempt)`.

## O cron

`@Cron('0 9 * * 1-5', { timeZone: 'America/Sao_Paulo', waitForCompletion: true })`.

1. Seleciona as agendas `active` com `next_run_on <= hoje (São Paulo)`, em páginas, agrupando por tenant.
2. Por tenant, monta os itens e chama o lote (`submitBatch`), uma transação e um lock de billing por tenant.
3. Para cada item:
   - **emitida**: grava log `issued`, `attempts = 0`. Se `once` ou se a próxima ocorrência passa de `ends_on`, vira `completed`. Senão `next_run_on` = a **primeira ocorrência estritamente depois de hoje** (não recupera ocorrências perdidas: uma nota só por execução, mesmo depois de queda do cron).
   - **recusada**: grava log `failed` com o motivo, `attempts += 1`. Com `attempts < 3`, mantém `next_run_on` (roda de novo no próximo dia útil) e manda o e-mail de aviso. Com `attempts = 3`, vira `paused` (`pause_reason = failures`), `next_run_on = null`, e manda o e-mail de pausa.
4. O cron **não** roda na inicialização da API. Se uma execução for perdida, a do próximo dia útil pega o que está vencido.

Contagem das ocorrências: semanal `anchor + 7n` dias; quinzenal `anchor + 14n` dias; mensal: mesmo dia do mês, e nos meses sem esse dia, o **último dia do mês**, sempre calculado a partir de `anchor_on` (sem acumular erro).

## Ciclo de vida (API, painel e MCP)

- **Criar**: valida como uma nota normal (empresa, certificado, regime, dados fiscais). A 1ª data deve ser **a partir de amanhã** e dentro do horizonte `OUTBOX_SCHEDULE_MAX_DAYS` (15 dias hoje). `ends_on` opcional, depois da 1ª data. Não consome crédito.
- **Listar / ver**: agendas e, por agenda, o log.
- **Alterar**: valor, descrição, tomador, e-mail, `ends_on`, frequência, dia. Vale **só para as próximas execuções**. Mudar frequência ou dia recalcula `next_run_on` (1ª ocorrência depois de hoje) e zera `attempts`. Mudar só os dados da nota não mexe nas datas.
- **Pausar**: `status = paused`, `pause_reason = customer`, `next_run_on = null`.
- **Retomar**: volta a `active`, `attempts = 0`, `next_run_on` = 1ª ocorrência depois de hoje. Não recupera o que passou.
- **Cancelar**: `status = cancelled`, definitivo. O log e as notas já emitidas ficam.
- Uma agenda `completed` ou `cancelled` não pode ser alterada nem retomada.

## O que muda no código existente

- `POST /invoices` com `options.type = SCHEDULE` e data futura **passa a criar uma agenda `once`** (não mais uma nota imediata). **Isto é uma mudança de contrato da API** (a resposta deixa de ser a nota e passa a ser a agenda). Ver pergunta em aberto.
- O crédito deixa de ser reservado no cadastro do agendamento e passa a ser consumido às 09h.
- A outbox para de ser usada como agenda de notas. A coluna `available_at` **continua** (o backoff de retentativa da outbox depende dela).
- **Agendamentos que já existem hoje** (nota queued com `scheduled_for` no futuro e item de outbox com `available_at` no futuro) **continuam funcionando sem migration**: o relay segue respeitando `available_at`, `dpsIssuedAt` continua lendo `scheduled_for`, e o crédito dessas já está reservado. Eles se esgotam sozinhos dentro do horizonte de 15 dias.
- `web/lib/docs` e a documentação do MCP ganham a seção de recorrências.

## E-mails (novos, via `EmailService` e a fila de e-mail existente)

1. **Aviso de tentativa** (1ª e 2ª falha): "Você tem uma nota para rodar (empresa X, R$ Y), mas não conseguimos emitir: [motivo]. Tentamos de novo no próximo dia útil. Recarregue ou pause a recorrência." Com link para Cobrança e para a recorrência.
2. **Aviso de pausa** (3ª falha): "A recorrência foi pausada depois de 3 tentativas." Com link para retomar.

Destinatário: o e-mail do titular da conta (a decidir pelo construtor onde fica o e-mail de cobrança; usar o mesmo destino do aviso de crédito baixo, `credits-alerts`).

## Painel

Nova tela `/app/recurring` (ou aba em Notas fiscais): lista, criar/editar (reaproveita o formulário de emissão sem a data de competência, e com frequência, 1ª data e prazo), pausar/retomar/cancelar e o log de execuções por recorrência. As telas seguem o kit atual.

## MCP

Ferramentas novas no mesmo padrão de `nfse_issue`: `schedule_create`, `schedule_list`, `schedule_get`, `schedule_update`, `schedule_pause`, `schedule_resume`, `schedule_cancel`, `schedule_runs`. Mesmas permissões das notas.

## Perguntas em aberto (do Pedro)

1. **Contrato do `SCHEDULE`**: a resposta de `POST /invoices` com `SCHEDULE` passa a ser uma agenda. Aceitável, ou manter a rota antiga devolvendo uma nota e criar a recorrência só em rotas novas?

## Decisões minhas (para você conferir)

- A 1ª data tem de ser de amanhã em diante (evita a corrida com o cron das 09h).
- Qualquer motivo de falha segue o mesmo fluxo de 3 tentativas, com o texto do e-mail adaptado ao motivo.
- Ocorrências perdidas (cron fora do ar, agenda pausada) não são recuperadas: no máximo uma nota por execução.
- O cron não roda na inicialização.
- Sem migration dos agendamentos legados: eles se esgotam sozinhos.
- Horizonte da 1ª data: o mesmo `OUTBOX_SCHEDULE_MAX_DAYS`.
- Destinatário dos e-mails: o mesmo do aviso de crédito baixo.

## Respostas à checagem do construtor (decisões minhas, a conferir)

- **Competência**: a nota recorrente tem sempre a competência do dia em que roda (data de São Paulo, de uma função única `todayInSaoPaulo`). Ocorrência de sábado que roda na segunda tem competência de segunda. Não há competência passada ou livre numa agenda. O `SCHEDULE` de hoje também só aceitava data futura, que era o próprio dia da liberação, então nada se perde. **Mudança:** um `once` marcado para sábado ou domingo agora roda na segunda (antes rodava no próprio dia às 09h).
- **Erros do lote**: o `submitBatch` recusa **item a item** (validação ou regra de billing, como falta de crédito) e grava os demais na mesma transação por tenant. Só um erro inesperado derruba o lote inteiro, sem gravar nada, e nesse caso nenhuma agenda do tenant avança: o cron registra o erro e tenta no próximo dia útil.
- **Falhas permanentes** (certificado vencido, empresa desativada, dados fiscais inválidos) seguem o mesmo fluxo de 3 tentativas, com o motivo no e-mail. Simples e previsível; o custo é 2 e-mails de "tentamos amanhã" que não adiantam. Se incomodar, depois vira "pausa na hora" para esses motivos.
- **Idempotência e retentativa**: a chave `schedule:<id>:<occurrence_on>` não inclui a tentativa, de propósito: uma tentativa que falhou não gravou nota, então a seguinte pode reutilizar a chave. A nota é criada pelo `submitBatch` (sua própria transação) e o avanço da agenda e o log ficam numa transação logo depois. Se a API cair entre as duas, a próxima execução devolve a nota já criada (replay) e a agenda avança sem duplicar.
- **Concorrência**: o cron seleciona e "reivindica" as agendas com `FOR UPDATE SKIP LOCKED` e confere `status = active` dentro da transação. Uma agenda pausada ou cancelada entre a seleção e a emissão não emite. Duas instâncias não pegam a mesma linha. A chave de idempotência é a segunda barreira.
- **Ordem e crédito acabando no meio do lote**: processa a `next_run_on` mais antiga primeiro (e `created_at` como desempate), dentro do lock de billing do tenant. As que não tiveram crédito falham e contam 1 tentativa cada.
- **`test` e `live`**: o cron roda para os dois. No `test` não há reserva de crédito (como hoje) e **não se envia e-mail de cobrança**, só o log.
- **E-mails**: 1 e-mail de aviso por **tenant por dia**, listando as agendas que falharam ("tentamos de novo no próximo dia útil"), em vez de 1 por agenda. Pausa manual (cliente) não envia e-mail. O e-mail de **pausa por falhas** é 1 por agenda (é raro e importante). Destino: o mesmo do aviso de crédito baixo (`credits-alerts`), que é por tenant; o construtor confirma.
- **Limites**: sem limite por plano. Teto técnico de 200 agendas ativas por tenant, para o cron não crescer sem controle. O tamanho do lote por chamada segue o limite que o `submitBatch` já tem.
- **Permissões**: mesmas das notas (`nfse.invoices.issue` para criar e alterar, `nfse.invoices.view` para ler), também no MCP e nas API keys, `test` e `live`.

## O que fica para o construtor

Nomes de rotas e DTOs, formato exato dos e-mails (templates no provedor), layout da tela, índices adicionais, métricas do cron.
