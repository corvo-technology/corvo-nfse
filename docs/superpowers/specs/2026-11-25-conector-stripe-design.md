# Conector Stripe (vendas) - design

Data: 2026-11-25. Status: proposta. Construído do mesmo jeito que os conectores Woovi e AbacatePay (`api/src/modules/integrations/connectors/`).

## Objetivo

Quem vende pela própria conta Stripe conecta essa conta ao Corvo. Cada pagamento aprovado vira uma NFS-e sozinho. Se o cliente pedir reembolso total, a nota pode ser cancelada (mesma opção "cancelar nota no reembolso" que já existe nas regras). Quando falta CPF/CNPJ, a venda cai no fluxo "completar dados" que já existe (`customer_tax_id_missing`).

Isto não tem relação com o Stripe que o Corvo usa para cobrar os próprios clientes (módulo `billing`). São coisas separadas: código, chaves e variáveis de ambiente diferentes.

## Fora do escopo

- Stripe Connect / OAuth (o cliente cola as chaves, como nos outros).
- Reembolso parcial automático (ver abaixo: só avisa).
- Moedas que não sejam BRL.
- Qualquer mudança no billing do Corvo.

## Como funciona (fluxo)

1. O cliente abre Integrações, escolhe "Stripe", cola a chave restrita e o `whsec_...`, e recebe o endereço do webhook (com o segredo da conexão na URL, igual aos outros).
2. No Stripe ele cria um endpoint de webhook com esse endereço e 3 eventos.
3. O Stripe chama o Corvo. A API confere a assinatura, guarda o evento e responde rápido.
4. O worker chama `parse` e `normalize`, monta uma `NormalizedOperation` e o `emission-planner` decide: emitir, bloquear ou pedir atenção. Nada muda aqui: o planner e o emissor são os mesmos.
5. Reenvio do mesmo evento não emite duas vezes (a chave da operação é `stripe_charge:<id>`).

## Credenciais e segurança

Campos do manifesto (`id: 'stripe'`, `supportedFlows: ['charge']`):

- `apiKey` (secreto): chave restrita `rk_...`, só leitura em Charges, Customers, Checkout Sessions e Invoices.
- `webhookSigningSecret` (secreto): o `whsec_...` do endpoint.
- `webhookSecret` (secreto, `generate: true`, `inWebhookUrl: true`): segredo da conexão na URL, igual ao AbacatePay.

Autenticação do webhook (`authenticate`), tudo obrigatório:

1. Segredo da URL confere, com comparação em tempo constante.
2. Cabeçalho `Stripe-Signature` (`t=...,v1=...`): HMAC-SHA256 de `t.corpoCru` com o `whsec`, aceita qualquer `v1` da lista, tolerância de 300 s no `t` (mesmo limite do AbacatePay), `timingSafeEqual`. Usa o corpo cru, nunca o JSON re-serializado.

`validateConnection`: chama `GET /v1/account` com a chave. Chave recusada vira `ConnectorAuthError`. O `acct_...` retornado é o `externalAccountId` (diferente do AbacatePay, aqui a conta é identificável de verdade). Um `StripeClient` fino (como `AbacatePayClient`) faz as chamadas com `fetch`, sem SDK novo.

## Mapeamento de eventos

Decisão do orquestrador: a unidade é uma Charge do Stripe. Isso cobre Checkout, Payment Links, assinaturas/faturas e Pix pelo Stripe, e evita nota dobrada (`checkout.session.completed` + `invoice.paid` apontam para a mesma charge).

| Evento Stripe | Estado | Observação |
|---|---|---|
| `charge.succeeded` | `paid` | emite a nota |
| `charge.refunded` | `refunded` | só se reembolso total (`refunded: true`); parcial vira `ignored` |
| `charge.dispute.created` | `disputed` | só sinaliza, não cancela |

Qualquer outro evento: `ignored`. `deliveryId` = `event.id`. `operationKey` = `stripe_charge:<ch_...>`; no dispute, `refersTo` aponta para a charge.

Reembolso parcial (decisão do orquestrador): nenhum cancelamento automático. Igual ao Woovi, o evento parcial é ignorado e a nota segue como está. O aviso para revisão manual fica para depois.

Só cobrança confirmada (decisão do orquestrador): `charge.succeeded` só emite com `status === 'succeeded'` e `paid === true`. Pix e boleto ainda pendentes viram `ignored`.

Chave da operação (decisão do orquestrador): `stripe_charge:<id>` em todo lugar, para não colidir com o `charge:` do Woovi.

Só BRL (decisão do orquestrador): outra moeda vai com `currency` real e o planner bloqueia com `unsupported_currency`, motivo claro na tela.

Ambiente (decisão do orquestrador): `livemode: true` vira `environment: 'live'`, `false` vira `'test'`, igual ao `devMode` do AbacatePay. Evento de ambiente diferente do da conexão é descartado pelo `belongsTo` do receptor.

## Dados do cliente

- Nome e e-mail: `charge.billing_details`; se faltar, o objeto Customer (`charge.customer`).
- CPF/CNPJ: `tax_ids` do Customer (tipos `br_cpf` e `br_cnpj`); se a charge veio do Checkout, `customer_details.tax_ids` da Checkout Session. Passa por `normalizeTaxID`. Sem documento: `taxId: null`, e o planner manda para "completar dados" (ou emite sem cliente se a regra permitir anônimo).
- Valor: `charge.amount` (centavos) vira reais pelo planner. Desconto: 0.
- Descrição do serviço: nome do produto dos itens da Checkout Session ou da Invoice, quando houver; senão `null` e vale a descrição da regra ou o padrão da empresa (mesma ordem de `serviceFor`). Busca limitada (até 5 itens) e, se a chave não puder ler, só perde a descrição, igual ao AbacatePay.
- Guia de configuração: recomendar ligar "Coletar CPF/CNPJ" (`tax_id_collection`) no Checkout, para a nota sair completa.

## Onde mexe

- Novo: `connectors/stripe/` (`stripe.connector.ts`, `stripe.client.ts`, `stripe.module.ts`, `__fixtures__/`), módulo registrado em `app.module.ts` e `worker-app.module.ts` (os dois processos, como os outros) e no `runtime-wiring.spec.ts`.
- Web: card e texto do passo a passo em `connect-flow.tsx` (hoje `providerDescriptionKey` só conhece woovi/abacatepay), textos em `messages/pt.json` e `en.json`, docs em `lib/docs/content/{pt,en}.ts`, origem da nota em `lib/invoice-origin.ts` (mapear o prefixo `stripe_charge` para a origem Stripe; `charge` continua sendo do Woovi), logo na landing se quiserem.
- Passo a passo na tela: (1) criar chave restrita só leitura; (2) adicionar endpoint de webhook com os 3 eventos apontando para a URL do Corvo; (3) colar o `whsec_`.

## Testes

- `stripe.connector.spec.ts`: fixtures com assinatura real calculada no teste (válida, adulterada, `t` velho, sem segredo da URL, segredo errado), parse de cada evento, reembolso parcial ignorado, moeda não BRL, `livemode`, cliente com e sem `tax_ids`, descrição via Session/Invoice, erro de chave.
- `stripe.client.spec.ts`: chamadas e erros (401 vira auth, 5xx/429 vira transitório).
- `stripe.flow.postgres.integration.spec.ts`: espelha o do AbacatePay: emite com a regra; sem CPF espera completar dados; reenvio não duplica; reembolso cancela com a opção ligada e só sinaliza sem ela; reembolso antes do pago bloqueia; assinatura errada não guarda nada; `livemode` fora do ambiente é descartado.
- Web: `integrations-page.test.tsx` ganha o card Stripe (campos, URL mostrada uma vez, instruções); `docs-integrations.test.ts` e `invoice-origin` cobrem os textos novos.

## Riscos e perguntas abertas

Nenhuma. As três dúvidas iniciais foram resolvidas como decisões acima (reembolso parcial, prefixo `stripe_charge:`, só `succeeded` e `paid`).
