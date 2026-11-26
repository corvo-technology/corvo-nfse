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

## Atualizações periódicas

- **Cadeia ICP-Brasil**: a cada 3 meses, `scripts/update-icp-brasil-chain.sh` (lembrete em
  `docs/fiscal/fiscal-dates.json`).
- **Schemas XSD**: ver a lista oficial a cada Nota Técnica nova; passo a passo em
  `api/src/infra/external/nfe/sefaz/schemas/README.md`.
