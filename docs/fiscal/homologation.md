# Homologação — Calculadora RTC (IBS/CBS)

Registro das versões da Calculadora RTC (Calculadora de Tributos do IBS/CBS,
`deploy/rtc-calculator`) homologadas contra o contrato da Corvo
(`docs/fiscal/rtc/README.md` + fixtures).

## Versões homologadas

| Data | Versão (app/db) | Ambiente | Como verificado | Resultado |
| --- | --- | --- | --- | --- |
| 2026-10-22 | publicada: `1.6.0-0ea3a901/V0059`; offline: `1.6.0/V0059` | local (`http://localhost:18081/api`) | ZIP oficial com SHA-256 `7af792547d054d8613f4bbba6cfab0d51d12d674bb30ff94a9f6432f0da38c21`; `RTC_URL=http://localhost:18081/api sh api/scripts/rtc-smoke.sh`; `RTC_CALCULATOR_URL=http://localhost:18081/api yarn jest rtc-integration` | PASS (smoke + 4/4). A revisão publicada não é exposta pelo runtime offline do ZIP. |
| 2026-10-14 | `1.6.0/V0059` | local (`http://localhost:18080/api`) | `RTC_CALCULATOR_URL=http://localhost:18080/api yarn jest rtc-integration` — replay dos fixtures reais `ok-versao`, `ok-base-calculo-nfse-2026`, `ok-consultoria-2026`, `ok-reducao-60-2026` | PASS (4/4) |

O teste de contrato (`src/modules/invoice/infra/fiscal/rtc/rtc-contract.rtc-integration.spec.ts`)
fica `skip` sem `RTC_CALCULATOR_URL`; execute-o sempre que a Calculadora for
atualizada para confirmar que request/response continuam compatíveis antes de
subir a versão nova.

## Emissão com DPS pronta (cliente do SDK, transporte simulado)

| Data | Alvo | Como verificado | Resultado |
| --- | --- | --- | --- |
| 2026-10-15 | `OpenNfseProvider` com `preparedDps` (open-nfse `0.11.0`) | `yarn jest --config ./test/jest-fiscal.json test/fiscal-dps-emission` — SDK nativo, `MockAgent` no lugar da Sefin, `NfseClientFake`, Postgres local | PASS (9/9): assina em `dryRun` sem transmitir; timeout deixa resultado indeterminado e o `issue` seguinte consulta o status antes de reenviar (mesmo `infDPS.Id`, mesma assinatura); `Retry-After` do 429 é respeitado; rejeição permanente devolve a mensagem da Sefin; DPS inválida no XSD falha antes de transmitir; conciliação do XML autorizado contra o snapshot |

**Isto NÃO é homologação na Sefin.** O transporte é simulado.

## Produção Restrita da Sefin

| Cenário | Estado |
| --- | --- |
| MEI (tomador PF / PJ / sem tomador) | não executado |
| ME/EPP do Simples Nacional | não executado |
| Regime regular com `IBSCBS` | não executado |
| Municípios (ex.: São Paulo, Uberlândia) | não executado |

Pré-requisito: certificado A1 de teste e acesso à Produção Restrita. Registre aqui apenas o que for efetivamente executado (data, CNPJ de teste, município, resultado, evidência).

## Cálculo pré-emissão (`POST /v1/invoices/calculate`)

O endpoint reutiliza o motor fiscal e responde `ready`/`blocked` sem emitir.
Testes unitários e Postgres verificam o contrato, a ausência de gravações,
a paridade com o worker e o isolamento; os resultados reais da execução desta
entrega são registrados no PR. Eles não atestam aceite pela Sefin.

| Cenário externo | Estado nesta entrega |
| --- | --- |
| Cálculo pré-emissão comparado à NFS-e na Produção Restrita | não executado |
| Homologação fiscal de MEI/Simples 2027 | não executado; regras fora do escopo |

As evidências históricas da Calculadora RTC e do transporte simulado acima
permanecem com suas datas e resultados originais. Nenhuma execução externa nova
é presumida pela publicação de exemplos. Veja [exemplos](examples.md) e
[limitações](limitations.md).
