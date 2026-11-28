# Fixtures do Asaas

Montados a partir de **exemplos da documentação** (docs.asaas.com), **não** de uma captura real: os nomes de campo vêm da doc, os valores são inventados (o CPF de `customer.json` é o do exemplo da doc).

- `payment-*.json`: formato de https://docs.asaas.com/docs/webhook-para-cobrancas (`id`, `event`, `dateCreated`, `account`, `payment`).
- `customer.json`: resposta de `GET /v3/customers/{id}` (https://docs.asaas.com/reference/recuperar-um-unico-cliente).

Confirmar com uma venda real no sandbox (api-sandbox.asaas.com) antes de produção:

- `payment.value` em reais (número), e que ele já é o valor efetivamente pago quando há juros/multa (a doc só diz que `originalValue` aparece quando o valor pago difere do original).
- Que `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` da mesma cobrança geram uma única nota (a mesma chave `asaas:<id>`).
- Que `PAYMENT_REFUNDED` chega num estorno total e liga à venda; `PAYMENT_PARTIALLY_REFUNDED` é ignorado.
- Se o `cityName` do cliente vem preenchido (o campo `city` é um código interno do Asaas, não o IBGE).
- Que a chave de API (`access_token`) lê `GET /v3/customers/{id}` e `GET /v3/customers?limit=1`.
