# Fixtures do Stripe

Montados a partir da documentação (docs.stripe.com, objetos Event, Charge e Dispute), **não** de uma captura real: os nomes de campo vêm da doc, os valores são inventados. Confirmar com webhooks reais do modo de teste antes de produção:

- Unidade de `amount`: centavos (a doc do Stripe diz "menor unidade da moeda"; para BRL, centavos).
- `charge.refunded` chega também em reembolso parcial; o conector só trata `refunded: true` (total) e ignora o resto.
- A assinatura (`Stripe-Signature: t=...,v1=...`) é calculada nos testes com um segredo inventado; nada aqui é uma chave real.
- Consultas com a chave restrita: `GET /v1/account`, `GET /v1/customers/{id}?expand[]=tax_ids`, `GET /v1/checkout/sessions?payment_intent=...&expand[]=data.line_items` e `GET /v1/invoices/{id}`. Confirmar o formato das respostas (`tax_ids.data`, `customer_details.tax_ids`, `line_items.data[].description`, `lines.data[]`) com a conta de teste.
- Em versões novas da API a charge pode não trazer o campo `invoice`; nesse caso a descrição vem só da Checkout Session (ou do padrão da regra/empresa).
