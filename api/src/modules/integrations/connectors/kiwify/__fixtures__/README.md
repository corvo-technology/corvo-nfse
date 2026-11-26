# Fixtures da Kiwify

Montados a partir da documentação (docs.kiwify.com.br: "Receber e validar webhooks", "Eventos de assinatura"), **não** de uma captura real.

Confirmado pela doc: `order_id`, `order_ref`, `order_status`, `webhook_event_type` (e a tabela de valores), `payment_method`, `approved_date` (horário de Brasília, `YYYY-MM-DD HH:mm`), `subscription_id` e o objeto `Subscription`. A assinatura (HMAC-SHA1 do corpo cru, chave = token, hex minúsculo em `?signature=`) tem vetor de teste na doc, usado em `kiwify.connector.spec.ts`.

**A confirmar com aviso real do "Testar Webhook"** (a doc não mostra o interior destes objetos no webhook; os nomes abaixo vêm da API de vendas e de variantes comuns, e o conector aceita as duas formas):

- `Customer`: `full_name` (ou `name`), `email`, `CPF`/`cnpj` (ou `cpf`/`CNPJ`/`document`), `mobile`, `country`.
- `Product`: `product_id` (ou `id`), `product_name` (ou `name`).
- `Commissions`: `charge_amount` (o que o comprador pagou), `product_base_price`, `my_commission` (parte do produtor), `currency`. Valores em centavos.
- `sale_type` na raiz (só existe na API de vendas, `producer`): se vier e não for `producer`, a venda é ignorada.

Todos os valores aqui são inventados.
