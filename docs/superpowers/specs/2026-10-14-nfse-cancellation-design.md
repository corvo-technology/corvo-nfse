# Cancelamento de NFS-e e de emissão agendada

Data: 2026-10-14 · Status: rascunho para revisão · Escopo: `api/` e `web/`

## 1. Objetivo

Permitir cancelar:

1. **Nota emitida** (`authorized`), registrando na Sefin Nacional o evento 101101 (cancelamento simples).
2. **Emissão ainda não processada** (`queued`, agendada via `SCHEDULE` ou imediata que o worker ainda não pegou). Esse cancelamento é só local: nada foi enviado à Sefin.
3. **Emissão em andamento** (`processing`): o pedido registra a intenção de cancelar. Quando a nota for autorizada, o cancelamento fiscal (item 1) é aplicado automaticamente na mesma transação. Ver §6.5.

O cancelamento fica disponível pela API REST, pelo dashboard e pelo MCP.

## 2. Entendimento acordado

Decidido com o usuário:
- Canais: API, dashboard e MCP.
- Créditos (live): cancelar uma nota `queued` estorna a reserva; cancelar uma nota emitida **não** devolve o crédito e não mexe no período de billing.
- Motivo: um único body `{ reason, description? }`, com `reason ∈ issue_error | service_not_provided | other`. `description` é obrigatória (15–255 caracteres) para nota emitida e opcional para `queued`.
- Elegíveis para o cancelamento local: qualquer `queued`. Uma nota em `processing` registra a intenção de cancelamento (§6.5). `retry_pending`, `reconciliation_required` e `manual_review` retornam 409.
- Abordagem A: o cancelamento fiscal é assíncrono (outbox → BullMQ → processor), com resposta `202` e status `cancelling`.
- Seção 1 (domínio e estados) aprovada.

Decidido numa rodada posterior (cancelamento durante a emissão, opção C):
- Só `processing` aceita o pedido. A intenção fica em `cancellation_reason`/`cancellation_description`, com a nova coluna `cancellation_requested_at` registrando quando o cancelamento foi pedido (preenchida em todo pedido de cancelamento).
- Crédito: a nota autorizada e depois cancelada não devolve crédito. Se a emissão terminar `rejected` ou `failed`, a reserva é estornada como sempre.
- Emissão que termina `rejected` ou `failed`: limpa motivo, descrição e data. `manual_review`: mantém.
- Pedido repetido com a intenção pendente: o primeiro prevalece; os seguintes devolvem o estado atual sem sobrescrever.
- Texto de justificativa padrão por motivo (constantes fixas), usado só quando um cancelamento local de `queued` sem descrição perde a corrida para o worker. Pedido direto em `processing` exige descrição (15–255).

Premissas (revisar):
- Se a Sefin rejeita o cancelamento, a nota volta a `authorized` com `lastErrorCode/Message` e pode ser cancelada de novo. Não existe status `cancellation_rejected`.
- O prazo de cancelamento é regra da Sefin e do município. Não replicamos a regra; repassamos a rejeição.
- XML e PDF continuam disponíveis para download depois do cancelamento. O e-mail ao cliente passa a ser bloqueado.

## 3. Fora de escopo

- Substituição de nota (evento 105102).
- Cancelamento direto de `retry_pending`, `reconciliation_required` e `manual_review` (retornam 409; `processing` registra a intenção, §6.5).
- Resolução de nota em `manual_review`: não há caminho de saída no domínio hoje; fica para uma spec própria.
- Marca d'água "CANCELADA" no DANFSe.
- Download do XML do evento de cancelamento. O port `IDocumentStorage` não está versionado (ver seção 11), então o XML do evento não é guardado nesta entrega.
- Recuperação automática de nota parada em `cancelling` depois que as tentativas do BullMQ se esgotam.

## 4. Situação atual (verificada)

- `VALID_TRANSITIONS` termina em `authorized`, e o CHECK `ck_nfse_invoices_status` no banco só conhece os 8 status atuais.
- `InvoiceLifecycleService.transition()` faz numa transação: lock por tenant, check de `fromStatus`, persistência, evento, `usage.settle` e confirmação ou estorno da reserva.
- `NfseWorkflowService.processTenant()` ignora notas fora de `queued | processing | reconciliation_required`.
- **Corrida existente:** `payload()` chama `invoices.save(invoice)` com a nota carregada como `queued`, antes da transição para `processing`. Esse `save` grava a linha inteira, inclusive `status`. Se a nota for cancelada entre a leitura e o `save`, o `save` a devolve para `queued`, e a emissão segue normalmente.
- `open-nfse@0.11.0` expõe `NfseClient.cancelar({ chaveAcesso, autor: { CNPJ }, cMotivo, xMotivo, retryStore })`. Em falha transitória retorna `retry_pending` e salva o XML assinado no `RetryStore` com `kind: 'cancelamento_simples'`. Em rejeição definitiva lança `ReceitaRejectionError`. `replayPendingEvents(store)` reenvia, e a Sefin deduplica por `(chave, tipoEvento)`.
- O `OpenNfseProvider` já implementa o `RetryStore` na coluna `pending_emission` (jsonb), e o `transition()` zera essa coluna nos status terminais.
- Webhooks são publicados pelo método privado `NfseWorkflowService.emitWebhook()`.
- O MCP já descreve o escopo `nfse:write` como "Emitir e cancelar notas fiscais".
- `manual_review` é alcançado depois de 5 tentativas automáticas de reconciliação sem resultado (webhook `nfse.invoice.manual_review`) e não tem transições de saída (`VALID_TRANSITIONS.manual_review = []`).

## 5. Domínio

Status novos: `cancelling` e `cancelled` (terminal).

```
queued      → processing | cancelled
authorized  → cancelling
cancelling  → cancelled | authorized
```

`Invoice`:
- `requestCancellation(reason)`: de `queued` vai para `cancelled` (preenche `cancelledAt`); de `authorized` vai para `cancelling` (exige descrição fiscal válida). Nos demais status lança `InvoiceNotCancellableError` (409).
- `confirmCancellation()`: `cancelling → cancelled` e preenche `cancelledAt`.
- `rejectCancellation(code, message)`: `cancelling → authorized` e preenche `lastErrorCode/Message`.
- `requestCancellation` (a partir de `authorized`) e `confirmCancellation` limpam `lastErrorCode/Message`: o erro pertence à tentativa anterior, rejeitada, e não deve aparecer numa nota que está sendo cancelada ou já foi cancelada. O histórico continua nos eventos (`Cancellation rejected: …`) e no webhook `nfse.invoice.cancellation_rejected`. Só os métodos de cancelamento limpam o erro; a convenção dos demais métodos não muda.
- `cancellationReason` e `cancelledAt` como getters; `wasAuthorized` (`authorizedAt !== null`).
- `cancellationRequestedAt` (getter): preenchido por todo pedido de cancelamento (`requestCancellation` e `registerPendingCancellation`).
- `registerPendingCancellation(reason)`: só em `processing` (outros status lançam `InvoiceNotCancellableError`); exige descrição fiscal válida; grava motivo, descrição e `cancellationRequestedAt` sem mudar o status e sem gerar evento.
- `hasPendingCancellation`: verdadeiro quando `cancellationRequestedAt` está preenchido e o status é `processing`, `retry_pending` ou `reconciliation_required` (status de emissão em andamento).
- `discardPendingCancellation()`: limpa motivo, descrição e `cancellationRequestedAt`.

`CancellationReason { code, description | null }` em `domain/cancellation-reason.ts`. A descrição fiscal fora de 15–255 caracteres lança `InvalidCancellationReasonError` (422). `DEFAULT_CANCELLATION_DESCRIPTION` (constantes fixas, em português, uma por motivo) cobre a corrida do §6.5.

`InvoiceState.stage` ganha o valor `cancelled`. Uma nota `cancelling` é tratada como `authorized` no cálculo do stage.

## 6. Fluxos

### 6.1 Endpoint

`POST /v1/invoices/:id/cancel`, permissão `nfse.invoices.issue`, body `{ reason, description? }`.
- Nota `queued`: transição local, responde `200` com a nota `cancelled`.
- Nota `authorized`: responde `202` com a nota `cancelling`.
- Nota `processing`: registra a intenção (§6.5), responde `202` com a nota ainda em `processing` e `cancellationRequestedAt` preenchido. A descrição é obrigatória (15–255).
- Nota já `cancelling` ou `cancelled`, ou `processing` com a intenção já pendente: idempotente, devolve a nota sem efeito colateral (`200` se `cancelled`, `202` caso contrário). O primeiro pedido prevalece.
- Demais status (`retry_pending`, `reconciliation_required`, `manual_review`, `rejected`, `failed`): `409 ERROR_INVOICE_NOT_CANCELLABLE`.
- Corrida (outro escritor muda a nota entre a leitura e a transição): o serviço relê a nota. Se ela já está `cancelling` ou `cancelled` (outro pedido venceu), devolve o estado atual, sem webhook nem mensagem na outbox. Se a nota relida está em `processing` (o worker a pegou no meio do caminho), registra a intenção (§6.5) em vez de responder 409. Em qualquer outro status, responde `409 ERROR_INVOICE_NOT_CANCELLABLE`. O `ERROR_CONCURRENT_INVOICE_TRANSITION` deixa de sair deste endpoint (continua mapeado para outros chamadores do lifecycle).

### 6.2 Cancelamento local (`queued → cancelled`)

`InvoiceService.cancel` chama `lifecycle.transition(invoice, event)` numa transação: lock por tenant, check de `fromStatus`, status, evento, `usage.settle('cancelled')` (libera o reservado sem contar como autorizado) e estorno da reserva (`invoice_rejected`, mesmo caminho de `rejected/failed`). Depois o webhook `nfse.invoice.cancelled` é publicado (best effort).

`lifecycle.transition()` devolve um booleano: `true` quando aplicou a mudança de status, `false` quando o status gravado já era o de destino (outro pedido idêntico venceu a corrida). O webhook só é publicado quando a transição foi aplicada. Quando devolve `false`, o serviço relê a nota e devolve o estado gravado, sem webhook (cancelamentos duplicados e concorrentes geram um único `nfse.invoice.cancelled`). Não há lock distribuído: o lock por tenant dentro da transação do banco já serializa os pedidos, e o que faltava era o perdedor saber que perdeu.

A mensagem `invoice.emit` da outbox **não é removida**. Se ela for publicada depois, o workflow vê `cancelled` e não faz nada. Isso é mais simples que criar um status `discarded` na outbox (mudança em relação à Seção 1, por YAGNI).

### 6.3 Corrida com o worker (correção obrigatória)

- `payload()` passa a usar `invoices.saveDpsInfo(invoice)`, que atualiza só `dps_id`, `dps_series` e `dps_number`.
- `lifecycle.transition()` lança `ConcurrentInvoiceTransitionError`, que é tipado.
- O workflow captura esse erro na transição `queued → processing` e encerra sem emitir.

### 6.4 Cancelamento fiscal (`authorized → cancelling → cancelled | authorized`)

1. Na API, `lifecycle.transition(invoice, event, message)` grava status, evento e a mensagem `invoice.cancel` da outbox na mesma transação (`dedupeKey = cancellation:{eventId}`).
2. O relay chama o `InvoiceCancelHandler`, que publica em `nfse-cancellation` com `jobId = cancellation-{eventId}` (attempts 8, backoff exponencial de 60 s).
3. O `NfseCancellationProcessor` adquire o mesmo lock Redis `nfse:invoice:{id}` e chama `NfseCancellationService.process`.
4. O serviço ignora a nota se ela não estiver `cancelling`. Senão resolve as credenciais, chama `provider.cancel()` e trata o resultado:
   - `cancelled` → `confirmCancellation()`, `transition()` e webhook `nfse.invoice.cancelled`.
   - `rejected` → `rejectCancellation()`, `transition()` e webhook `nfse.invoice.cancellation_rejected`.
   - `pending` → lança erro para o BullMQ tentar de novo. Na próxima tentativa, o provider encontra o pendente no `RetryStore` e faz replay em vez de assinar outro evento.

Créditos: nenhum efeito. A reserva já foi consumida quando a nota foi autorizada.

### 6.5 Cancelamento durante a emissão (`processing`)

1. **Pedido.** `InvoiceService.cancel` chama o repositório, que faz um `UPDATE` condicional gravando `cancellation_reason`, `cancellation_description` e `cancellation_requested_at` somente se `status = 'processing'` e `cancellation_requested_at IS NULL`. Não muda o status, não gera evento nem mensagem na outbox. Se o `UPDATE` não afetar linha (a nota mudou de status entre a leitura e a escrita), o serviço relê a nota e decide de novo: `authorized` segue o caminho fiscal normal; `cancelling`/`cancelled` devolve o estado; intenção já pendente devolve o estado; outro status responde 409.
2. **Corrida de `queued`.** Quando o cancelamento local de uma nota `queued` perde a corrida para o worker e a nota relida está em `processing`, registra-se a intenção. Se o pedido original não trazia descrição, usa-se o texto padrão do motivo:
   - `issue_error`: "Cancelamento solicitado pelo emitente por erro na emissão"
   - `service_not_provided`: "Cancelamento solicitado pelo emitente: serviço não prestado"
   - `other`: "Cancelamento solicitado pelo emitente"
   Os textos são constantes fixas (não texto livre) com 15 a 255 caracteres, garantidos por teste unitário e pela mesma validação `assertFiscalCancellationReason` antes de gravar. Pedido direto em `processing` não usa o padrão: exige a descrição.
3. **Autorização.** Quando o `transition()` leva a nota de `processing` ou `reconciliation_required` a `authorized`, e a linha gravada (lida sob o lock do tenant) tem `cancellation_requested_at` e `cancellation_reason`, o mesmo `transition()` aplica `authorized → cancelling` na mesma transação (segundo evento) e grava a mensagem `invoice.cancel` na outbox. Não há janela entre a autorização e o cancelamento, e nada depende da cópia em memória do worker. O restante é o fluxo do §6.4. O webhook `nfse.invoice.authorized` continua sendo publicado (a nota foi emitida) e o crédito é consumido normalmente.
4. **Emissão que não autoriza.** `rejected` ou `failed`: o `transition()` grava motivo, descrição e `cancellation_requested_at` como nulos e a mensagem do evento registra que o pedido de cancelamento foi descartado; a reserva é estornada como hoje. `retry_pending` e `reconciliation_required`: a intenção permanece e vale quando a emissão terminar. `manual_review`: a intenção permanece, visível a quem resolver a nota à mão.
5. **Regra de escrita.** Transições que partem de `processing`, `retry_pending` ou `reconciliation_required` nunca escrevem as colunas de cancelamento a partir da cópia em memória do worker (que pode estar desatualizada e apagaria a intenção). Exceções: os destinos `rejected`/`failed`, que as limpam, e a aplicação do item 3, que lê os valores da linha gravada.
6. **E-mail.** Com a nota em `cancelling`, o e-mail automático é ignorado (§8). Se a Sefin rejeitar o cancelamento e a nota voltar a `authorized`, o agendador de recuperação reenvia o e-mail.

## 7. Integração fiscal

A porta `FiscalProvider` ganha `cancel(payload: ICancelPayload): Promise<FiscalCancelResult>`.
- `OpenNfseProvider`: usa `pending_emission` como `RetryStore` (mesmo slot, liberado em `authorized`). Mapeamento: `issue_error → '1'`, `service_not_provided → '2'`, `other → '9'`. `ReceitaRejectionError` e `ValidationError` viram `rejected`.
- `FakeNfseProvider` (test): retorna `cancelled`.

## 8. Contrato e canais

- Resposta da invoice: campos aditivos `cancellationReason`, `cancellationDescription`, `cancelledAt`, `cancellationRequestedAt`.
- `GET /v1/invoices?status=` aceita `cancelling` e `cancelled`.
- XML/PDF/download-url: disponíveis quando `wasAuthorized`. E-mail: só para `authorized`.
- E-mail automático: o processor de e-mail, ao encontrar a nota em `cancelling` ou `cancelled`, retorna sem lançar erro, sem nova tentativa e sem alterar o status do e-mail (`lastEmailStatus` continua nulo). Se o cancelamento for rejeitado e a nota voltar a `authorized`, o agendador de recuperação (que reenfileira `authorized` com e-mail pedido e `lastEmailStatus` nulo) reenvia o e-mail; se a nota terminar `cancelled`, nenhum e-mail é enviado.
- `POST /v1/invoices/:id/email` numa nota `cancelling` ou `cancelled` responde `409` com mensagem própria (e-mail indisponível para nota cancelada), distinta de "Documents not ready" (nota autorizada sem documentos).
- Webhooks públicos novos: `nfse.invoice.cancelled` e `nfse.invoice.cancellation_rejected`. A publicação é extraída para `InvoiceWebhookPublisher` (DRY entre workflow, cancelamento e InvoiceService).
- MCP: tool `nfse_cancel` (`invoice_id`, `reason`, `description?` com `maxLength` 255 no `inputSchema`), escopo `nfse:write`.
- A regra da descrição (15 a 255 caracteres) vem de uma constante única por workspace: `CANCELLATION_DESCRIPTION_MIN/MAX` em `api/src/modules/invoice/domain/cancellation-reason.ts` (usada pelo domínio, pelo DTO e pelo `inputSchema` do MCP) e uma constante equivalente em `web/lib/invoice-cancellation.ts` (usada pelo modal).
- OpenAPI: o endpoint de cancelamento documenta `200` e `202`. A descrição do filtro de status da tool `nfse_list` é montada a partir de `INVOICE_STATUSES`, para não ficar desatualizada. O `api/llms.txt` cita `409 ERROR_INVOICE_NOT_CANCELLABLE` e `422 ERROR_INVALID_CANCELLATION_REASON`.
- Dashboard: botão "Cancelar nota" no detalhe da invoice (para `queued`, `processing` e `authorized`, com permissão `nfse.invoices.issue`; em `processing` o modal avisa que a nota está sendo emitida, será cancelada na Sefin assim que for autorizada e o crédito não é devolvido, e a descrição é obrigatória; uma nota com intenção pendente mostra o marcador "cancelamento solicitado"; a regra é um predicado puro e testado em `web/lib/invoice-cancellation.ts`) abre um modal com motivo e descrição. O modal só é montado enquanto está aberto, então motivo, descrição e erro começam limpos a cada abertura. Status, timeline e opções de webhook em en/pt.
- Docs: endpoint novo em `web/lib/docs/content/{en,pt}.ts` (paridade en/pt mantida), `api/FRONTEND_API.md` e `api/llms.txt`, incluindo o comportamento em `processing` (§6.5). A descrição da tool `nfse_cancel` também.

## 9. Persistência

Migration `1792400000000-AddInvoiceCancellation`: recria `ck_nfse_invoices_status` com os dois status novos e adiciona `cancellation_reason varchar(30)`, `cancellation_description text` e `cancelled_at timestamptz` (todas nullable). Sem backfill. Migration `1792410000000-AddCancellationRequestedAt`: adiciona `cancellation_requested_at timestamptz` (nullable); o `down` remove a coluna. O `down` da primeira migration verifica antes se existem notas `cancelling` ou `cancelled` e, se existirem, falha com uma mensagem clara: voltar esses status para `authorized` falsificaria o estado fiscal, então a decisão sobre elas é de quem faz o rollback.

## 10. Testes

- Domínio: transições, regras de motivo, stage.
- Lifecycle: estorno em `queued → cancelled`, nenhum efeito de crédito em `cancelling → cancelled`, mensagem da outbox na mesma transação, erro tipado de concorrência, retorno booleano (`true` aplicado, `false` já estava no destino).
- `InvoiceService.cancel` sob corrida: pedido duplicado concorrente publica um único webhook e devolve o estado gravado; perda para o worker (`ConcurrentInvoiceTransitionError`) vira `409 ERROR_INVOICE_NOT_CANCELLABLE`; vencedor concorrente é devolvido sem webhook.
- Workflow: a nota cancelada não é emitida (`saveDpsInfo` + captura do erro).
- Provider: mapeamento de motivo, `ok`/`retry_pending`/replay/rejeição; Fake.
- Aplicação: handler, processor (lock), serviço (os três desfechos), `InvoiceService.cancel` (local, fiscal, idempotente, 409), controller (200/202).
- MCP: a tool delega ao `InvoiceService.cancel`.
- Web: modal (validação de descrição, chamada à API), reset ao reabrir, predicado de visibilidade do botão (status e permissão), paridade de docs.
- Comportamento: erro anterior limpo ao pedir/confirmar o cancelamento; e-mail automático ignora `cancelling`/`cancelled` sem lançar erro; `requestEmail` com mensagem própria; `saveDpsInfo` sem campos para atualizar não emite `UPDATE`; saída silenciosa da corrida com log.
- Cancelamento durante a emissão (§6.5): constantes padrão com 15–255; `registerPendingCancellation`/`hasPendingCancellation`/`discardPendingCancellation`; `UPDATE` condicional do repositório; `transition()` preserva as colunas de cancelamento em transições de emissão, limpa em `rejected`/`failed` e aplica `authorized → cancelling` (dois eventos, uma mensagem na outbox) quando há intenção; `InvoiceService.cancel` em `processing` (com descrição, sem descrição → 422, repetido, `retry_pending` → 409) e na corrida de `queued` (descrição do cliente ou padrão); simulação concorrente: intenção registrada enquanto o worker autoriza não se perde; pedido duplicado grava uma intenção; emissão rejeitada limpa a intenção.
- Cobertura adicional: `stateOverride` do publisher; ramos `failed_permanent`, `still_pending`, `ValidationError` e `close` do provider; caracterização do risco "Sefin aceitou e `transition()` falhou depois" (o job tenta de novo e reenvia o evento).

## 11. Riscos e pontos em aberto

- **Intenção perdida por escrita desatualizada:** o worker grava a linha inteira com a cópia carregada antes. A regra de escrita do §6.5 (item 5) e a aplicação atômica na autorização (item 3) são o que evita isso; é o ponto que mais exige teste de concorrência.
- **Justificativa genérica na Sefin:** o texto padrão da corrida é verdadeiro mas genérico. Quem quiser texto específico deve enviar a descrição no pedido.
- **Nota em `retry_pending`/`reconciliation_required` por muito tempo** não pode ser cancelada até resolver (409).
- **Nota parada em `cancelling`** depois de 8 tentativas: precisa de ação operacional (log + Sentry via falha do job).
- **Resposta perdida depois que a Sefin aceitou:** o replay reenvia o mesmo XML. Se a Sefin responder com rejeição de evento duplicado em vez do resultado original, a nota volta a `authorized` por engano. A biblioteca afirma que o reenvio devolve "o mesmo resultado ou uma rejeição determinística". Validar em produção restrita.
- **Ordem de deploy:** implante o worker antes da API. Um worker antigo não conhece o tipo de outbox `invoice.cancel` ("No outbox handler") e a nota fica em `cancelling`. Isso entra no `SELF_HOSTING.md` e na descrição do PR.
- **Recuperação de nota presa em `cancelling`** (fora de escopo, §3): a solução natural é estender o agendador de recuperação para reenfileirar notas `cancelling` antigas (o serviço é idempotente e o provider faz replay do evento guardado). Fica para uma spec própria, que também cobriria a falha de ordem de deploy.
- **`api/src/infra/storage/` não está versionado**: a regra `storage/` do `.gitignore` da raiz ignora essa pasta. Um clone limpo não compila. Corrigir à parte (`!api/src/infra/storage/`).
- O número de DPS reservado por uma nota cancelada na corrida fica sem uso (lacuna na sequência).
