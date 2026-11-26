# Conector Hotmart (vendas) - design

Data: 2026-11-26. Status: proposta. Mesmo molde dos conectores Woovi, AbacatePay e Stripe (`api/src/modules/integrations/connectors/`).

## Objetivo

Quem vende pela Hotmart como produtor conecta a conta ao Corvo. Cada compra aprovada vira uma NFS-e sozinha. Reembolso e chargeback podem cancelar a nota (opção "cancelar nota no reembolso" que já existe). Sem CPF/CNPJ do comprador, a venda cai em "completar dados".

## Como a Hotmart avisa

Webhook 2.0: envelope `id`, `creation_date` (ms), `event`, `version`, `data`. Não há assinatura (HMAC): só o token fixo da conta (`hottok`) no cabeçalho `X-HOTMART-HOTTOK`. Se a nossa URL errar de forma repetida, a Hotmart desativa o webhook; por isso, depois de autenticar, sempre respondemos 2xx rápido (o processamento é assíncrono) e eventos que não tratamos voltam 2xx como "ignorado".

## Credenciais e segurança

- `hottok` (secreto): colado pelo cliente.
- `webhookSecret` (secreto, gerado, na URL): segredo da conexão.
- `invoiceValue` (opção, não secreta): "Valor da nota". `total` (padrão) ou `share` ("minha parte").

Os dois segredos são obrigatórios, comparados em tempo constante. Sem `hottok` correto ou sem segredo da URL: 401. A opção `invoiceValue` fica junto das credenciais (já cifradas e editáveis pela tela), sem tabela nova; é o único campo com `choices` no manifesto (extensão aditiva). `externalAccountId` = digest do `webhookSecret` (estável; a Hotmart não identifica a conta).

## Quando emite

Evento `PURCHASE_APPROVED` (ou `PURCHASE_COMPLETE`, a mesma operação, sem nota dobrada): chave `hotmart:<transaction>`. Só emite se:

- `invoice_by === 'SELLER'` e `business_model` diferente de `R`; senão a venda fica bloqueada com o motivo "o vendedor não emite" (a Hotmart emite esta nota);
- o payload tem comprador e `full_price` (payload de afiliado não tem: ignorado);
- moeda BRL (outra moeda: bloqueada, moeda não suportada);
- comprador no Brasil com CPF/CNPJ; estrangeiro ou documento de outro tipo vira "completar dados", nunca emite automático.

Não conferimos o CNPJ do produtor (`producer.document`) com o da empresa conectada: o conector não recebe esse dado da conexão. Coprodutor e afiliado só recebem webhook da própria conta; fica como melhoria.

## Valor

`total`: `full_price.value`. `share`: total menos comissões `COPRODUCER` e `AFFILIATE` (`commissions` aceito como lista ou objeto). Sem comissões legíveis, moeda diferente ou resultado <= 0: o evento vai para atenção (dados a completar) e não emite.

## Eventos de saída

- `PURCHASE_REFUNDED` (status `PARTIALLY_REFUNDED` é ignorado) e `PURCHASE_CHARGEBACK`: `refunded`, ligado à venda por `transaction`; cancela só se a regra tiver a opção ligada.
- `PURCHASE_PROTEST`: `disputed` (só sinaliza, não cancela).
- `CANCELED`, `EXPIRED`, `DELAYED`, `BILLET_PRINTED` e outros: ignorados.

Assinaturas: cada cobrança tem a própria `transaction`, uma nota por cobrança.

## Outros detalhes

`deliveryId` = `<transaction>:<event>`. `occurredAt` = `approved_date` (ms), senão `creation_date`. Sem flag de ambiente no payload: o ambiente vem da conexão. Descrição da nota: `product.name`; regra por produto usa `product.id`. Origem na lista de notas: prefixo `hotmart:` vira "Venda (Hotmart)".

## Guia na tela (3 passos)

1. Copie o endereço do Corvo e, na Hotmart, em Ferramentas > Webhook, cadastre-o para todos os produtos com os eventos: compra aprovada, compra completa, reembolso, chargeback e protesto.
2. Copie o seu hottok (mesma tela) e cole no Corvo.
3. Envie um teste. Atenção: o CPF/CNPJ do comprador só chega se o checkout pedir.

## Testes

Fixtures só com campos documentados (README: "a confirmar com aviso real"). Conector: autenticação, aprovado vendedor BR, invoice_by HOTMART, afiliado, estrangeiro, "minha parte", reembolso/chargeback, protesto, COMPLETE depois de APPROVED sem nota dobrada. Fluxo Postgres espelhando os outros. Web: card, guia, opção.
