# Fixtures da Woovi

Montados a partir da documentação (developers.woovi.com, exemplo `webhook-charge-payload`), **não** de uma captura real:
os nomes de campo vêm da doc, os valores são inventados. Confirmar com um webhook real do sandbox antes de produção:

- `charge.value` em centavos (a doc da API de cobrança diz centavos; a página do evento não diz).
- `customer.taxID`: string ou objeto `{ taxID, type }` (o conector aceita os dois).
- Formato do evento de teste do cadastro do webhook (não documentado; o conector trata como teste qualquer corpo sem `event`).
- Eventos de reembolso (`PIX_TRANSACTION_REFUND_*`): formato não documentado, hoje ignorados.
