# Fixtures da Pagar.me (API v5)

Montados a partir da documentação, **não** de uma captura real.

- `order-paid.json`: exemplo da documentação (docs.pagar.me/reference/exemplo-de-webhook-1), reduzido (sem `card` e `gateway_response`).
- `charge-chargedback.json`: exemplo da documentação (docs.pagar.me/page/chargeback-novo-status-na-cobrança), condensado.
- `order-paid-cnpj.json`, `charge-refunded.json`, `order-canceled.json`: montados a partir do formato documentado (pedido e cobrança); valores inventados.

Eventos: docs.pagar.me/reference/eventos-de-webhook-1.

**A confirmar com uma venda real:**

- Se o webhook leva `document_type` (CPF/CNPJ) e `address` no comprador (o exemplo da doc só mostra `document` e `type`).
- Autenticação: a documentação v5 não descreve assinatura nem usuário/senha do webhook. O conector exige o segredo na URL, confere o Basic Auth quando a chamada o traz e confere `X-Hub-Signature` (HMAC-SHA1 do corpo com a chave secreta) quando a chave é informada.
- Formato do `chargeback.received` (sem exemplo na doc): aceitamos `data.charge.id`, `data.charge_id` ou `data.id` de cobrança (`ch_...`).
- Se `charge.refunded` só vem em reembolso total (o parcial é `charge.partial_canceled`, ignorado).
