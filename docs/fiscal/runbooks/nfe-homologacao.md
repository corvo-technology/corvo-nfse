# NF-e em homologação (runbook)

Roteiro de homologação da NF-e: status do serviço, spike, eventos, o que liga a NF-e (nada em teste; só a produção tem interruptor), e o roteiro completo de aceite (SP e uma UF da SVRS).

A NFC-e (venda ao consumidor, modelo 65) tem o runbook dela: [`nfce-homologacao.md`](./nfce-homologacao.md).

## Status do serviço

Mostra se a SEFAZ da UF responde e se o mTLS com o certificado A1 funciona.

```bash
cd api
NFE_SPIKE_PFX_PATH=/caminho/empresa.pfx \
NFE_SPIKE_PFX_PASSWORD='...' \
NFE_SPIKE_UF=SP \
yarn ts-node -r tsconfig-paths/register scripts/nfe-spike-status.ts
```

Esperado: `cStat=107 xMotivo="Serviço em Operação" up=true`. Se vier 108 ou 109, a SEFAZ está
fora do ar: espere e tente de novo. O script só fala com a homologação (`tpAmb=2`).

## Spike

O passo a passo completo (variáveis, comandos, o que esperar, cStat e a tabela de resultados) está em
[`docs/fiscal/nfe-spike.md`](../nfe-spike.md). Resumo: rodar `nfe-spike-status.ts` e
`nfe-spike-authorize.ts` em SP e numa UF da SVRS, e preencher a tabela de resultados.

Os scripts nunca imprimem senha, PFX, chave privada nem o XML da nota. Se algum dia imprimirem,
trate como incidente de segurança.

## Eventos: cancelamento, carta de correção e inutilização

Roteiro de aceite do PR 5, em **SP** e numa UF da **SVRS**, sempre em homologação (empresa `test`,
`NFE_PRODUCTION_ENABLED=false`):

1. **Cancelamento.** Emita uma NF-e e espere `authorized`. `POST /v1/invoices/{id}/cancel` com uma
   justificativa de 15 a 255 caracteres. Esperado: `202` com `cancelling`; depois o evento fica
   `registered` (cStat 135), a nota `cancelled` e chega o webhook `nfe.document.cancelled`.
   Confira em `GET /v1/invoices/{id}/events`. O crédito **não** volta (a nota já foi autorizada).
2. **Duas cartas de correção.** Em outra nota autorizada, `POST /v1/invoices/{id}/corrections` duas vezes
   seguidas. Esperado: `sequence` 1 e 2, as duas `registered`, webhook `nfe.document.corrected` para
   cada uma, a nota continua `authorized`.
3. **Inutilização.** Descarte uma NF-e rejeitada (`POST /v1/invoices/{id}/discard`) e inutilize o número
   dela com `POST /v1/invoices/inutilizations` (com `type: "nfe"`). Esperado: `pending` e depois `homologada` (cStat 102),
   webhook `nfe.inutilization.completed`. Em `GET /v1/invoices/number-gaps?type=nfe` a faixa some. Inutilize também
   uma faixa acima do último número: a próxima NF-e deve sair com o número seguinte ao fim da faixa.
4. **Anote no relatório do spike** ([`nfe-spike.md`](../nfe-spike.md), pergunta 7): a consulta pela
   chave devolveu `procEventoNFe` com o cancelamento registrado? E, ao repetir a mesma inutilização, a
   SEFAZ respondeu 563 ou 206 (o Corvo trata os dois como já inutilizado)? Se a consulta não devolver
   o evento, o evento fica `pending_check`, o Corvo para de olhar depois de 5 tentativas e **não
   reenvia sozinho**: confira no portal da SEFAZ.

## O que liga a NF-e

Nada. A NF-e e a NFC-e em **teste (homologação)** estão abertas para toda conta e para todo estado que o
código sabe atender: não existe variável de liberação, coluna por cliente nem tabela de estados. A empresa
`test` só precisa de endereço completo, IE e CRT (painel, página da empresa, seção NF-e, ou
`PUT /v1/companies/{id}/nfe-settings`) e do certificado A1.

O **único interruptor** é o da produção: `NFE_PRODUCTION_ENABLED` (padrão `false`) na API e no worker. Com
ele desligado, uma empresa de produção que pede NF-e ou NFC-e recebe `422 NFE_PRODUCTION_DISABLED`, e o painel
avisa e deixa o botão de emitir desligado (o **Validar** continua). Como ligar a produção: veja "Produção por
estado" abaixo.

O monitor de conexão e a chave da SVC olham todos os estados (NF-e) e os estados com endereço de NFC-e
(hoje SP), em homologação, e também em produção quando `NFE_PRODUCTION_ENABLED=true`.

## Roteiro de homologação completo (aceite do PR 7)

Faça tudo em **SP** e numa UF da **SVRS**, com empresa `test` e `NFE_PRODUCTION_ENABLED=false`. Cada passo
vale pelo painel, pela API e pelo MCP; o roteiro abaixo usa o painel e diz a rota equivalente.

1. **Status do serviço.** Veja a seção "Status do serviço" acima (`cStat=107`).
2. **Emissão autorizada com CSOSN 102 e outra com 400.** Painel: **NF-e > Nova NF-e**, clique em
   **Validar** (esperado: "Tudo certo", com a chave da nota, sem gastar número) e em **Emitir NF-e**. Na
   segunda nota escolha CSOSN 400 no item. Esperado: `queued`, `processing`, `authorized` e, pouco depois,
   o DANFE e o XML liberados. API: `POST /v1/invoices/validate` e `POST /v1/invoices` com
   `type: "nfe"` e `Idempotency-Key`. MCP: `nfe_validate` e `nfse_issue` com `type: "nfe"`.
3. **Rejeição proposital.** Emita com um NCM que o SEFAZ recuse (por exemplo `00000000`). Esperado:
   `rejected`, com `cStat`, `xMotivo` e uma dica. No detalhe da nota, **Corrigir e reenviar** abre o
   formulário preenchido; ao reenviar, a nota mantém o mesmo número (`PUT /v1/invoices/{id}`). Outra
   nota rejeitada: **Descartar** (e inutilize o número no passo 5).
4. **Consulta pela chave depois de perder a resposta.** Emita e **mate o worker logo depois do envio**.
   Esperado: a nota fica `processing` ou `reconciliation_required` com a mesma chave; ao voltar, a
   conferência pergunta à SEFAZ pela chave e adota o protocolo, sem número novo e com um único webhook
   `nfe.document.authorized`. O botão **Conferir na SEFAZ** (`POST /v1/invoices/{id}/sync`) faz a
   mesma pergunta na hora.
5. **Cancelamento, duas CC-e e inutilização.** Siga a seção "Eventos" acima: **Cancelar nota** (justificativa
   de 15 a 255 caracteres), duas **Cartas de correção** na mesma nota (`sequence` 1 e 2) e, em
   **NF-e > Números pulados**, **Inutilizar faixa** com a justificativa. Esperado: eventos `registered`,
   nota `cancelled`, inutilização `homologada` (cStat 102) e a faixa some da lista.
6. **Produção fechada** (`NFE_PRODUCTION_ENABLED=false`): no painel, troque para **PRODUÇÃO** e abra **Nova NF-e**.
   Esperado: o aviso "A NF-e em produção ainda não está liberada", sem o aviso de homologação, e o botão de
   emitir desligado. Pela API, uma chave live responde `422 NFE_PRODUCTION_DISABLED`.
7. **Anote no relatório** ([`nfe-spike.md`](../nfe-spike.md)) o que diferiu de uma UF para a outra.

Só depois de os passos 1 a 6 passarem, pense em produção (seção "Produção por estado").

## Conferir os endereços

O script `api/scripts/nfe-check-endpoints.ts` testa as 12 autoridades (10 SEFAZ próprias, SVAN e SVRS) e
imprime uma tabela. Ele nunca imprime senha, PFX nem XML.

```bash
cd api
# Sem certificado: só confere se o servidor da SEFAZ responde (DNS, TCP e TLS)
yarn ts-node -r tsconfig-paths/register scripts/nfe-check-endpoints.ts

# Com certificado: chama também o NfeStatusServico4 e mostra cStat/xMotivo
NFE_SPIKE_PFX_PATH=/caminho/empresa.pfx NFE_SPIKE_PFX_PASSWORD='...' \
  yarn ts-node -r tsconfig-paths/register scripts/nfe-check-endpoints.ts
```

- Por padrão olha a homologação. `NFE_CHECK_TP_AMB=1` olha a produção (só pergunta o status, não envia nota).
- `NFE_CHECK_ONLY=SP,SVRS` limita a algumas autoridades.
- "TLS ok" ou "alcançou (alerta TLS...)" quer dizer que o servidor está no ar. Algumas SEFAZ (AM, MG, PR)
  recusam a conexão sem certificado, então para elas só o teste com certificado confirma de verdade
  (esperado `cStat=107`).
- `FALHOU` (DNS, timeout ou conexão recusada) quer dizer endereço errado ou SEFAZ fora do ar: não ligue a UF.

Qual autoridade atende cada UF: SEFAZ própria em AM, BA, GO, MG, MS, MT, PE, PR, RS e SP; SVAN no MA;
SVRS em todas as outras (AC, AL, AP, CE, DF, ES, PA, PB, PI, RJ, RN, RO, RR, SC, SE, TO). As tabelas ficam
em `api/src/infra/external/nfe/sefaz/uf.ts` e `endpoints.ts`, com a data da última conferência. Os
endereços de contingência (SVC-AN e SVC-RS) já estão mapeados por UF, mas ainda não são usados.

## Produção por estado

Fluxo recomendado com uma empresa parceira:

1. O parceiro cria a conta e a empresa em ambiente de **teste** (empresa `test`), com certificado A1.
2. Rode o roteiro de homologação completo abaixo na UF dele. Só siga se os passos 1 a 6 passarem.
3. Com a UF aprovada, ligue a produção: `NFE_PRODUCTION_ENABLED=true` na API e no worker. É um interruptor
   só, para todas as contas e estados (não há mais tabela por estado): ligue só quando todos os estados que
   os clientes usam estiverem conferidos.
4. O parceiro cria a empresa de produção. A primeira nota real deve ser acompanhada de perto.
5. Para parar tudo: `NFE_PRODUCTION_ENABLED=false`.

## Atualizações periódicas

- **Cadeia ICP-Brasil**: a cada 3 meses, `scripts/update-icp-brasil-chain.sh` (lembrete em
  `docs/fiscal/fiscal-dates.json`).
- **Schemas XSD**: ver a lista oficial a cada Nota Técnica nova; passo a passo em
  `api/src/infra/external/nfe/sefaz/schemas/README.md`.
