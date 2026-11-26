# Conector PushinPay (design)

Data: 2026-11-25. Gateway brasileiro (Pix, boleto, Pix recorrente). Igual à AbacatePay: tudo por webhook, sem chamar a API deles (limite de 1 requisição por minuto por conta).

## Autenticação

A PushinPay **não assina** os avisos. Usamos duas travas, sempre comparadas em tempo constante:

1. Segredo gerado por conexão na URL do webhook (`?webhookSecret=`), como a AbacatePay.
2. Token gerado por conexão, mostrado uma vez (`revealOnce`, como a Woovi), que o lojista cadastra no painel como cabeçalho personalizado `x-corvo-token`. Se a conexão tem token, os dois são exigidos.

O lojista informa a URL em `webhook_url` ao criar cada cobrança (Pix, boleto, recorrente) no sistema dele.

## Credenciais e conexão

Nenhuma credencial digitada. `validateConnection` não faz chamada; o `externalAccountId` é `pushinpay:` + hash do segredo gerado. O ambiente (teste/produção) vem da conexão, pois o aviso não traz essa informação.

## Leitura do aviso

Corpo: `id`, `value` (centavos), `status` (`created`, `paid`, `canceled`), `end_to_end_id`, `payer_name`, `payer_national_registration`; recorrente soma `subscription_id`, `installment_number`.

- `deliveryId` = `id:status` (reenvios, até 3, não duplicam).
- `paid` vira venda paga, `operationKey` `pushinpay:<id>`. Cada parcela recorrente tem `id` próprio e gera a própria nota.
- `canceled` vira reembolso ligado à venda pelo `transactionId` (`refersTo`). Se essa cobrança nunca foi paga, o tratador ignora (`refund_sale_not_found`).
- `created` é ignorado. Corpo sem `id`/`status` é teste.
- Valor em centavos, BRL. Tomador: nome e CPF/CNPJ do pagador (sem e-mail); documento ausente ou mascarado cai no fluxo "completar dados". Descrição: regra da conexão ou padrão da empresa. `occurredAt` = hora de recebimento (não há data de pagamento no aviso).
- `externalRefs`: `transactionId`, `endToEndId`, `subscriptionId` e `installmentNumber` quando houver.

## Limites da v1

- Disputas (MED): sem webhook, não tratadas.
- Reembolso parcial não se distingue: cancelamento após o pagamento conta como reembolso total.
- A PushinPay não envia e-mail do comprador; a nota não é enviada ao cliente automaticamente.

## Guia de configuração (3 passos)

1. Copie o endereço do webhook da Corvo e passe como `webhook_url` ao criar as cobranças.
2. No painel da PushinPay, defina o cabeçalho `x-corvo-token` com o token mostrado uma vez.
3. Envie um teste.

## Origem da nota

O prefixo `pushinpay:` aparece como "PushinPay" em `web/lib/invoice-origin.ts`. O `invoice-origin.ts` da API só distingue a origem (integração), sem mapa por plataforma, então não muda.
