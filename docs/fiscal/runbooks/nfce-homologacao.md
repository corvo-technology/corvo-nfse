# NFC-e em homologação (runbook)

Como testar e acompanhar a NFC-e (venda ao consumidor, modelo 65). Ela usa a mesma máquina da NF-e
([`nfe-homologacao.md`](./nfe-homologacao.md)): o status do serviço, o spike e a conferência dos endereços
valem igual. Aqui está só o que é da NFC-e. Tudo em **homologação** (`tpAmb = 2`), começando por **SP**.

## O que a NFC-e precisa

- **Nada para liberar em teste.** Toda conta emite NFC-e em homologação, sem variável, coluna por cliente ou
  tabela de estados. O código só atende os estados que têm endereço de NFC-e (`ENDPOINTS_65` e `NFCE_URLS`,
  hoje **SP**); outro estado responde `422 UF_NOT_ENABLED` até ganhar a linha nessas tabelas.
- **Produção fechada.** `NFE_PRODUCTION_ENABLED=false` também trava o modelo 65 (`NFE_PRODUCTION_DISABLED`);
  é o mesmo interruptor da NF-e.
- **Sem CSC.** A Corvo só usa o QR Code v3 (online): não pede CSC nem id do CSC, e as colunas
  `nfce_csc_id` e `nfce_csc_encrypted` ficam vazias.
- **Responsável técnico.** Reaproveita `NFE_RESP_TEC_CNPJ|CONTACT|EMAIL|PHONE`; sem as quatro, o grupo
  `infRespTec` é omitido.
- **Série própria.** `company_nfe_settings.nfce_default_series` (padrão 1), pelo painel (página da empresa,
  seção NF-e), por `PUT /v1/companies/{id}/nfe-settings` (`nfceDefaultSeries`) ou pelo MCP.

## Credenciamento da IE em SP

A inscrição estadual (IE) da empresa precisa estar **credenciada para emitir NFC-e** na SEFAZ do estado. É um
passo da empresa (ou do contador), feito uma vez, no site da SEFAZ. Sem ele a SEFAZ recusa as notas.

1. A empresa (ou o contador) entra no portal da NFC-e de SP (`https://www.nfce.fazenda.sp.gov.br`) com o
   certificado e abre o menu **Credenciamento**. **[não verificado]**: o nome exato do menu vem de material da
   SEFAZ-SP; confirme na tela.
2. Peça o credenciamento para o **ambiente de homologação** (e, mais tarde, para o de produção).
3. Anote a data e quem fez. Sem credenciamento, espere rejeição de credenciamento na primeira nota.
4. Em outros estados o caminho muda. Em SC, por exemplo, o credenciamento pode vir pela autorização do
   desenvolvedor do sistema emissor **[não verificado]**; se valer onde você for ligar, a Corvo pode precisar se
   cadastrar como desenvolvedor do emissor naquele estado.

## Quem pode emitir

Toda conta, em homologação, para empresas de SP. Não há tela, rota de admin nem SQL de liberação.

A empresa `test` precisa de endereço completo, IE (credenciada), CRT e certificado A1, como na NF-e, e da
série da NFC-e se não for a 1.

A **segunda UF** (as que a SVRS atende no modelo 65) **fica sem endereço** até haver fonte oficial da tabela de
UFs e das URLs do QR Code dela: a lista de quem tem ambiente próprio em NFC-e (SP, PR, MG, GO, MT, MS e AM)
veio de fonte secundária. Não invente.

## Roteiro de homologação (SP)

Empresa `test`, `NFE_PRODUCTION_ENABLED=false`. Cada passo vale pelo painel (**Nova nota > Venda ao consumidor
(NFC-e)**), pela API (`type: "nfce"`) e pelo MCP (`nfse_issue` com `type: "nfce"`).

1. **Validar.** Clique em **Validar** (ou `POST /v1/invoices/validate`). Esperado: "Tudo certo" com a chave da
   nota (modelo `65` nas posições 21 e 22), sem gastar número.
2. **Autorizar sem consumidor.** Uma venda de poucos reais, sem CPF, `indPres` 1, pagamento em Pix. Esperado:
   `queued`, `processing`, `authorized`; depois o DANFCE de 80 mm, o XML e o QR Code. `qrCode` e `urlChave`
   aparecem na nota.
3. **Autorizar com CPF e com cartão.** Outra venda com CPF e pagamento em cartão (`tPag` 03, `card.tBand`).
4. **Consultar.** `GET /v1/invoices/{id}` e o botão **Conferir na SEFAZ** (`POST /v1/invoices/{id}/sync`). Mate o
   worker logo depois do envio: a nota deve ficar `processing` ou `reconciliation_required` com a mesma chave e,
   ao voltar, ser adotada sem número novo e com um único webhook `nfce.document.authorized`.
5. **Cancelar dentro de 30 minutos.** Esperado: `cancelling`, depois `cancelled` e o webhook
   `nfce.document.cancelled`.
6. **Cancelar fora de 30 minutos.** Espere passar o prazo e tente de novo. Esperado: a SEFAZ recusa
   (cStat 501 **[verificar na homologação]**) e a resposta traz a dica "A NFC-e só pode ser cancelada em até
   30 minutos depois da autorização. Depois disso, fale com o contador.", com o webhook
   `nfce.document.cancellation_rejected`.
7. **Sem carta de correção.** `POST /v1/invoices/{id}/corrections` numa NFC-e responde `422`
   `INVOICE_OPERATION_NOT_SUPPORTED`.
8. **Inutilizar.** Descarte uma NFC-e rejeitada e inutilize o número com `POST /v1/invoices/inutilizations`
   (`type: "nfce"`). Esperado: `pending`, depois `homologada` (cStat 102), webhook `nfce.inutilization.completed`
   e a faixa some de `GET /v1/invoices/number-gaps?type=nfce`.
9. **DANFCE.** Baixe o de 80 mm e o A4 (`/pdf?layout=a4`). Confira o QR Code lendo com o celular.
10. **Produção fechada** (`NFE_PRODUCTION_ENABLED=false`): no painel, em **PRODUÇÃO**, a **Nova nota** de consumidor
    mostra "A NFC-e em produção ainda não está liberada" e o botão de emitir fica desligado; pela API, uma chave
    live responde `422 NFE_PRODUCTION_DISABLED`.

Só depois dos passos 1 a 10 passarem em SP, pense em produção, pelo mesmo interruptor da NF-e.

## O que conferir nos itens "verificar na homologação"

Registre o resultado de cada um (e corrija o código se a SEFAZ discordar):

1. **Primeiro item em homologação.** O builder troca o `xProd` do item 1 por
   `NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL` (rejeição 373 se faltar). Confirme que a
   SEFAZ autoriza com esse texto e que o item guardado na Corvo e a NF-e não mudam.
2. **Nome do destinatário em homologação.** Com CPF informado, o `xNome` vira o texto fixo de homologação.
   Confirme que essa regra vale só quando existe `dest`.
3. **XSD e `infNFeSupl`.** O schema do `enviNFe` 4.00 deve aceitar o modelo 65 e o `infNFeSupl` (QR Code v3 e
   `urlChave`) sem ajuste. Se não aceitar, o validador local falha antes do envio.
4. **QR Code v3 sem CSC.** Confirme que a SEFAZ-SP autoriza a nota sem CSC e que as URLs do QR e da consulta por
   chave (`urlChave`) da tabela por UF abrem a nota.
5. **`idDest`.** Na NFC-e vale sempre `1` (operação interna). Confirme.
6. **Cancelamento.** O cStat de "fora do prazo" (501) e a mensagem exata, para a dica ficar certa.
7. **Cartão e Pix.** Os `tPag` aceitos e o que a SEFAZ exige em `card` (integrado ou não) para Pix e cartão.
8. **`indPres` 4.** A SEFAZ exige o destinatário completo (rejeição 787) e, a partir de agosto de 2026, o
   endereço em toda venda não presencial **[não verificado]**: confira com uma venda de entrega.
9. **Limite do CPF.** O limite de R$ 10.000,00 vale em SP? A tabela por UF começa vazia e usa o padrão.

## Contingência off-line (tpEmis 9)

A NFC-e off-line sai com `contingency: "offline"` (ou pela opção da empresa `nfceAutoOffline`, desligada por
padrão) e é transmitida depois, em até 24 horas. O QR Code v3 off-line é assinado com o A1 (RSA SHA-1, base64);
o algoritmo, a fonte e o que **não** está confirmado estão em [`docs/fiscal/nfce-qrcode.md`](../nfce-qrcode.md).

Antes de liberar em produção, na homologação de SP:

1. **Assinatura do QR Code.** Emita uma NFC-e off-line e transmita. A SEFAZ rejeita com 583 se a assinatura
   diferir da calculada (445 se vier assinatura numa nota normal, 474 se faltar na contingência). Se vier 583,
   o ponto a conferir é o texto assinado (o `|` entre os campos 6 e 7 vazios, o formato de `vNF`).
2. **`xJust` e `dhCont`.** Confirme que a SEFAZ aceita os textos `SEFAZ indisponivel` e
   `Sem comunicacao com a SEFAZ` (15 a 256 caracteres).
3. **Prazo.** Uma nota transmitida depois de 24 h volta com `cStat` 150 (autorizada fora do prazo); a Corvo
   trata 150 como autorização.
4. **Rejeição depois da entrega.** Corrija só os campos livres (`PUT /v1/invoices/{id}`): a chave não muda. Se
   a rejeição não puder ser corrigida assim, o caso é do contador do cliente.
5. **Alerta de 20 h.** O webhook `nfce.contingency.deadline_near` sai uma vez, 20 h depois do `dhCont`, só
   para nota que ainda não foi transmitida. O e-mail ao dono da conta sai só em produção.

Quem decide ligar a opção automática é a empresa (painel, "Emitir em contingência off-line automaticamente"):
a nota já está com o consumidor e pode ser rejeitada depois.

## Inutilização em SP: pendência

A inutilização continua **sendo sugerida** (lacunas e número perdido) até o contador confirmar os Ajustes
SINIEF 38/2026 e 40/2026, que podem mudar a regra em SP. Nenhum código muda por isso. Quando o contador
confirmar, registre aqui a decisão e a data.

## Produção por estado

Igual à NF-e ([`nfe-homologacao.md`](./nfe-homologacao.md), "Produção por estado"): `NFE_PRODUCTION_ENABLED=true`.

Só depois de o credenciamento de produção, o roteiro acima e uma empresa parceira acompanhando a primeira
nota real. Para parar tudo, `NFE_PRODUCTION_ENABLED=false`.
