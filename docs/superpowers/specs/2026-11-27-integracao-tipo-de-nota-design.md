# Integrações: escolher o tipo de nota (serviço ou produto)

Data: 2026-11-27
Status: desenho para aprovação (caminho A escolhido; prazo de cancelamento: opção 1)

## Por que

Quem vende **produto** online precisa de **nota de produto (NF-e)**, não de NFS-e. Hoje toda venda que chega por integração (Mercado Pago, Stripe, Asaas, Pagar.me, Woovi, AbacatePay, PushinPay, Hotmart, Kiwify, Eduzz, Monetizze) vira NFS-e. O objetivo é que a pessoa que vende produto conecte a plataforma e a NF-e saia sozinha a cada venda paga, do mesmo jeito que a NFS-e já sai.

## Objetivos

- Na conexão, escolher **"Serviço (NFS-e)"** ou **"Produto (NF-e)"**.
- Para produto, informar uma vez o **NCM** e a **unidade**; o resto sai sozinho.
- Venda paga → NF-e emitida. Reembolso com a regra ligada → NF-e cancelada (mesma regra de hoje).
- Quando faltar dado que a NF-e exige (endereço do comprador, preço de cada item), a venda vai para **"Vendas pendentes"** e a pessoa completa na tela, como já acontece com o CPF.

## Fora do escopo

- NFC-e por integração (venda online é NF-e; NFC-e é presencial ou entrega).
- Serviço **e** produto na mesma conexão (quem precisar cria duas conexões). Pode virar o caminho B depois: tipo de nota por produto.
- Cálculo de imposto (a Corvo continua sem calcular; usa os padrões do Simples da empresa).
- Liberar NF-e em produção (continua no interruptor `NFE_PRODUCTION_ENABLED`).

## O que seria um fracasso

- Emitir NF-e com dado inventado (endereço, NCM ou preço chutado) só para a nota sair.
- Uma conexão de serviço existente mudar de comportamento sozinha.
- Nota em dobro (a mesma venda gerando NFS-e e NF-e, ou duas NF-e).

## Abordagens consideradas

- **A · Tipo de nota na conexão (escolhida).** Uma escolha na conexão; NCM e unidade no padrão da conexão; regra por produto (que já existe) pode trocar o NCM daquele produto. Simples, reaproveita as telas. Limite: serviço e produto exigem duas conexões.
- **B · Tipo por produto.** Mais flexível, mais tela e configuração para todos. Fica para depois, se aparecer a necessidade.
- **C · Detecção automática.** Descartada: não há como saber se a venda é serviço ou produto, e errar é problema fiscal.

## Como funciona hoje (o que muda)

- `IntegrationRule` (api/src/modules/integrations/domain/integration-rule.ts): regra padrão da conexão (`externalProductId = null`) e regras por produto; cada uma guarda `service` (formato do `service` da API de NFS-e), `sendEmail`, `allowAnonymousCustomer`, `cancelOnRefund`.
- `planEmission` (domain/emission-planner.ts) monta um `CreateInvoiceDto` de NFS-e e devolve `issue`, `blocked` ou `needs_attention` com um `BlockReason`.
- `InvoiceIssuancePort` / `IntegrationInvoiceIssuer` (invoice/application/integration-invoice-issuer.ts) emite pelo caminho normal. `InvoiceCancellationPort` cancela.
- `NormalizedOperation.items` traz `externalProductId`, `description`, `quantity` — **sem preço por item**; o valor vem só em `amountCents`/`discountCents`.
- `NormalizedCustomer.address` existe mas hoje só é preenchido pela tela "Vendas pendentes"; os conectores não mandam endereço, e o tipo `CustomerAddress` não tem número nem bairro.

## Desenho

### 1. Tipo de nota na conexão

- Novo campo na conexão: `documentType: 'nfse' | 'nfe'`, padrão `'nfse'` (migração com default; conexões existentes não mudam).
- Trocar o tipo de uma conexão ativa é permitido; vale só para vendas que chegarem depois. Vendas já emitidas não mudam.
- A empresa precisa estar pronta para NF-e (cadastro de NF-e completo); se não estiver, a venda vai para "Vendas pendentes" com `company_not_ready` (motivo que já existe), e a tela da conexão avisa antes.

### 2. Dados de produto na regra

- A regra ganha `product: { ncm: string; unit: string }` (unidade padrão `"UN"`), usado quando a conexão é `'nfe'`. A regra padrão da conexão guarda o NCM geral; uma regra por produto pode trocar só o NCM/unidade daquele produto.
- CFOP: automático, 5102 (mesmo estado) / 6102 (outro estado), como a NF-e manual (feat/nfe-ux-preenchimento). CSOSN, origem e PIS/COFINS: padrões da empresa (`nfe-settings`). Natureza da operação: padrão da empresa.
- `service` continua obrigatório só para conexões `'nfse'`.

### 3. Montar a NF-e a partir da venda

- **Destinatário:** nome e CPF/CNPJ do comprador (regra atual: sem CPF/CNPJ → `customer_tax_id_missing`). `indIeDest = 9` (não contribuinte) por padrão; a tela de "Vendas pendentes" permite informar IE quando o comprador for empresa contribuinte.
- **Endereço:** obrigatório na NF-e (rua, número, bairro, CEP, cidade com código IBGE, UF). Sem endereço completo → novo motivo **`customer_address_missing`** → "Vendas pendentes". Na tela, o CEP preenche rua, bairro, cidade e IBGE sozinho (mesmo preenchimento da NF-e manual).
  - `CustomerAddress` ganha `number`, `district` e `complement`.
  - Os conectores cujas plataformas mandam endereço passam a preenchê-lo (verificar caso a caso: Mercado Pago `additional_info.payer.address`, Pagar.me `customer.address`, Asaas `/customers`, Stripe `customer_details.address`, plataformas de infoproduto quando houver). Pix (Woovi, AbacatePay, PushinPay) normalmente não manda: essas vendas vão para "Vendas pendentes".
- **Itens:**
  - Um item (ou vários do mesmo produto): uma linha com a quantidade da plataforma e preço unitário = (total − desconto) / quantidade.
  - Vários produtos diferentes sem preço por item: novo motivo **`item_prices_missing`** → "Vendas pendentes", onde a pessoa informa o preço de cada item (a soma tem de bater com o total).
  - Conectores que conhecem o preço por item podem passar a enviá-lo (novo campo opcional `unitPriceCents` em `items`); quando todos os itens têm preço, não há pendência.
  - Descrição do item: a da plataforma; código do produto: `externalProductId` ou `ITEM-n`.
- **Pagamento:** `tPag` pelo meio da venda quando o conector sabe (Pix 17, cartão de crédito 03, boleto 15); senão 99 com `xPag` = nome da plataforma.
- **E-mail:** `sendEmail` da regra vale como `sendEmail` da NF-e (XML e DANFE ao destinatário).
- **Idempotência:** mesma chave por operação de hoje; o tipo de nota entra no hash do pedido, para nunca emitir NFS-e e NF-e para a mesma venda.

### 4. Reembolso e contestação

- Mesma regra de hoje: reembolso com `cancelOnRefund` ligado cancela; contestação só marca a venda (exceto Hotmart e Eduzz, onde chargeback conta como reembolso).
- O cancelamento de NF-e exige justificativa de 15 a 255 caracteres: usar um texto fixo ("Venda reembolsada na <plataforma>").
- Se a NF-e não puder mais ser cancelada (prazo da SEFAZ vencido), a operação fica `cancel_failed` (motivo que já existe) e aparece em "Vendas pendentes" com a explicação.

### 5. Telas (painel)

- **Conectar plataforma:** seletor "Tipo de nota: Serviço (NFS-e) / Produto (NF-e)". Produto mostra NCM e unidade, com o link "Não sabe o NCM?" que a NF-e manual já usa. Aviso se a empresa não está pronta para NF-e. Mesmo visual dos outros campos (componente `Select`/`Field`).
- **Detalhe da conexão / regras por produto:** mostra o tipo; regra por produto mostra NCM/unidade em vez de serviço quando a conexão é de produto.
- **Vendas pendentes:** formulário de endereço (CEP preenche o resto) e preço por item quando necessário; textos novos para `customer_address_missing` e `item_prices_missing`.
- **Lista de vendas da conexão:** link para a NF-e emitida (tipo `nfe`).

### 6. API pública, MCP e documentação

- `POST/GET /integrations/connections` e regras aceitam/devolvem `documentType` e `product`. OpenAPI regenerado, contrato e2e atualizado.
- MCP: as ferramentas que listam/resolvem vendas pendentes entendem os motivos novos.
- Docs (pt/en): página de integrações explica a escolha; página /integrations e artigos do blog ganham uma linha "também emite nota de produto (NF-e)".

### 7. Produção

- A integração com NF-e funciona em teste (homologação) desde já. Em produção, vale o interruptor `NFE_PRODUCTION_ENABLED`; com ele desligado, conexões de produto em produção deixam a venda em "Vendas pendentes" com um motivo claro (reusar `company_not_ready` com texto específico ou novo `nfe_production_disabled` — decidir no plano), e a tela avisa ao escolher "Produto".


### 8. Decisões tomadas na revisão

Decididas pelo dono do produto:

- **Reembolso depois do prazo de cancelamento da NF-e** (em geral 24 h; alguns estados dão mais): a Corvo **não** emite nota de devolução. A venda fica em "Vendas pendentes" com `cancel_failed` e o aviso "Prazo de cancelamento vencido: fale com o seu contador sobre a nota de devolução". Nota de devolução automática fica fora do escopo.

Decididas por quem desenhou (podem ser revistas):

- **Ambiente:** a conexão já tem `environment` (teste ou produção), como na NFS-e. A NF-e usa o mesmo: conexão de teste → homologação; de produção → depende de `NFE_PRODUCTION_ENABLED`.
- **Emissão assíncrona:** como a NFS-e, a operação guarda o id do documento assim que ele é aceito na fila. Rejeição da SEFAZ → `invoice_rejected` (motivo que já existe), em "Vendas pendentes". O link na lista de vendas pode apontar para uma NF-e ainda não autorizada; a página da nota mostra o estado.
- **Dados completados à mão:** endereço, IE e e-mail informados em "Vendas pendentes" ficam salvos no cadastro do cliente (por CPF/CNPJ, via `SavedCustomerPort`) e são usados de novo nas próximas compras da mesma pessoa. Assim o comprador de Pix só precisa ser completado uma vez. Preços por item ficam só na operação.
- **Uma nota por venda:** a chave de idempotência continua por operação, sem o tipo. A operação guarda o tipo e o id do documento emitido; uma operação que já tem documento nunca gera outro, mesmo que o tipo da conexão mude depois. O cancelamento usa o tipo guardado para chamar o cancelamento certo (NFS-e ou NF-e).
- **Precondições da NF-e viram motivos de pendência, um para um:** `NFE_PRODUCTION_DISABLED` → `nfe_production_disabled`, `COMPANY_NFE_INCOMPLETE` → `company_not_ready`, `UF_NOT_ENABLED` → `uf_not_enabled`. Essas vendas são tentadas de novo sozinhas quando a condição muda (interruptor ligado, cadastro completo), sem ficar presas.
- **Frete e taxas:** quando o conector informa o frete separado, ele vai no campo de frete da NF-e (`vFrete`), e os itens somam o resto. Quando não informa, o valor pago inteiro vai como produto. Taxas da plataforma não entram na nota.

## O que fica para quem constrói

- Nomes exatos de colunas, migração e DTOs.
- Quais conectores já conseguem mandar endereço e preço por item (verificar na documentação de cada plataforma e nos fixtures).
- Arredondamento do preço unitário (a NF-e aceita até 10 casas; o total tem de bater).
- Ordem das entregas (sugestão: domínio e planejador → emissão e cancelamento → telas → conectores com endereço → docs).
