# Fixtures da Woovi

Montados a partir da documentação (developers.woovi.com, exemplo `webhook-charge-payload`), **não** de uma captura real:
os nomes de campo vêm da doc, os valores são inventados. Confirmar com um webhook real do sandbox antes de produção:

- `charge.value` em centavos (a doc da API de cobrança diz centavos; a página do evento não diz).
- `customer.taxID`: string ou objeto `{ taxID, type }` (o conector aceita os dois).
- Formato do evento de teste do cadastro do webhook (não documentado; o conector trata como teste qualquer corpo sem `event`).
- Reembolso (`refund-sent-confirmed.json`, `refund-legacy.json`): montados dos exemplos da doc (`PIX_TRANSACTION_REFUND_SENT_CONFIRMED` e o antigo `OPENPIX:TRANSACTION_REFUND_RECEIVED`), com valores inventados. **Confirmar com um reembolso real do sandbox:**
  - que `originalTransaction.endToEndId` do aviso de reembolso é igual a `pix.endToEndId` do `OPENPIX:CHARGE_COMPLETED` do mesmo pagamento (é assim que a Corvo liga o reembolso à venda; se não bater, o aviso fica `ignored` com `refund_sale_not_found` e nada é cancelado);
  - que `refundTransaction.partial` existe e vale `true` em reembolso parcial;
  - se o aviso antigo ainda é enviado.
