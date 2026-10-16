# Exemplos de cálculo pré-emissão

Revisão: 2026-10-15. O endpoint `POST /v1/invoices/calculate` está sempre
disponível para API key/sessão autenticada com `nfse.invoices.issue`.
Usa o mesmo rate limit autenticado dos demais endpoints: por padrão,
`RATE_LIMIT_AUTHENTICATED=300` por minuto por API key/sessão, com os limites
globais existentes. Nenhum exemplo de cálculo emite nota,
consome crédito, reserva DPS ou cria agendamento. Os valores são pré-emissão e
podem divergir da validação final da Sefin.

Use uma **chave de teste** do tenant e substitua os UUIDs pelos IDs reais. Os
requests abaixo usam `https://api.corvo.tech`; para API local, substitua a origem.
Datas de 2026 são cenários de referência; datas futuras só são aceitas até
`OUTBOX_SCHEDULE_MAX_DAYS` (15 dias por padrão), mesmo sem `options.type`.
A consulta de perfis sempre usa a competência informada.

```sh
export CORVO_API_KEY='sua-chave-corvo_test'
export COMPANY_MEI_ID='11111111-1111-4111-8111-111111111111'
export COMPANY_REGULAR_ID='22222222-2222-4222-8222-222222222222'
export COMPANY_SIMPLES_ID='33333333-3333-4333-8333-333333333333'
```

As três empresas precisam existir nesse tenant/ambiente, com
`municipalityCode: '3550308'`. Cálculo não exige certificado ou empresa pronta
para emissão. Não use os documentos sintéticos abaixo para cadastro real.
O CPF `10000000019` foi gerado e conferido com `isValidCpf` do repositório;
o CNPJ `11222333000181` foi conferido com `isValidCnpj`.

## Perfis fiscais necessários

As chamadas de configuração exigem `nfse.companies.manage`. Para empresas novas,
as vigências abaixo devem cobrir a competência; não sobreponha vigências já
aprovadas. `GET /v1/companies/{id}/fiscal-profile` lista o histórico.
`confirm: true` aprova a vigência pelo ator autenticado. Estes exemplos são para
o ambiente `test`; não substituem revisão fiscal para `live`.

```sh
curl --request PUT "https://api.corvo.tech/v1/companies/$COMPANY_MEI_ID/fiscal-profile" \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"taxRegime":"MEI","simpleNational":true,"validFrom":"2026-01-01","confirm":true}'

curl --request PUT "https://api.corvo.tech/v1/companies/$COMPANY_REGULAR_ID/fiscal-profile" \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"taxRegime":"LUCRO_PRESUMIDO","simpleNational":false,"validFrom":"2026-01-01","confirm":true}'

curl --request PUT "https://api.corvo.tech/v1/companies/$COMPANY_SIMPLES_ID/fiscal-profile" \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"taxRegime":"SIMPLES_NACIONAL","simpleNational":true,"validFrom":"2026-01-01","confirm":true}'
```

## Barbearia MEI sem tomador (`060101`)

Pré-requisito: perfil **MEI**, vigente em 2026; operação `SERVICE`, sem retenções
ou tratamento especial configurados. Sem perfil de serviço, o catálogo pode
resolver a classificação parcial permitida ao MEI em 2026. Não informar códigos
NBS/CST/cClassTrib para barbearia sem uma fonte fiscal confirmada.

```sh
curl --request POST 'https://api.corvo.tech/v1/invoices/calculate' \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "{\"companyId\":\"$COMPANY_MEI_ID\",\"service\":{\"code\":\"060101\",\"description\":\"Corte de cabelo\",\"municipalityCode\":\"3550308\"},\"amount\":50,\"competenceDate\":\"2026-10-13\"}"
```

Recorte esperado do HTTP 200 (os campos de classificação, aplicabilidade,
cálculo, warnings e trace também estão na resposta):

```json
{
  "data": {
    "preEmission": true,
    "status": "ready",
    "disclaimer": "Pre-emission calculation. Values are not a fiscal document and may differ from the final validation by Sefin.",
    "competenceDate": "2026-10-13",
    "taxRegime": "MEI",
    "taxes": {},
    "withholdings": [],
    "netReceivableAmount": "50.00",
    "collectionWaived": false,
    "pendingFields": [],
    "blocking": null
  }
}
```

`taxes: {}` indica ausência de tributos destacados nesse cenário; não invente
ISS/IBS/CBS iguais a zero na interface. Consulte as razões em `applicability`.

## Barbearia MEI com cliente CPF válido

Pré-requisito: o mesmo perfil **MEI** anterior. O CPF sintético passa na
validação de dígitos; a resposta de cálculo não ecoa documento nem nome.

```sh
curl --request POST 'https://api.corvo.tech/v1/invoices/calculate' \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "{\"companyId\":\"$COMPANY_MEI_ID\",\"customer\":{\"taxId\":\"10000000019\",\"name\":\"Cliente de teste\",\"address\":{\"city\":\"São Paulo\",\"state\":\"SP\",\"municipalityCode\":\"3550308\"}},\"service\":{\"code\":\"060101\",\"description\":\"Corte de cabelo\"},\"amount\":50,\"competenceDate\":\"2026-10-13\"}"
```

Esperado: 200, `status: ready`, `taxes: {}`, líquido `50.00`, sem retenções.

## Consultoria (`010601`) com CNPJ válido e códigos reais da Calculadora RTC

Pré-requisito: perfil **LUCRO_PRESUMIDO**, competência coberta, Calculadora RTC
local/privada disponível e classificação conferida. Os códigos abaixo vêm
integralmente do fixture [ok-consultoria-2026.json](rtc/fixtures/ok-consultoria-2026.json):
NBS `115011000`, CST `000`, cClassTrib `000001`, cIndOp `100301`.
Não reutilize esses códigos para barbearia ou outros serviços.

Configure um perfil de serviço no catálogo real `service-tax-profiles`
(o caminho `fiscal-services` não existe). A alíquota de ISS de 3% abaixo é uma
**configuração de cenário de teste**, não uma indicação da alíquota municipal
correta. Para cadastro real, o responsável fiscal deve confirmar ISS e retenções.
A política `NONE_CONFIRMED` também é pré-condição do cenário, não uma conclusão
sobre toda consultoria com tomador PJ.

```sh
curl --request POST "https://api.corvo.tech/v1/companies/$COMPANY_REGULAR_ID/service-tax-profiles" \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"name":"Consultoria TI - cenário de teste","serviceCode":"010601","nbsCode":"115011000","cst":"000","classCode":"000001","operationIndicator":"100301","operationNature":"SERVICE","regimeApplicability":["LUCRO_PRESUMIDO"],"incidenceMunicipalityCode":"3550308","issTaxation":"NORMAL","issRate":"3.00","issWithholdingDefault":false,"withholdingPolicy":"NONE_CONFIRMED","effectiveFrom":"2026-01-01"}'
```

O exemplo usa `2026-10-13`, competência já passada na revisão deste documento.
O fixture foi capturado com `2026-12-10`; essa data futura ultrapassa 15 dias em
15/10/2026 e, portanto, não deve ser copiada para o endpoint nessa data.
A combinação de classificação foi obtida do fixture real; a validação do motor
continua usando a competência do request. Os valores exatos dependem dessa data,
dos perfis e das versões carregadas, não devem ser copiados do fixture de dezembro.

```sh
export CONSULTING_PROFILE_ID='55555555-5555-4555-8555-555555555555'
curl --request POST 'https://api.corvo.tech/v1/invoices/calculate' \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "{\"companyId\":\"$COMPANY_REGULAR_ID\",\"customer\":{\"taxId\":\"11222333000181\",\"name\":\"Tomador PJ de teste\",\"address\":{\"city\":\"São Paulo\",\"state\":\"SP\",\"municipalityCode\":\"3550308\"}},\"service\":{\"code\":\"010601\",\"description\":\"Consultoria TI\",\"municipalityCode\":\"3550308\",\"serviceProfileId\":\"$CONSULTING_PROFILE_ID\",\"fiscal\":{\"nbsCode\":\"115011000\",\"cst\":\"000\",\"classCode\":\"000001\",\"operationIndicator\":\"100301\"}},\"amount\":1000,\"competenceDate\":\"2026-10-13\"}"
```

O curl usa `service.serviceProfileId` para carregar os defaults de ISS/retenções
junto ao override `service.fiscal`. Copie `data.id` retornado ao criar o perfil
para `CONSULTING_PROFILE_ID` antes de executar. Overrides só completam campos do perfil **explicitamente**
selecionado; sem o ID, omita `service.fiscal` para resolver o perfil pelo código.
Assim o perfil acima fornece classificação/ISS/retenções em conjunto. Falha de
catálogo/Calculadora RTC retorna 503 com `Retry-After`; não estimar valores.

## Simples Nacional (`060201`)

Pré-requisito: perfil **SIMPLES_NACIONAL** em 2026, serviço `SERVICE` sem retenções
especiais, sem opção efetiva pelo regime regular. Nenhum NBS/CST/cClassTrib foi
presumido para esse serviço.

```sh
curl --request POST 'https://api.corvo.tech/v1/invoices/calculate' \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "{\"companyId\":\"$COMPANY_SIMPLES_ID\",\"service\":{\"code\":\"060201\",\"description\":\"Serviço de estética\",\"municipalityCode\":\"3550308\"},\"amount\":100,\"competenceDate\":\"2026-10-13\"}"
```

Esperado: 200 `ready`, `taxes: {}` e líquido `100.00` nessas pré-condições.
As regras de MEI/Simples de 2027 continuam fora do escopo e bloqueadas.

## Bloqueio com campo pendente (tomador obrigatório)

Pré-requisito: perfil **LUCRO_PRESUMIDO** vigente e perfil de serviço de
consultoria cadastrado acima (sem override, resolvido pelo código). O request
omite o tomador de propósito:

```sh
curl --request POST 'https://api.corvo.tech/v1/invoices/calculate' \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "{\"companyId\":\"$COMPANY_REGULAR_ID\",\"service\":{\"code\":\"010601\",\"description\":\"Consultoria sem tomador\"},\"amount\":1000,\"competenceDate\":\"2026-10-13\"}"
```

Recorte esperado (HTTP 200, sem erro HTTP 422):

```json
{
  "data": {
    "preEmission": true,
    "status": "blocked",
    "taxes": {},
    "withholdings": [],
    "netReceivableAmount": null,
    "pendingFields": [{"field":"customer","reason":"This regime requires an identified customer (tomador) on the NFS-e"}],
    "blocking": {
      "code": "FISCAL_VALIDATION_FAILED",
      "message": "This regime requires an identified customer (tomador) on the NFS-e",
      "step": "TaxApplicabilityResolver",
      "category": "VALIDATION",
      "retryable": false,
      "details": {"fields":["customer"]}
    }
  }
}
```

Outro cenário: perfil de serviço regular com ISS `EXEMPT`, política federal
`NONE_CONFIRMED` e sem NBS/CST/cClassTrib/cIndOp; com tomador identificado,
`blocking.code` é `FISCAL_CLASSIFICATION_REQUIRED` e `pendingFields` lista
`service.fiscal.nbsCode`, `service.fiscal.cst`, `service.fiscal.classCode`,
`service.fiscal.operationIndicator`. Não simular isenção em cadastro real apenas
para obter esse bloqueio; é uma configuração isolada de teste.

## Produto físico ⇒ `OPERATION_DOCUMENT_UNSUPPORTED`

Pré-requisito: perfil **MEI** em 2026 e perfil de serviço de teste marcado
`operationNature: GOODS`. Esse cadastro serve para demonstrar o bloqueio; não
converte mercadoria em serviço e não inventa código NCM/NBS.

```sh
curl --request POST "https://api.corvo.tech/v1/companies/$COMPANY_MEI_ID/service-tax-profiles" \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"name":"Produto físico - cenário bloqueado","serviceCode":"060101","operationNature":"GOODS","regimeApplicability":["MEI"],"withholdingPolicy":"NONE_CONFIRMED","effectiveFrom":"2026-01-01"}'
```

Copie `data.id` do perfil retornado para a variável abaixo (seleção explícita
impede ambiguidade se a empresa tiver outro perfil `060101`):

```sh
export GOODS_PROFILE_ID='44444444-4444-4444-8444-444444444444'
curl --request POST 'https://api.corvo.tech/v1/invoices/calculate' \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "{\"companyId\":\"$COMPANY_MEI_ID\",\"service\":{\"code\":\"060101\",\"serviceProfileId\":\"$GOODS_PROFILE_ID\",\"description\":\"Produto físico\"},\"amount\":50,\"competenceDate\":\"2026-10-13\"}"
```

Esperado: HTTP 200, `preEmission: true`, `status: blocked`,
`blocking.code: OPERATION_DOCUMENT_UNSUPPORTED`, categoria `UNSUPPORTED`,
`retryable: false`. Operações `GOODS` e `MIXED` precisam de outro documento/módulo.

## Competência futura sem agendamento

Pré-requisito: perfil **SIMPLES_NACIONAL** e operação `SERVICE` efetivos na
data futura. O exemplo usa a empresa Simples para não selecionar o perfil
`GOODS` do exemplo anterior. Em 15/10/2026, 22/10/2026 cabe no
horizonte de 15 dias. Ajuste a data ao reproduzir o exemplo em outro dia.

```sh
curl --request POST 'https://api.corvo.tech/v1/invoices/calculate' \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "{\"companyId\":\"$COMPANY_SIMPLES_ID\",\"service\":{\"code\":\"060201\",\"description\":\"Serviço futuro\"},\"amount\":100,\"competenceDate\":\"2026-10-22\"}"
```

Nesse curl, o perfil utilizado é **SIMPLES_NACIONAL** da empresa
`COMPANY_SIMPLES_ID`, com vigência que inclui 22/10/2026. Não é necessário
`options.type`, e nenhum `scheduledFor` é retornado. No endpoint de **emissão**
`POST /v1/invoices`, competência futura continua exigindo `options.type: SCHEDULE`
e retorna 202 com `scheduledFor`; o contrato de emissão não muda.

## HTTP e limites

- `404 ERROR_COMPANY_NOT_FOUND`: empresa não pertence ao tenant/ambiente da chave.
- `422`: normalização inválida, inclusive horizonte de competência excedido
  (`schedule_horizon_exceeded` nos detalhes; códigos HTTP públicos `ERROR_*`).
- `429 ERROR_RATE_LIMIT_EXCEEDED`: aguarde `Retry-After` e respeite `X-RateLimit-*`.
- `503 ERROR_TAX_CALCULATION_UNAVAILABLE`: Calculadora RTC/integração indisponível;
  `Retry-After` em segundos, arredondado para cima, mínimo 1, padrão 5.
- `500`: mensagem genérica; use `requestId` para suporte.

O envelope HTTP é `{ statusCode, code, message, details?, requestId }`.
`blocking.code` usa o código de domínio sem `ERROR_`. Consulte
[contrato da API](../../api/FRONTEND_API.md), [limitações](limitations.md) e
[homologação](homologation.md). Estes exemplos não registram uma execução nem
homologação na Sefin; as únicas evidências de códigos RTC citadas são os fixtures.
