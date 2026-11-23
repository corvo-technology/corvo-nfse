# Substituição de nota (corrigir uma NFS-e já autorizada)

Data: 2026-11-10. Status: aguardando aprovação.

## Intenção

Hoje, para corrigir uma nota autorizada, a pessoa cancela e emite outra. Isso gasta duas operações, deixa um intervalo sem nota válida e nem sempre é aceito pelo município. O sistema nacional tem a **substituição**: uma nota nova que referencia a antiga e a cancela no mesmo ato.

## O que verificamos

Fontes: regras oficiais que vêm com a `open-nfse` (`specs/ruleset/emissao.regras.json`) e a própria biblioteca.

- A substituição é uma **nova DPS** com o grupo `subst` (`chSubstda`, `cMotivo`, `xMotivo`). O sistema gera sozinho o evento de cancelamento por substituição (`e105102`) na nota antiga.
- Motivos (`cMotivo`): `01` desenquadramento do Simples Nacional, `02` enquadramento no Simples Nacional, `03` inclusão de imunidade ou isenção, `04` exclusão de imunidade ou isenção, `05` rejeição pelo tomador ou intermediário, `99` outros.
- **E0061: para MEI e ME/EPP, a substituta não pode alterar a identificação do tomador (se identificado), a data de competência nem o valor do serviço.** Como a Corvo só atende MEI e Simples Nacional, esta é a restrição central.
- **E0050:** fora do prazo definido pelo município, a substituição é recusada, exceto nos motivos `01` e `02`.
- **E0056:** conforme o município, nota sem tomador identificado não pode ser substituída.
- **E0058:** conforme o município, a substituta não pode mudar a identificação do não emitente.
- **E0046:** nota cancelada não pode ser substituída. **E0044:** nota inexistente. **E0042:** chave inválida.
- **E0065:** a substituta tem de sair do mesmo ambiente gerador da original.
- **E0068:** não substitui nota com pedido de análise fiscal para cancelamento pendente.
- A `open-nfse` expõe `cliente.substituir({ chaveOriginal, novaDps, cMotivo, xMotivo })`, com resultado `ok` ou `retry_pending`, e reenvio idempotente. A Corvo hoje usa `cancelar` e não usa `substituir`.

## Não verificado

- **Prazo e regras por município** (E0050, E0056, E0058): vêm dos parâmetros municipais. Não confirmamos como consultá-los nem se a API de parâmetros expõe o prazo de substituição.
- **Tamanho de `xMotivo`** e quando ele é obrigatório. No cancelamento são 15 a 255 caracteres; confirmar no XSD para a substituição.
- Aceitação em homologação: nenhuma substituição foi emitida.

## O que dá para corrigir (MEI e Simples Nacional)

| Pode mudar | Não pode mudar (E0061) |
|---|---|
| Descrição do serviço | CPF/CNPJ do tomador |
| Nº do pedido e observações | Data de competência |
| | Valor do serviço |

Dois pontos ficam **a confirmar em homologação**, porque a regra fala em "identificação do tomador" sem detalhar: se o nome do tomador pode mudar quando o documento é o mesmo, e se o código do serviço pode mudar (a E0060 proíbe isso só para não optantes do Simples).

Para corrigir valor, tomador ou competência, o caminho continua sendo **cancelar e emitir outra**. A interface precisa dizer isso com clareza, para a pessoa não descobrir pela recusa da Receita.

## Metas

- `POST /v1/invoices/:id/substitute` cria a substituta de uma nota `authorized`.
- A Corvo recusa na entrada o que a E0061 recusaria, com erro claro e a orientação de cancelar e reemitir.
- A nota antiga passa a `cancelled` com a referência da substituta; a nova segue o fluxo assíncrono normal.
- Webhooks e histórico de eventos mostram a ligação entre as duas.

## Fora do escopo

- Motivos `01` a `05`: na primeira versão, só `99` (outros) com `xMotivo` obrigatório. Os demais envolvem mudança de enquadramento ou manifestação do tomador.
- Substituição pelo painel na primeira versão (API e MCP primeiro).
- Solicitação de análise fiscal para cancelamento fora do prazo (`e101103`).

## Contrato proposto

```json
POST /v1/invoices/:id/substitute
{
  "reason": "other",
  "description": "Descrição do serviço corrigida",
  "service": { "description": "Consultoria em tecnologia, outubro/2026" },
  "purchaseOrder": "PO-4521",
  "notes": "Substitui a nota anterior"
}
```

- Só os campos alteráveis são aceitos. Enviar `amount`, `competenceDate` ou `customer.taxId` diferentes devolve `422` com `not_allowed`.
- Resposta `202` com a nota substituta em `queued`, com `substitutes: "<id da original>"`.
- `Idempotency-Key` com a mesma semântica da emissão.

## Fluxo

1. Valida que a original está `authorized` e pertence ao mesmo ambiente.
2. Monta a nova nota copiando o snapshot da original e aplicando só as mudanças permitidas.
3. Reserva crédito e numeração como numa emissão. **Decisão pendente: a substituta consome crédito?**
4. O `DpsBuilder` acrescenta o grupo `subst`. O provedor chama `substituir` da biblioteca.
5. Autorizada a substituta: a original vai para `cancelled` (motivo "substituída"), no mesmo passo que registra a ligação entre as duas.
6. Recusada: a original continua `authorized`, intacta. A substituta fica `rejected` com o código da Receita.
7. Falha transitória: usa o mesmo mecanismo de reenvio da emissão; o portal trata a repetição como idempotente.

## Estados e dados

- Coluna `substitutes_invoice_id` em `nfse_invoices` (**migration**), com chave estrangeira composta por tenant, como as demais referências.
- Novos eventos de webhook: `nfse.invoice.substituted` (na original). A substituta emite os eventos normais.
- Sem estado novo no ciclo de vida: a original vai de `authorized` a `cancelled`.

## Anti-metas

- A original **nunca** é marcada como cancelada antes de a Receita autorizar a substituta.
- A Corvo nunca tenta "adivinhar" o prazo do município: se a Receita recusar por prazo (E0050), devolve o erro como veio, com orientação.
- Uma substituição nunca vira cancelamento seguido de emissão por conta própria.

## Testes

- Normalização: campos proibidos recusados; original fora de `authorized` recusada.
- DPS com `subst` válida no XSD v1.01; sem `subst`, byte a byte igual à de hoje.
- Fluxo: autorizada (original cancelada e ligada), recusada (original intacta), falha transitória (reenvio sem duplicar).
- Concorrência: duas substituições da mesma nota ao mesmo tempo.
- Integração com Postgres: referência entre notas respeita o tenant.

## Decisões para o dono do produto

1. **A substituta consome crédito?** Sugestão: sim, como qualquer nota emitida; o cancelamento por substituição não devolve o crédito da original, como já é no cancelamento.
2. Com as restrições da E0061, a substituição resolve poucos casos (texto e classificação). Vale o esforço agora, ou deixar para depois do tomador no exterior?
3. Oferecer no painel um atalho "cancelar e emitir outra" para os casos que a substituição não cobre?
