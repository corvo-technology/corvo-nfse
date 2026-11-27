# Fixtures do Mercado Pago

Exemplo da documentação, **não** uma captura real: os nomes de campo vêm da doc, os valores são inventados.

- `notification-*.json`: corpo do webhook de Pagamentos (developers.mercadopago.com, Notificações > Webhooks). Só traz o id do pagamento em `data.id`.
- `payment-*.json`: resposta de `GET /v1/payments/{id}` (referência da API de pagamentos). Os campos `payer.first_name`, `payer.last_name`, `additional_info.items` e `additional_info.payer.address` não aparecem no exemplo da doc; confirmar com uma venda real.
- Assinatura (`x-signature: ts=...,v1=...`): calculada nos testes com um segredo inventado; nada aqui é uma chave real.
- Confirmar com uma venda real: unidade de `transaction_amount` (reais, decimal), `user_id` do webhook igual ao `id` de `GET /users/me`, `quantity` dos itens como texto, e se o documento do comprador vem em `payer.identification`.
