# NF-e em homologação (runbook)

Roteiro de homologação da NF-e: status do serviço, spike, eventos, como liberar um cliente e um estado, e o roteiro completo de aceite (SP e uma UF da SVRS).

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

## Liberar um cliente e um estado

A NF-e só aparece quando as **três** coisas valem: `NFE_ENABLED=true` no ambiente da API e do worker, o
cliente liberado e a UF dele liberada.

1. **Cliente (conta).** Pelo painel da plataforma: **Admin > Usuários > (usuário) > Liberar NF-e**, com um
   motivo de 5 a 500 caracteres (fica na auditoria como `nfe_access_changed`). O mesmo botão desliga.
   Pela API, como administrador da plataforma: `PUT /v1/platform/tenants/{tenantId}/nfe-access` com
   `{ "enabled": true, "reason": "..." }`. Se preferir SQL (por exemplo numa instalação self-hosted sem o
   painel de admin):

   ```sql
   UPDATE tenants SET nfe_enabled_at = now() WHERE id = '<tenant-id>';
   -- desligar: nfe_enabled_at = NULL
   ```

   A API guarda a resposta por até 1 minuto; depois disso o painel mostra a NF-e na conta.
2. **Estado (UF).** Só depois de a UF passar pelo roteiro abaixo:

   ```sql
   INSERT INTO nfe_enabled_authorities (uf, model, tp_amb, enabled_at, runbook_ref)
   VALUES ('SP', 55, 2, now(), 'docs/fiscal/runbooks/nfe-homologacao.md');
   ```

   `tp_amb = 2` é homologação. Linha com `tp_amb = 1` (produção) não adianta enquanto
   `NFE_PRODUCTION_ENABLED=false`. Para tirar a UF: `DELETE` da linha.
3. **Empresa.** A empresa `test` precisa de endereço completo, IE e CRT (painel, página da empresa, seção
   NF-e, ou `PUT /v1/companies/{id}/nfe-settings`) e do certificado A1.

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
6. **Com a liberação desligada** (botão **Desligar NF-e**, ou `NFE_ENABLED=false`): o item NF-e some do
   menu, as páginas `/app/nfe` mostram "sem acesso", as rotas de NF-e respondem 404 e as ferramentas
   `nfe_*` somem do MCP. A NFS-e segue igual.
7. **Anote no relatório** ([`nfe-spike.md`](../nfe-spike.md)) o que diferiu de uma UF para a outra.

Só depois de os passos 1 a 6 passarem numa UF, libere essa UF para os clientes (seção anterior).

## Atualizações periódicas

- **Cadeia ICP-Brasil**: a cada 3 meses, `scripts/update-icp-brasil-chain.sh` (lembrete em
  `docs/fiscal/fiscal-dates.json`).
- **Schemas XSD**: ver a lista oficial a cada Nota Técnica nova; passo a passo em
  `api/src/infra/external/nfe/sefaz/schemas/README.md`.
