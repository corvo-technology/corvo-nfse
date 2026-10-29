# Fixtures da AbacatePay

Montados a partir da documentação (docs.abacatepay.com, páginas de eventos `checkout` e `transparent`), **não** de uma captura real:
os nomes de campo vêm da doc, os valores são inventados. Confirmar com webhooks reais do modo dev antes de produção:

- Unidade de `amount`: o conector assume centavos (o SDK da AbacatePay documenta preço em centavos; a página do evento não diz).
- `amount` vs `paidAmount`: o conector usa `amount` (valor cobrado). Se houver acréscimo de cartão repassado ao cliente (`customerFee`), confirmar se `amount` o inclui.
- Upsell: é a mesma venda com itens a mais. O conector usa a mesma chave do checkout e não olha `isUpSell`; confirmar se o evento chega com o `amount` e os itens já somados.
- Origem da chave pública do HMAC de `X-Webhook-Signature`: a doc só mostra a constante `ABACATEPAY_PUBLIC_KEY`. Enquanto a variável de ambiente `ABACATEPAY_WEBHOOK_PUBLIC_KEY` não estiver definida, só o `webhookSecret` da URL autentica o aviso.
- Evento de teste do cadastro do webhook (não documentado): o conector trata como teste qualquer corpo sem `event`.
- `taxId` chega mascarado nos eventos; o conector não consulta o documento completo (endpoint não confirmado).
