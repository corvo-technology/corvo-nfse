# Fixtures da Hotmart

Montados a partir da documentação (developers.hotmart.com, Webhook 2.0 de compra), **não** de uma captura real: os nomes de campo vêm da doc, os valores são inventados. **A confirmar com aviso real** (envie um teste pelo painel da Hotmart) antes de produção:

- Unidade de `full_price.value` e das comissões: reais, em número (ex.: 97.9). A conversão para centavos é arredondada.
- `data.commissions`: aceitamos lista ou objeto; o formato real não foi confirmado.
- Autenticação: cabeçalho `X-HOTMART-HOTTOK` (token fixo, sem HMAC). Os valores dos testes são inventados.
- `invoice_by` ("HOTMART" ou "SELLER") e `business_model` ("R" = a Hotmart emite).
- O comprador só vem se o checkout pedir; `document_type` de estrangeiro pode ser diferente de CPF/CNPJ.
- Webhook de afiliado não traz comprador nem `full_price`.
- `purchase.status` `PARTIALLY_REFUNDED` é tratado como reembolso parcial e ignorado.
