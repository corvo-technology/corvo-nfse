# Fixtures da AbacatePay

Montados a partir da documentação (docs.abacatepay.com, páginas de eventos `checkout` e `transparent`), **não** de uma captura real:
os nomes de campo vêm da doc, os valores são inventados. Confirmar com webhooks reais do modo dev antes de produção:

- Unidade de `amount`: o conector assume centavos (o SDK da AbacatePay documenta preço em centavos; a página do evento não diz).
- `amount` vs `paidAmount`: o conector usa `amount` (valor cobrado). Se houver acréscimo de cartão repassado ao cliente (`customerFee`), confirmar se `amount` o inclui.
- Upsell: é a mesma venda com itens a mais. O conector usa a mesma chave do checkout e não olha `isUpSell`; confirmar se o evento chega com o `amount` e os itens já somados.
- Autenticação: o painel mostra um campo Secret e fala em Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`), que a doc pública ainda não descreve. O conector aceita esse formato (HMAC-SHA256 de `id.timestamp.corpo` com o Secret da conexão, tolerância de 5 minutos) e o antigo (`?webhookSecret=` e, se `ABACATEPAY_WEBHOOK_PUBLIC_KEY` estiver definida, o HMAC de `X-Webhook-Signature`). Confirmar com um aviso real qual formato chega e como o Secret entra na chave.
- Evento de teste do cadastro do webhook (não documentado): o conector trata como teste qualquer corpo sem `event`.
- `taxId` chega mascarado nos eventos. O conector consulta `GET /v2/customers/get?id=` com a chave do cliente (`CUSTOMER:READ`) e usa o documento completo; confirmar que a resposta não vem mascarada.
- Descrição da nota: os itens trazem só `id` e `quantity`; o nome vem de `GET /v2/products/get?id=` (`PRODUCT:READ`). Confirmar que a resposta traz `name`.
