# Fixtures da Eduzz

Montados a partir dos **exemplos da documentação** (https://developers.eduzz.com/reference/webhook/myeduzz-invoice-paid, `-refunded` e `-chargeback`), **não** de uma captura real. Mudanças em relação ao exemplo da doc: `buyer.document` trocado por um CPF válido de teste (o da doc não é um CPF); `gains` e `fees` (documentados só na página de "reembolsada") foram copiados também para o evento de pago; `refund`/`refundedAt` no reembolsado e `chargeback` no chargeback vêm das páginas respectivas. **A confirmar com uma venda real** (ou o teste do Console da Eduzz) antes de produção:

- Autenticação: cabeçalho `x-signature` = HMAC-SHA256 do corpo com a chave secreta criada no Console (https://developers.eduzz.com/docs/webhook/security). A codificação do resultado (hex) não está explícita na doc; aceitamos hex e base64.
- `data.gains.producer` no evento de pago (opção "minha parte"); sem ele a venda vai para atenção.
- Valores em reais, como número (ex.: 301.5), convertidos para centavos.
- `data.status` do chargeback chega como `paid` na doc; quem manda é o evento.
- `myeduzz.invoice_canceled`, reembolso e chargeback viram cancelamento; reembolso parcial (`refund.type` = `partial`) é ignorado.
- Endereço: `state` no exemplo é texto livre ("Estado"); só usamos UF de 2 letras. País "Brasil".
- `sellerIssuesInvoice` é sempre verdadeiro: a doc não traz campo sobre quem emite a nota.
