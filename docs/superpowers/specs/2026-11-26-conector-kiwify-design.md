# Conector Kiwify (vendas) - design

Data: 2026-11-26. Status: proposta. Mesmo molde dos conectores Woovi, AbacatePay e Stripe (`api/src/modules/integrations/connectors/`).

## Objetivo

Quem vende na Kiwify conecta o webhook ao Corvo. Cada compra aprovada vira uma NFS-e sozinha. Reembolso e chargeback ligam à venda pelo `order_id`; o cancelamento da nota segue a opção que já existe nas regras ("cancelar nota no reembolso"). Sem CPF/CNPJ (ou comprador estrangeiro), a venda cai no fluxo "completar dados".

## Fora do escopo (v1)

Vendas em que somos afiliado ou coprodutor; moedas que não sejam BRL; consultar a API da Kiwify (OAuth); reembolso parcial; eventos de período grátis.

## Segurança

Credenciais: `token` (secreto, o token que o cliente escolhe no webhook da Kiwify) e `webhookSecret` (gerado, vai na URL), os dois obrigatórios. A Kiwify assina o corpo cru com HMAC-SHA1 (chave = `token`, hex minúsculo) e manda em `?signature=`. O conector confere o segredo da URL e a assinatura com `timingSafeEqual`; sem `token`, rejeita. A assinatura não tem data: não há proteção de replay, então a entrega é identificada por `order_id:webhook_event_type` e o reenvio não duplica nada. A Kiwify não tem sandbox: o ambiente da conexão (teste/produção) decide, e o "Testar Webhook" manda dados fictícios (sem marca de teste), então o guia manda testar numa conexão de teste.

## Eventos

| `webhook_event_type` (+ `order_status`) | Resultado |
|---|---|
| `order_approved` (`paid`) | `paid`, emite a nota. Chave `kiwify:<order_id>` |
| `order_refunded` (`refunded`) | `refunded`, ligado pelo `order_id` (`refersTo`) |
| `chargeback` (`chargedback`) | `disputed`, ligado pelo `order_id`; só sinaliza |
| `subscription_*`, trial, boleto/pix gerado, recusada | ignorado |

Cada cobrança de assinatura tem `order_id` novo, então vira uma nota própria (a renovação paga manda `order_approved`; `subscription_renewed` é ignorado para não duplicar). Reembolso/chargeback de assinatura manda também `subscription_canceled`, ignorado. Se o payload trouxer `sale_type` diferente de `producer`, a venda é ignorada (`<evento>:not_producer`).

## Dados

- Confirmados pela doc: `order_id`, `order_ref`, `order_status`, `webhook_event_type`, `payment_method`, `approved_date` (Brasília), `subscription_id`, `Subscription`.
- A confirmar com aviso real do "Testar Webhook" (a doc não traz o interior de `Customer`, `Product` e `Commissions` no webhook): leitura tolerante em `kiwify.payload.ts`, com funções pequenas e testadas. Cliente: `Customer.full_name|name`, `email`, `CPF|cpf|CNPJ|cnpj`, `country`. Produto: `Product.product_id|id`, `product_name|name`. Valor em centavos: `Commissions.charge_amount` (ou `payment.charge_amount`, ou `product_base_price`); moeda `Commissions.currency` (sem moeda, BRL).
- Documento inválido, mascarado ou de comprador com país diferente de BR vira "sem documento": `customer_tax_id_missing` (completar dados), ou nota sem tomador se a regra permitir.

## Valor da nota

Opção da conexão, campo opcional `invoiceValue`: `total` (padrão, o que o comprador pagou) ou `mine` ("minha parte", `Commissions.my_commission`). Se escolher `mine` e o payload não trouxer a parte do produtor, o evento vai para atenção (`needs_attention`) para completar à mão; nunca cai silenciosamente no total. Guardado junto das credenciais da conexão (campo novo `optional`/`options` no manifesto).

## Onde mexe

Novo: `connectors/kiwify/`. Registrado em `app.module.ts`, `worker-app.module.ts` e `runtime-wiring.spec.ts`. Web: card e passo a passo (3 passos, sem afiliados/coprodução), seletor do valor, textos pt/en, docs, origem `kiwify:` = "Venda (Kiwify)". `.gitleaks.toml` libera os specs de teste.

## Testes

Assinatura HMAC calculada no teste (válida, errada, ausente, corpo alterado); aprovada gera nota; reembolso e chargeback ligam e cancelam só com a opção; reenvio não duplica; renovação com novo `order_id` gera nova nota; sem documento/estrangeiro completa dados; `mine` com e sem a parte; leitores tolerantes; fluxo em Postgres real.
