# NF-e em homologação (runbook)

Este runbook cresce a cada PR da pilha de NF-e. Hoje ele cobre só o status do serviço e o spike.

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

## Atualizações periódicas

- **Cadeia ICP-Brasil**: a cada 3 meses, `scripts/update-icp-brasil-chain.sh` (lembrete em
  `docs/fiscal/fiscal-dates.json`).
- **Schemas XSD**: ver a lista oficial a cada Nota Técnica nova; passo a passo em
  `api/src/infra/external/nfe/sefaz/schemas/README.md`.
