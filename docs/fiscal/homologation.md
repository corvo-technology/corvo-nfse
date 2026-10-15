# Homologação — Calculadora RTC (IBS/CBS)

Registro das versões da Calculadora RTC (Calculadora de Tributos do IBS/CBS,
`deploy/rtc-calculator`) homologadas contra o contrato da Corvo
(`docs/fiscal/rtc/README.md` + fixtures).

## Versões homologadas

| Data | Versão (app/db) | Ambiente | Como verificado | Resultado |
| --- | --- | --- | --- | --- |
| 2026-10-14 | `1.6.0/V0059` | local (`http://localhost:18080/api`) | `RTC_CALCULATOR_URL=http://localhost:18080/api yarn jest rtc-integration` — replay dos fixtures reais `ok-versao`, `ok-base-calculo-nfse-2026`, `ok-consultoria-2026`, `ok-reducao-60-2026` | PASS (4/4) |

O teste de contrato (`src/modules/invoice/infra/fiscal/rtc/rtc-contract.rtc-integration.spec.ts`)
fica `skip` sem `RTC_CALCULATOR_URL`; execute-o sempre que a Calculadora for
atualizada para confirmar que request/response continuam compatíveis antes de
subir a versão nova.
