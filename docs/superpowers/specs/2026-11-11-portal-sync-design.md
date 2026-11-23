# Sincronização com o portal nacional: eventos das notas emitidas e notas recebidas

Data: 2026-11-11. Status: aguardando aprovação. Duas partes, cada uma em PR próprio, nesta ordem: **A** (eventos das notas que a empresa emitiu) e **B** (notas que a empresa recebeu). As duas usam o mesmo mecanismo de leitura, por isso estão na mesma spec.

## Intenção

Hoje o Corvo só sabe o que ele mesmo fez. Se alguém cancela uma nota direto no site da Receita, se o tomador rejeita a nota ou se o município bloqueia, o Corvo continua mostrando "autorizada". O cliente descobre tarde, e a nota do Corvo diverge da nota que vale.

O portal nacional guarda tudo isso e deixa a empresa ler, por CNPJ, em ordem. A biblioteca `open-nfse` já traz essa leitura (`fetchByNsu`). O Corvo não usa.

## O que verificamos (e o que não)

- **A leitura existe e está pronta na biblioteca.** `fetchByNsu({ ultimoNsu })` devolve documentos em ordem, cada um com número sequencial (NSU), chave de acesso, tipo (`NFSE` ou `EVENTO`) e, nos eventos, o tipo do evento. A biblioteca já trata os casos "sem documentos" (HTTP 404) e "rejeição" (HTTP 400) sem lançar erro. Fonte: `docs/guide/consultar.md` do pacote.
- **O cursor é por CNPJ.** Cada nota gera um NSU para cada município envolvido (emitente, tomador, intermediário). A biblioteca avisa que uma matriz não vê documentos roteados só ao município da filial. O Corvo hoje trata cada empresa (CNPJ) separadamente, então um cursor por empresa e ambiente basta.
- **Tipos de evento que a biblioteca entende** (parse): cancelamento, cancelamento por substituição, análise fiscal (solicitado, deferido, indeferido), confirmação e rejeição do prestador, do tomador e do intermediário, confirmação tácita, anulação de rejeição, cancelamento e bloqueio por ofício, desbloqueio.
- **A biblioteca não emite** os eventos de manifestação (confirmar ou rejeitar como tomador). Só lê.
- **Não verificado:**
  - Se a leitura funciona com o certificado de um MEI e de uma empresa recém-aberta, e quanto tempo o portal guarda os documentos.
  - Limite de chamadas do portal e se há cobrança. Pelo que sei é gratuito para o contribuinte, mas não li isso em fonte oficial.
  - O que a Produção Restrita devolve para um CNPJ de teste (provavelmente pouco ou nada).
  - Se um evento de cancelamento sempre chega com o motivo informado.

---

## Mecanismo comum

### Fluxo

1. Uma tarefa agendada (a cada hora, minha escolha) percorre as empresas que têm certificado ativo, uma por vez, usando o mesmo mecanismo de `TenantWorkDiscovery` do vencimento de certificado.
2. Para cada empresa e ambiente (`test` lê a Produção Restrita, `live` lê a produção), lê o cursor guardado, chama `fetchByNsu` em laço até o portal dizer que não há mais nada, e avança o cursor.
3. **Cada documento é gravado antes de o cursor avançar.** Se a tarefa cair no meio, a próxima rodada relê o que faltou. Gravar de novo o mesmo NSU não duplica (chave única).
4. Depois de gravar, o documento é processado (Parte A ou B). Falha ao processar **não** trava o cursor: o documento fica gravado com a marca "não processado" e uma segunda passagem tenta de novo.

### Dados novos

- `portal_sync_cursors`: empresa, ambiente, último NSU, quando rodou, último erro. Uma linha por empresa e ambiente.
- `portal_documents`: empresa, ambiente, NSU, chave de acesso, tipo (`NFSE` ou `EVENTO`), tipo do evento, XML, data de geração no portal, processado em. Chave única em (empresa, ambiente, NSU).

O XML recebe o mesmo tratamento do XML das notas emitidas. O construtor decide onde e como guardar, seguindo o que o código já faz.

### Quando não roda

- Sem certificado ativo ou certificado vencido: pula a empresa, sem erro.
- Falha de rede, certificado recusado ou rejeição do portal: registra o erro no cursor, tenta de novo na próxima hora, com espera maior depois de falhas seguidas. **Nunca** afeta a emissão.
- O portal fora do ar já tem um disjuntor (`fiscal-portal-breaker`); a leitura respeita o mesmo.

---

## Parte A. Eventos das notas emitidas

### Intenção

Mostrar e refletir no Corvo o que aconteceu com a nota **depois** de autorizada.

### O que cada evento faz

| Evento no portal | Efeito no Corvo |
|---|---|
| Cancelamento, cancelamento por substituição, cancelamento deferido na análise fiscal, cancelamento por ofício | A nota vira **cancelada** (motivo "cancelada no portal"), entra na linha do tempo da nota e o cliente recebe e-mail e webhook. |
| Rejeição do tomador ou do intermediário | A nota **continua autorizada**. Aparece na linha do tempo, o cliente recebe um e-mail, e o painel mostra um selo "tomador rejeitou". |
| Bloqueio por ofício | Nota continua autorizada. E-mail ao cliente e selo "bloqueada pelo município". |
| Confirmação do tomador, confirmação tácita, desbloqueio, anulação de rejeição | Só entra na linha do tempo. Se havia um selo, ele some. |
| Qualquer outro | Só fica gravado. |

A nota é encontrada pela chave de acesso. Evento de uma chave que o Corvo não conhece é ignorado nesta parte (pode ser nota emitida fora do Corvo; a Parte B cuida disso).

### Regras

- **Corrida com o cancelamento do Corvo.** Se a nota já está `cancelling` ou `cancelled`, o evento só entra na linha do tempo, sem mudar o status nem avisar duas vezes.
- **Nunca desfazer.** Evento só leva a nota para frente (`authorized` para `cancelled`). Nada volta uma nota cancelada para autorizada.
- **Ambiente de teste** também sincroniza, mas não manda e-mail nem webhook ao cliente (mesma regra dos avisos de conta, que só valem em `live`).
- Os avisos reutilizam `accountNotice` (e-mail) e o publicador de webhooks que já existe. Novos tipos: `invoice-cancelled-on-portal`, `invoice-rejected-by-taker`.

### Onde aparece

- Linha do tempo da nota (`GET /v1/invoices/:id/events`): os eventos do portal entram junto com as transições de status, com a origem identificada.
- Painel: selo na lista e na página da nota.
- Webhook: evento novo `invoice.cancelled` já existe; a Parte A reutiliza com `source: "portal"`. A rejeição do tomador ganha o evento `invoice.taker_rejected`.

### Fora do escopo da Parte A

- Manifestar como tomador (confirmar ou rejeitar uma nota recebida). A biblioteca não emite esses eventos.
- Pedir cancelamento por análise fiscal.

---

## Parte B. Notas recebidas

### Intenção

O cliente é prestador, mas também contrata serviços de outras empresas. O portal tem essas notas. Mostrar "notas que recebi" deixa o Corvo útil para a entrada, não só para a saída, e ajuda o contador.

### Metas

- Gravar toda NFS-e em que a empresa aparece como **tomador** ou **intermediário** (o papel é lido do XML).
- Listar e consultar essas notas na API, no painel e no MCP, somente leitura.
- Baixar o XML e o PDF (DANFSe) de uma nota recebida.
- Guardar também as notas em que a empresa é **emitente mas a chave não existe no Corvo** (emitidas fora do Corvo), marcadas como "emitida fora do Corvo". Isso não aparece na lista de recebidas. Fica guardado para uma spec futura (limite do MEI, conferência).

### Interface

- API: `GET /v1/companies/:id/received-invoices` (filtros por mês e por prestador, paginação por cursor, como as outras listas) e `GET /v1/companies/:id/received-invoices/:key` (detalhe, XML e PDF).
- MCP: `nfse_received_list`.
- Painel: página "Notas recebidas" dentro da empresa, com lista simples (data, prestador, serviço, valor, retenção de ISS se houver). Sem edição.

### Dados

Cada nota recebida é uma linha de `portal_documents` com o papel da empresa e campos extraídos do XML para listar: número, data, prestador (documento e nome), código do serviço, valor bruto, valor líquido, ISS retido. O XML cru continua guardado.

### Privacidade

Nota recebida traz dados de terceiros (o prestador). Só quem tem acesso à empresa lê, com a mesma permissão de ver notas (`nfse.invoices.view`). Exclusão da empresa apaga as notas recebidas também.

### Fora do escopo da Parte B

- Lançamento contábil, conciliação bancária, cálculo ou pagamento de retenção de ISS.
- Rejeitar ou confirmar a nota como tomador.
- Alerta de "nota recebida com retenção a pagar". Pode vir depois, em cima destes dados.

---

## Anti-metas

- Nunca perder um documento: cursor só avança depois de gravar.
- Nunca mudar o status de uma nota por um evento que o Corvo não reconhece.
- Nunca bloquear ou atrasar emissão por causa da sincronização.
- Nunca mostrar a um usuário dados de uma empresa de outro cliente (tudo por tenant, com a mesma proteção de linha que as outras tabelas).

## Decisões minhas (o construtor pode ajustar)

- Frequência de uma hora.
- Cancelamento no portal altera o status no Corvo (recomendo; a alternativa, só avisar, deixa o painel mentindo).
- Parte A antes da B.
- Ambiente `test` sincroniza também, para que dê para testar o fluxo na Produção Restrita.

## Casos de borda (decididos)

- **Mesma nota, vários NSUs.** `portal_documents` guarda **uma linha por NSU** (a chave única continua em empresa, ambiente e NSU). A lista de recebidas e a busca de eventos agrupam por **chave de acesso**, então a nota aparece uma vez. O papel da empresa (emitente, tomador, intermediário) é calculado comparando o CNPJ da empresa com os CNPJs do XML; se for emitente e tomador ao mesmo tempo, vale emitente.
- **Documento que não dá para ler** (XML corrompido, tipo desconhecido). O XML cru é gravado com a marca "não processado" e o cursor **avança**. Uma empresa nunca fica travada por um documento ruim. Só quando nem a gravação funciona a rodada para, registra o erro no cursor e tenta de novo na hora seguinte.
- **Primeira rodada de uma empresa.** Lê desde o NSU 0. Os eventos antigos **atualizam o status em silêncio**: não mandam e-mail nem webhook. Os avisos só valem para documentos gerados depois da primeira rodada concluída. A Parte B traz o histórico de notas recebidas.
- **Cancelamento que o próprio Corvo fez.** Quando o portal devolve esse evento horas depois, a nota já está `cancelled`, então só entra na linha do tempo, sem aviso. Isso já está na regra de corrida acima.
- **Contrato do webhook.** O campo `source` é **adicional** e opcional (`"portal"` ou ausente). Quem já consome não é afetado. `invoice.taker_rejected` é um evento novo.
- **Selos.** A nota ganha uma coluna `portal_flag` (`taker_rejected`, `blocked` ou nula), atualizada pelo processador de eventos. A lista do painel lê essa coluna, sem consultar eventos por linha. Confirmação do tomador, desbloqueio e anulação de rejeição limpam a coluna.
- **Teste e produção.** O código é construído e testado com XMLs de exemplo. A rodada real contra a Produção Restrita (último item abaixo) **não bloqueia o desenvolvimento**, mas é obrigatória **antes de ligar a sincronização em `live`**, que fica atrás de uma configuração desligada por padrão.
- **Limite de chamadas.** Sem número oficial, o construtor espalha as empresas ao longo da hora (não todas no mesmo minuto) e espaça mais as que não tiveram documentos nas últimas rodadas. Se o portal informar um limite, ele vira configuração.
- **Retenção.** Apagar a empresa apaga também os eventos e as notas "emitidas fora do Corvo" de `portal_documents`. Não há prazo de retenção nesta versão: os documentos ficam enquanto a empresa existir.

## Pendente antes de implementar

- Rodar `fetchByNsu` contra a Produção Restrita com um certificado real e registrar o que volta (inclusive o formato do evento de cancelamento) em `docs/fiscal/homologation.md`.
- Confirmar limite de chamadas e se o portal cobra.
- Confirmar o papel (tomador, intermediário, emitente) lendo o XML de uma nota real recebida.
