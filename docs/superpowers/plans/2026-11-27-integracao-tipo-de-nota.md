# Integrações: tipo de nota (serviço ou produto): plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** quem vende produto conecta a plataforma, escolhe "Produto (NF-e)" e a NF-e sai sozinha a cada venda paga (e é cancelada no reembolso, se a regra mandar), do mesmo jeito que a NFS-e sai hoje.

**Arquitetura:** a conexão ganha `documentType` (`'nfse'` por padrão) e a regra ganha `product` (NCM e unidade). O planejador (`planEmission`) passa a devolver um plano de NFS-e **ou** de NF-e; o de NF-e é um `NfeInput` montado por uma função pura nova (`buildNfeRequest`). A emissão e o cancelamento de NF-e entram por duas portas novas, implementadas em `modules/nfe`, ao lado das portas de NFS-e que não mudam. A operação guarda `documentType` junto com o pedido congelado, e é esse tipo guardado (nunca o da conexão) que decide emissão e cancelamento. O que falta (endereço, preço por item, IE) vira "Vendas pendentes" e a pessoa completa na tela.

**Stack:** NestJS 11 + TypeORM/Postgres (RLS) + Jest; Next.js 16 + next-intl + Vitest/RTL; yarn v1, Node 24.

**Spec:** `docs/superpowers/specs/2026-11-27-integracao-tipo-de-nota-design.md`. Leia a spec inteira antes de qualquer tarefa (o plano cita "spec 3", "spec 8"). Onde a seção 3 e a seção 8 divergem, vale a **seção 8** (decisões da revisão).

## Global Constraints

- **Conexão de NFS-e não muda.** Conexão existente fica `documentType = 'nfse'` (migração com default). O `request`, o `requestHash` e a `idempotencyKey` de uma venda de NFS-e têm de sair **byte a byte iguais** aos de hoje; `emission-planner.spec.ts` atual passa sem edição (só ganha casos).
- **Nada inventado.** Sem endereço completo, sem nome, sem CPF/CNPJ ou sem preço por item, a venda vai para "Vendas pendentes" com motivo. Nunca chutar endereço, NCM, nome ou preço.
- **Uma nota por venda.** `idempotencyKey` continua por operação, **sem o tipo** (spec 8). Operação com `invoiceId` ou com pedido congelado nunca emite outro documento, mesmo que o tipo da conexão mude. O cancelamento usa o `documentType` guardado na operação.
- **Fora do escopo:** NFC-e por integração, serviço e produto na mesma conexão, cálculo de imposto, nota de devolução, ligar a produção de NF-e (`NFE_PRODUCTION_ENABLED` continua sendo o interruptor).
- **Valores fixos da spec:** unidade padrão `"UN"`; `indIeDest = 9` por padrão; CFOP `5102` (mesma UF da empresa) ou `6102` (outra UF); `tPag` Pix `17`, cartão de crédito `03`, boleto `15`, senão `99` com `xPag` = nome da plataforma; justificativa de cancelamento fixa `Venda reembolsada na <plataforma>` (15 a 255 caracteres); NF-e aceita até 10 casas no preço unitário; frete do conector vai em `freight` do primeiro item.
- **Motivos (`BlockReason`) novos:** `customer_address_missing`, `item_prices_missing`, `nfe_production_disabled`, `uf_not_enabled` (spec) e `customer_name_missing` (lacuna da spec, ver Decisões do plano). Mapa um para um das precondições: `NFE_PRODUCTION_DISABLED` → `nfe_production_disabled`, `COMPANY_NFE_INCOMPLETE` → `company_not_ready`, `UF_NOT_ENABLED` → `uf_not_enabled`.
- **Fronteiras:** `modules/nfe` e `modules/integrations` só conversam por portas (classes abstratas em `integrations/domain`) e pelo `ApplicationEventBus`. `IntegrationsModule` importa `NfeModule`; `NfeModule` nunca importa `IntegrationsModule`. `integrations/domain` pode importar **tipos** de `nfe/domain/nfe-input.ts`, nada mais.
- **CI (regras do repositório):**
  - Nenhum teste pulado (`scripts/assert-no-skipped-tests.mjs`). Specs `*.postgres.integration.spec.ts` rodam com banco real: `docker run --rm -d --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust -p 55432:5432 postgres:16` e `MIGRATION_TEST_DATABASE_URL=postgresql://postgres@localhost:55432/postgres`.
  - OpenAPI: `cd api && yarn openapi:generate` e commitar; `git diff --quiet -- docs/openapi web/public/openapi.json` tem de passar.
  - Toda operação pública nova ou com campo novo entra em `api/test/openapi-contract.e2e-spec.ts` (bloco `describe('integrations')`, perto da linha 827).
  - Todo `code: '...'` novo na API ganha texto pt **e** en em `web/messages/{pt,en}.json` (`ApiErrors`); todo `BlockReason` novo ganha título e ação em `Integrations.reasons` (pt e en) e em `api/src/modules/integrations/domain/block-reason-text.ts` (e-mails).
  - Rota nova do web só com entrada na allowlist `web/lib/proxy-routes.ts` e teste em `web/tests/proxy.test.ts` (este plano não cria rota nova: confira antes de dizer que não precisa).
  - Semgrep: nada de `new RegExp(<variável>)` (use `Set`, `includes`, `startsWith`).
  - Consulta nova de repositório com `tenant_id` passa pelo guarda `api/src/infra/persistence/tenant-predicates.spec.ts` (consulta entre tenants usa `runAsSystem('<nome>', ...)` como `findByPublicId`). Job novo no worker entra em `api/src/runtime-wiring.spec.ts`.
- **Migrações:** um arquivo por alteração em `api/src/infra/database/migrations/`, prefixo `17939000000xx` (maior que o último, `1793800000000`), `down` simétrico, padrão `schema(runner)` de `1792550000000-AddCancelOnRefundToIntegrationRules.ts`.
- **Git:** nunca `rebase`, nunca `push --force`; atualizar com merge. Commits em pt-BR convencionais (`feat(integracoes): ...`), terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Fim de cada tarefa:** `yarn typecheck`, `yarn typecheck:tests`, `yarn lint:check` no pacote tocado (`api` ou `web`).

## Review Focus

1. **Conexão de NFS-e antiga depois do deploy.** Esperado: mesma requisição, mesmo hash, mesma chave. Teste na Tarefa 3 (golden com o `request` de hoje) e na Tarefa 1 (migração deixa `'nfse'`).
2. **Tipo da conexão muda de `nfse` para `nfe` (ou o contrário) com a venda já congelada ou emitida.** Esperado: o pedido congelado e o `documentType` guardado valem; reembolso cancela pelo caminho do tipo guardado; nenhuma segunda nota. Teste na Tarefa 6.
3. **Arredondamento: R$ 100,00 em 3 unidades.** `33,3333333333 × 3` não fecha em centavos. Esperado: quando `quantidade × preço unitário` (arredondado a 2 casas) não bate com o total líquido, sai **uma linha de quantidade 1** com o total líquido; a NF-e nunca sai com total diferente do pago. Teste na Tarefa 3.
4. **Nome de comprador ou descrição maior que o limite da NF-e** (nome 60, descrição 120, código 60) **ou nome curto/ausente.** Esperado: texto longo é cortado (nunca recusa a venda por isso); nome ausente ou com menos de 2 caracteres vai para `customer_name_missing`. Teste na Tarefa 3.
5. **Reembolso quando a NF-e ainda não foi autorizada, ou depois do prazo da SEFAZ.** Esperado: `cancel_failed` com a mensagem "Prazo de cancelamento vencido: fale com o seu contador sobre a nota de devolução" (rejeição tardia chega pelo evento da Tarefa 7); "Tentar de novo" reenvia o cancelamento. Teste nas Tarefas 5 e 7.

## Decisões do plano

Lacunas da spec e como o plano as fecha (revisáveis):

1. **Conflito spec 3 × spec 8 sobre a chave:** vale a 8 (chave por operação, sem o tipo). O `requestHash` já difere sozinho, porque o corpo de NF-e e o de NFS-e são formatos diferentes.
2. **MCP:** a spec (6) fala em "ferramentas que listam/resolvem vendas pendentes", mas **não existe ferramenta MCP de integrações** em `api/src/modules/mcp/tools` (só `nfse_*`, `nfe_*` etc.). Nada a fazer no MCP; nenhuma tarefa.
3. **Meio de pagamento 99 exige `xPag`, e o `NfePaymentDto` não tem `xPag`.** Tarefa 2 acrescenta `xPag` (opcional, 2 a 60 caracteres, obrigatório quando `tPag = '99'`) ao DTO, ao draft e ao builder da NF-e.
4. **Falta o campo do meio de pagamento, do frete e do preço por item no `NormalizedOperation`.** Tarefa 3 acrescenta `paymentMethod`, `freightCents` e `items[].unitPriceCents` (todos opcionais).
5. **Nome do comprador é obrigatório na NF-e (mín. 2)** e a spec só trata CPF/CNPJ. Novo motivo `customer_name_missing`; a tela de pendentes já deixa digitar o nome.
6. **"Tentadas de novo sozinhas quando a condição muda"** (spec 8) não existe hoje (hoje o cliente aperta "Tentar de novo"). Tarefa 8 cria um varredor no worker para os 3 motivos de precondição.
7. **Rejeição tardia do cancelamento de NF-e** acontece depois da resposta síncrona (o cancelamento é assíncrono). Tarefa 7 publica um evento no `ApplicationEventBus` quando a SEFAZ recusa e a integração marca `cancel_failed`.
8. **Endereço e IE salvos no cadastro do cliente** (spec 8) exigem colunas novas: `customers.nfe_data jsonb`. Tarefa 10.
9. **Semântica do valor:** `amountCents` é o valor cobrado antes do desconto e o `discountCents` é abatido (como na NFS-e: `amount` e `discount`). Líquido = `amountCents − discountCents`; é o total dos itens e o valor do pagamento da NF-e.
10. **Conectores que só existem em branches** (`feat/conector-{mercadopago,asaas,pagarme,eduzz,monetizze}`, ainda fora da `main`): grupo opcional na Tarefa 18, aplicado só aos conectores presentes na `main` na hora da execução. Na `main` hoje: Woovi, AbacatePay, PushinPay, Stripe, Kiwify, Hotmart.

## Fases (cada fase é um PR para a `main`; cada uma deixa a `main` funcionando)

| Fase | Branch | Tarefas | Entrega |
| --- | --- | --- | --- |
| 1 | `feat/nota-tipo-1-base` | 1 a 4 | Modelo, migrações, planejador e `xPag`. Nada exposto: a API ainda não aceita `documentType`. |
| 2 | `feat/nota-tipo-2-emissao` | 5 a 9 | Emissão e cancelamento de NF-e, retomada automática, API pública aceita `documentType` e `product`. Já dá para usar por API. |
| 3 | `feat/nota-tipo-3-dados` | 10 a 11 | Completar endereço, IE e preço por item (API) e salvar no cadastro do cliente. |
| 4 | `feat/nota-tipo-4-telas` | 12 a 16 | Painel: seletor, NCM, pendentes com CEP e preços, link da NF-e. |
| 5 | `feat/nota-tipo-5-conectores-docs` | 17 a 19 | Endereço, pagamento e preço nos conectores; documentação e site. |

A fase N+1 parte da `main` depois do merge da N (ou do branch da N, atualizado por merge). A fase 4 só entra depois da 3.

## Estrutura de arquivos

Caminhos relativos a `api/src/modules/` (api) e `web/` (web).

- **Criar** `integrations/domain/nfe-request-builder.ts`: funções puras `buildNfeRequest`, `splitUnitPrices`, `cfopFor`.
- **Criar** `integrations/domain/nfe-issuance.port.ts` e `integrations/domain/nfe-cancellation.port.ts`: portas de NF-e.
- **Criar** `nfe/application/integration-nfe-issuer.ts` e `nfe/application/integration-nfe-canceller.ts`: adaptadores das portas.
- **Criar** `integrations/application/nfe-cancellation-rejected.listener.ts` e `integrations/jobs/operation-retry.scheduler.ts`.
- **Criar** `shared/events/fiscal-cancellation.events.ts`: evento `fiscal.cancellation.rejected`.
- **Modificar** (domínio) `integrations/domain/{integration-connection,integration-rule,integration-operation,connector,emission-planner,block-reason-text,saved-customer.port,*.repository}.ts`.
- **Modificar** (aplicação e HTTP) `integrations/application/{operation-emitter.service,operation.service,connection.service}.ts`, `integrations/http/{integrations.dto,integrations.controller}.ts`, `integrations/infra/*` (entidades ORM e repositórios), `integrations/integrations.module.ts`, `nfe/nfe.module.ts`, `nfe/http/nfe.dto.ts`, `nfe/domain/{nfe-input,nfe-draft}.ts`, `nfe/domain/builder/pag.group.ts`, `invoice/application/integration-saved-customers.ts`, `invoice/domain/customer-directory.ts`, `invoice/infra/typeorm-customer-directory.ts`, `worker-app.module.ts`, `runtime-wiring.spec.ts`.
- **Modificar** (web) `lib/api.ts`, `lib/integrations.ts`, `messages/{pt,en}.json`, `components/dashboard/integrations/{connect-flow,connection-settings,sale-resolve-form,sales-list,pending-sales-panel}.tsx`, `lib/docs/content/{pt,en}.ts`, `lib/integrations-catalog.ts`.

---

## Fase 1: base (modelo, migrações, planejador)

### Task 1: Tipo de nota, produto e tipo guardado (domínio, ORM, migrações)

**Files:**
- Create: `api/src/infra/database/migrations/1793900000000-AddDocumentTypeToIntegrationConnections.ts`, `1793900000001-AddProductToIntegrationRules.ts`, `1793900000002-AddDocumentTypeToIntegrationOperations.ts`
- Modify: `integrations/domain/{integration-connection,integration-rule,integration-operation}.ts`, `integrations/domain/integration-operation.repository.ts` (`freezeEmission`), `integrations/infra/{integration-connection,integration-rule,integration-operation}.orm-entity.ts`, `integrations/infra/typeorm-integration-{connection,rule,operation}.repository.ts`, `integrations/testing/memory-repositories.ts`
- Test: `integrations/infra/integrations.postgres.integration.spec.ts`, `integrations/infra/typeorm-integration-operation-rule.repositories.postgres.integration.spec.ts`, `integrations/domain/integration-rule.spec.ts`

**Interfaces:**
- Produces:
  - `export type IntegrationDocumentType = 'nfse' | 'nfe'` em `integration-connection.ts`.
  - `IntegrationConnection.documentType: IntegrationDocumentType` (coluna `integration_connections.document_type varchar(10) NOT NULL DEFAULT 'nfse'`, `CHECK IN ('nfse','nfe')`).
  - `IntegrationRule.product: { ncm: string; unit: string } | null` (coluna `integration_rules.product jsonb NULL`).
  - `IntegrationOperation.documentType: IntegrationDocumentType` (coluna `integration_operations.document_type varchar(10) NOT NULL DEFAULT 'nfse'`).
  - `IIntegrationOperationRepository.freezeEmission(id, tenantId, frozen: { ruleId: string; documentType: IntegrationDocumentType; request: Record<string, unknown>; requestHash: string; idempotencyKey: string })` grava também `document_type`.
  - `ConnectionService.create` recebe `documentType?: IntegrationDocumentType` (padrão `'nfse'`) em `CreateConnectionInput`; `IIntegrationConnectionRepository.update` persiste o campo.
- Consumes: nada.

- [ ] **Step 1: Teste Postgres falhando.** Em `integrations.postgres.integration.spec.ts`: conexão inserida sem tipo volta `documentType === 'nfse'`; conexão `'nfe'` volta `'nfe'`; valor `'nfce'` é recusado pela constraint. Em `typeorm-integration-operation-rule.repositories...`: regra com `product: { ncm: '61091000', unit: 'UN' }` faz ida e volta; regra sem `product` volta `null`; `freezeEmission` com `documentType: 'nfe'` grava e `findById` devolve `'nfe'`; operação antiga (linha inserida sem a coluna) volta `'nfse'`.
- [ ] **Step 2: Rodar e ver falhar.** `cd api && MIGRATION_TEST_DATABASE_URL=... yarn jest src/modules/integrations/infra -t "documentType|product"`. Esperado: FAIL (coluna inexistente).
- [ ] **Step 3: Implementar** as três migrações (`up`/`down` simétricos), as colunas nas entidades ORM, o mapeamento nos repositórios TypeORM e nos repositórios em memória (`memory-repositories.ts`), e os tipos de domínio acima. `replaceForConnection` de regras grava `product`. Em `integration-rule.spec.ts`, acrescente caso: `selectRule` continua igual (não olha `product`).
- [ ] **Step 4: Rodar** os specs acima e `yarn jest src/modules/integrations`. Esperado: PASS (os specs antigos passam sem edição, exceto fixtures que ganham `documentType`/`product: null` por exigência do tipo).
- [ ] **Step 5: Commit** `feat(integracoes): tipo de nota na conexão, produto na regra e tipo guardado na venda`.

### Task 2: `xPag` no pagamento da NF-e

**Files:**
- Modify: `nfe/http/nfe.dto.ts` (`NfePaymentDto`), `nfe/domain/nfe-input.ts` (`NfePaymentInput`), `nfe/domain/nfe-draft.ts` (linha ~46 e ~141), `nfe/domain/nfe-draft-mapper.ts`, `nfe/domain/nfe-document.ts` (pagamentos guardados), `nfe/domain/builder/pag.group.ts`, validador de pagamentos em `nfe/domain/validators/`
- Test: `nfe/http/nfe.dto.spec.ts`, `nfe/domain/builder/` (spec do `pag.group`), `nfe/domain/validators/validators.spec.ts`

**Interfaces:**
- Produces: `NfePaymentInput.xPag?: string` (2 a 60 caracteres). Regra: `tPag === '99'` exige `xPag`; outros `tPag` ignoram `xPag`. O XML leva `<xPag>` dentro de `detPag` só quando informado.
- Consumes: nada.

- [ ] **Step 1: Testes falhando.** DTO: `{ tPag: '99', amount: 10 }` sem `xPag` é inválido; com `xPag: 'Hotmart'` é válido; `{ tPag: '17', amount: 10 }` continua válido. Builder: pagamento 99 gera `<xPag>Hotmart</xPag>` logo depois de `<tPag>99</tPag>` (ordem do layout 4.00: `indPag`, `tPag`, `xPag`, `vPag`); pagamento 17 não gera `xPag`. Se `xPag` precisa persistir (veja como `tPag` é guardado em `nfe-document.ts`/`nfe-draft-mapper.ts`), teste de ida e volta.
- [ ] **Step 2: Rodar** `yarn jest src/modules/nfe -t xPag`. Esperado: FAIL.
- [ ] **Step 3: Implementar** o campo em DTO/input/draft/mapper/builder e a regra no validador pré-envio (código de issue `NFE_PAYMENT_DESCRIPTION_REQUIRED`, com texto pt/en em `ApiErrors`). Persistência: se os pagamentos ficam em `jsonb`, nenhuma migração; se em colunas, migração `1793900000003-AddXPagToNfePayments.ts`. Regenerar OpenAPI.
- [ ] **Step 4: Rodar** `yarn jest src/modules/nfe` e `yarn openapi:generate`. Esperado: PASS e diff do OpenAPI só com o campo novo (commitado).
- [ ] **Step 5: Commit** `feat(nfe): descrição do meio de pagamento (xPag) para tPag 99`.

### Task 3: Construtor puro da NF-e e planejador de dois tipos

**Files:**
- Create: `integrations/domain/nfe-request-builder.ts`
- Modify: `integrations/domain/connector.ts`, `integrations/domain/integration-operation.ts` (`BlockReason`), `integrations/domain/emission-planner.ts`, `integrations/domain/block-reason-text.ts`
- Test: `integrations/domain/nfe-request-builder.spec.ts` (novo), `integrations/domain/emission-planner.spec.ts`, `integrations/domain/block-reason-text.spec.ts`

**Interfaces:**
- Consumes (Task 1): `IntegrationConnection.documentType`, `IntegrationRule.product`.
- Produces:
  - `connector.ts`: `CustomerAddress` ganha `number?: string; district?: string; complement?: string`; `NormalizedCustomer` ganha `stateRegistration?: string`; `NormalizedOperation.items[]` ganha `unitPriceCents?: number`; `NormalizedOperation` ganha `paymentMethod?: 'pix' | 'credit_card' | 'boleto'` e `freightCents?: number`.
  - `BlockReason` ganha `'customer_address_missing' | 'customer_name_missing' | 'item_prices_missing' | 'nfe_production_disabled' | 'uf_not_enabled'`; `BLOCK_REASON_TEXT` ganha as cinco entradas (pt, curtas, no tom das existentes).
  - `nfe-request-builder.ts`:
    ```ts
    export function cfopFor(issuerUf: string, recipientUf: string): '5102' | '6102';
    export function splitUnitPrices(netCents: number, items: Array<{ quantity: number; unitPriceCents?: number }>):
      { ok: true; lines: Array<{ quantity: number; unitPrice: number }> } | { ok: false; reason: 'item_prices_missing' };
    export interface BuildNfeInput { companyId: string; issuerUf: string; providerName: string; rule: IntegrationRule; snapshot: NormalizedOperation; customer: NormalizedCustomer; sendEmail: boolean }
    export function buildNfeRequest(input: BuildNfeInput): { ok: true; request: NfeInput } | { ok: false; reason: BlockReason };
    ```
  - `PlanInput` ganha `providerName: string` e `issuerUf: string | null`; `PlanInput.connection` ganha `documentType: IntegrationDocumentType`.
  - `EmissionPlan` vira: `{ kind: 'issue'; documentType: 'nfse'; request: CreateInvoiceDto; ruleId; requestHash; idempotencyKey } | { kind: 'issue'; documentType: 'nfe'; request: NfeInput; ruleId; requestHash; idempotencyKey } | blocked | needs_attention`.

- [ ] **Step 1: Testes falhando do construtor** (nomes e asserções):
  - `cfopFor('SP','SP') === '5102'`, `cfopFor('sp','RJ') === '6102'`.
  - `splitUnitPrices(30000, [{quantity:3}])` devolve `lines[0] = { quantity: 3, unitPrice: 100 }`.
  - Arredondamento (Review Focus 3): `splitUnitPrices(10000, [{quantity:3}])` devolve **uma** linha `{ quantity: 1, unitPrice: 100 }` (3 × 33,3333333333 não fecha).
  - Dois itens diferentes sem `unitPriceCents` → `{ ok: false, reason: 'item_prices_missing' }`; com `unitPriceCents` em todos e soma igual ao líquido → `ok`; soma diferente → `item_prices_missing`.
  - `buildNfeRequest`: mesmo estado → todos os itens com `cfop '5102'`, destino em outro estado → `'6102'`; sem `address` ou com `address` sem rua/número/bairro/CEP/cidade/IBGE (`municipalityCode`)/UF → `customer_address_missing`; nome ausente ou com menos de 2 caracteres → `customer_name_missing`; nome de 80 caracteres sai cortado em 60, descrição de 150 em 120, código de 70 em 60 (Review Focus 4); `rule.product` nulo → `no_rule`; `indIeDest = 9` sem IE e `1` com `stateRegistration` (só CNPJ); `unit` e `ncm` vêm de `rule.product`; código do item é `externalProductId` ou `ITEM-n`; `paymentMethod: 'pix'` → `tPag '17'`, `'credit_card'` → `'03'`, `'boleto'` → `'15'`, ausente → `tPag '99'` com `xPag = providerName`; `payments[0].amount` = líquido em reais; `freightCents` vai em `items[0].freight` (e os itens somam o restante, ou seja, `total − frete`); `sendEmail` só vale com e-mail do comprador; `externalId = operationKey.slice(0, 255)`; `natOp` e `tax` ficam de fora (padrões da empresa).
- [ ] **Step 2: Testes falhando do planejador** em `emission-planner.spec.ts`: (a) **golden** de NFS-e: o plano de uma conexão `documentType: 'nfse'` tem o mesmo `request`, `requestHash` e `idempotencyKey` que o spec atual espera (copie os valores esperados dos casos de hoje; Review Focus 1); (b) conexão `'nfe'` com tudo certo devolve `kind: 'issue'`, `documentType: 'nfe'` e `request.items[0].ncm` da regra; (c) `rule.product === null` em conexão `'nfe'` → `needs_attention('no_rule')`; (d) em conexão `'nfe'`, `rule.service` vazio **não** bloqueia; em `'nfse'` segue como hoje; (e) a mesma venda gera a **mesma** `idempotencyKey` nos dois tipos; (f) `issuerUf: null` em `'nfe'` → `needs_attention('company_not_ready')`; (g) a ordem das checagens existentes (conexão, data, estado, moeda, valor, emissor) não muda e `customer_tax_id_missing` vem antes de `customer_address_missing`.
- [ ] **Step 3: Rodar** `yarn jest src/modules/integrations/domain`. Esperado: FAIL.
- [ ] **Step 4: Implementar** `nfe-request-builder.ts` e o ramo de NF-e em `planEmission` (o ramo de NFS-e fica intocado; só o retorno ganha `documentType: 'nfse'`). `splitUnitPrices`: com um só `externalProductId` (ou itens sem preço mas todos do mesmo produto) soma as quantidades e usa `net / quantidade` com 10 casas; só vale se `Math.round(qtd × preço × 100) === net`, senão cai na linha única de quantidade 1. Contas em centavos inteiros (nada de acumular `float`). `requestHash` continua `sha256(canonicalJson(request))`.
- [ ] **Step 5: Rodar** `yarn jest src/modules/integrations` e `yarn typecheck` (os chamadores de `planEmission` em `operation-emitter.service.ts` passam `documentType`, `providerName: provider` e `issuerUf: null` provisório; a Tarefa 6 liga os valores reais). Esperado: PASS.
- [ ] **Step 6: Commit** `feat(integracoes): planejador monta a NF-e a partir da venda`.

### Task 4: Textos dos motivos novos no painel (só dicionário)

**Files:**
- Modify: `web/lib/integrations.ts` (`BLOCK_REASONS`), `web/messages/pt.json` e `en.json` (`Integrations.reasons`, perto da linha 3200)
- Test: `web/tests/` (o teste que valida que todo `BLOCK_REASONS` tem título e ação em pt e en; se não existir, criar `web/tests/integrations-reasons.test.ts`)

**Interfaces:**
- Consumes (Task 3): os cinco códigos novos.
- Produces: `BLOCK_REASONS` com os cinco códigos; `Integrations.reasons.<código>.{title,action}` em pt e en. Textos em linguagem simples, por exemplo `customer_address_missing`: título "Falta o endereço do cliente.", ação "Informe o endereço (o CEP preenche o resto) e emita a nota."; `uf_not_enabled`: "Seu estado ainda não está liberado para esta nota."

- [ ] **Step 1: Teste falhando:** para cada código de `BLOCK_REASONS`, `pt.json` e `en.json` têm `title` e `action` não vazios; `explainError('customer_address_missing')` devolve `{ kind: 'reason', code: 'customer_address_missing' }`.
- [ ] **Step 2: Rodar** `cd web && yarn vitest run tests/integrations-reasons.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** a lista e os textos (pt e en).
- [ ] **Step 4: Rodar** `yarn vitest run` do que tocou e `yarn typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(web): textos dos motivos novos das vendas de produto`.

---

## Fase 2: emissão e cancelamento de NF-e

### Task 5: Portas e adaptadores de NF-e

**Files:**
- Create: `integrations/domain/nfe-issuance.port.ts`, `integrations/domain/nfe-cancellation.port.ts`, `nfe/application/integration-nfe-issuer.ts`, `nfe/application/integration-nfe-canceller.ts`
- Modify: `nfe/nfe.module.ts` (providers e exports), `integrations/integrations.module.ts` (importa `NfeModule`), `integrations/testing/fake-cancellation.ts` (acrescentar versão fake para NF-e)
- Test: `nfe/application/integration-nfe-issuer.spec.ts`, `nfe/application/integration-nfe-canceller.spec.ts`, `nfe/nfe-integration.postgres.integration.spec.ts`

**Interfaces:**
- Consumes (Task 3): `NfeInput`.
- Produces:
  ```ts
  // nfe-issuance.port.ts
  export type NfeNotIssuableReason = 'nfe_production_disabled' | 'company_not_ready' | 'uf_not_enabled' | 'invoice_rejected' | 'quota_exceeded';
  export class NfeNotIssuableError extends Error { constructor(readonly reason: NfeNotIssuableReason, message: string) }
  export interface IssueNfeCommand { tenantId: string; environment: IntegrationEnvironment; request: NfeInput; idempotencyKey: string }
  export abstract class NfeIssuancePort { abstract issue(c: IssueNfeCommand): Promise<{ documentId: string; replay: boolean }> }
  // nfe-cancellation.port.ts
  export abstract class NfeCancellationPort { abstract cancel(c: CancelInvoiceCommand): Promise<CancelInvoiceResult> } // invoiceId = id do documento NF-e
  ```
  Adaptadores: `IntegrationNfeIssuer extends NfeIssuancePort` chama `NfeIntakeService.submit(tenantId, environment, request, idempotencyKey)` (`replay = submitted.replayed`) e traduz erros; `IntegrationNfeCanceller extends NfeCancellationPort` chama `NfeCancelService.cancel(id, tenantId, environment, description)`.

- [ ] **Step 1: Testes falhando do emissor** (serviços falsos): `NfeIntakeService.submit` lançando `UnprocessableEntityException` com `code` `NFE_PRODUCTION_DISABLED` → `NfeNotIssuableError('nfe_production_disabled')`; `COMPANY_NFE_INCOMPLETE` → `'company_not_ready'`; `UF_NOT_ENABLED` → `'uf_not_enabled'`; `NFE_VALIDATION_FAILED` → `'invoice_rejected'` com a mensagem dos `details`; `InsufficientCreditsError` (`modules/credits/domain/errors.ts`) e `QuotaExceededError` → `'quota_exceeded'`; certificado ausente/inválido/vencido (mesmas classes que o `OperationEmitter` já trata para NFS-e) e `CompanyNotReadyError`/`CompanyBlockedError` → `'company_not_ready'`; qualquer outro erro sobe sem tradução; `replayed: true` → `replay: true`. Canceller: sucesso → `{ ok: true }`; `nfeInvalidState` (documento não autorizado), `nfeNotFound` e `nfeJustificationLength` → `{ ok: false, message }`; erro inesperado sobe.
- [ ] **Step 2: Teste Postgres** `nfe-integration.postgres.integration.spec.ts` (use `nfe/testing/nfe-stack.ts`): emitir duas vezes com a mesma chave devolve o mesmo `documentId` e `replay: true` na segunda, e um único documento no banco.
- [ ] **Step 3: Rodar** `yarn jest src/modules/nfe/application/integration-nfe`. Esperado: FAIL.
- [ ] **Step 4: Implementar** portas e adaptadores; providers `{ provide: NfeIssuancePort, useClass: IntegrationNfeIssuer }` e `{ provide: NfeCancellationPort, useClass: IntegrationNfeCanceller }` no `NfeModule`, exportados; `IntegrationsModule` importa `NfeModule`. Rodar `yarn jest src/runtime-wiring.spec.ts` e o spec de fronteiras (`fiscal-core.boundaries.spec.ts`).
- [ ] **Step 5: Rodar** specs da tarefa e do módulo `nfe`. Esperado: PASS.
- [ ] **Step 6: Commit** `feat(nfe): portas de emissão e cancelamento para as integrações`.

### Task 6: `OperationEmitter` emite e cancela os dois tipos

**Files:**
- Modify: `integrations/application/operation-emitter.service.ts`, `integrations/integrations.module.ts` (injeções), `integrations/application/connection.service.ts` (nada se já devolve a conexão com `documentType`)
- Test: `integrations/application/operation-emitter.service.spec.ts`, `integrations/integrations.acceptance.spec.ts`

**Interfaces:**
- Consumes: `NfeIssuancePort`, `NfeCancellationPort`, `NfeNotIssuableError` (Task 5); `planEmission` com `documentType` (Task 3); `freezeEmission` com `documentType` (Task 1); `CompanyService.findById(companyId, tenantId, environment)` (já usado em `ConnectionService`) para ler a UF da empresa (`addressState`).
- Produces: nenhuma assinatura nova pública. Comportamento:
  - Antes de planejar uma conexão `'nfe'`, carrega a empresa e passa `issuerUf` (`company.addressState` ou `null`) e `providerName` (nome do `manifest` do conector, via `ConnectorRegistry`, ou o id).
  - Congela com o `documentType` do plano. Ao emitir, usa o `documentType` **da operação congelada** (`frozen.documentType`): `'nfe'` → `NfeIssuancePort.issue`, `'nfse'` → `InvoiceIssuancePort.issue` como hoje. `setFiscal(..., 'submitted', null, id)` guarda o id do documento.
  - `NfeNotIssuableError` → `unfreezeEmission` + `needs_attention` com o `reason` do erro (`stop`), para `nfe_production_disabled`, `company_not_ready`, `uf_not_enabled`, `invoice_rejected`; `quota_exceeded` sem `unfreeze` (como a NFS-e).
  - `afterInvoice` cancela por `operation.documentType`: `'nfe'` → `NfeCancellationPort.cancel` com `description = 'Venda reembolsada na ' + providerName`; `'nfse'` → texto atual `Cancelado por reembolso` e `InvoiceCancellationPort` (inalterados). Resultado `ok: false` em NF-e → `cancel_failed` com a mensagem "Prazo de cancelamento vencido: fale com o seu contador sobre a nota de devolução" quando a mensagem vem de prazo, senão a mensagem original.

- [ ] **Step 1: Testes falhando** (fakes de portas):
  - NF-e feliz: conexão `'nfe'`, venda paga com endereço → `NfeIssuancePort.issue` chamado uma vez com `request.items[0].ncm` da regra; `InvoiceIssuancePort.issue` **não** chamado; operação `submitted` com o id.
  - Review Focus 2: operação já congelada como `'nfse'` cuja conexão virou `'nfe'` → emite pela porta de NFS-e, não cria pedido de NF-e; operação com `invoiceId` e `documentType 'nfe'` cuja conexão virou `'nfse'` e reembolsada com `cancelOnRefund` → cancela pela `NfeCancellationPort`, nunca pela de NFS-e.
  - Cada `NfeNotIssuableError` vira o `blockReason` correspondente, com `unfreezeEmission` (menos `quota_exceeded`).
  - Reembolso NF-e: `description` é `Venda reembolsada na <plataforma>` (tamanho entre 15 e 255); `ok: false` → `cancel_failed` + aviso ao dono (`tellOwners`).
  - Retry de `cancel_failed` em NF-e chama a porta de NF-e de novo.
  - Acceptance (`integrations.acceptance.spec.ts`, conector sintético de `testing/synthetic-connectors.ts`): fluxo completo Pix pago sem endereço → `needs_attention('customer_address_missing')`.
- [ ] **Step 2: Rodar** `yarn jest src/modules/integrations/application/operation-emitter src/modules/integrations/integrations.acceptance`. Esperado: FAIL.
- [ ] **Step 3: Implementar** conforme as Interfaces. O construtor ganha `NfeIssuancePort`, `NfeCancellationPort`, `CompanyService` e `ConnectorRegistry` (os testes unitários antigos passam os novos como falsos).
- [ ] **Step 4: Rodar** `yarn jest src/modules/integrations`. Esperado: PASS, specs antigos de NFS-e sem edição além do construtor.
- [ ] **Step 5: Commit** `feat(integracoes): emitir e cancelar NF-e pelo tipo guardado na venda`.

### Task 7: Cancelamento recusado pela SEFAZ marca `cancel_failed`

**Files:**
- Create: `shared/events/fiscal-cancellation.events.ts`, `integrations/application/nfe-cancellation-rejected.listener.ts`
- Modify: `nfe/application/nfe-event-outcome.service.ts` (método `rejected`, linhas ~118-175: publicar o evento quando o evento rejeitado é cancelamento), `integrations/domain/integration-operation.repository.ts` e `integrations/infra/typeorm-integration-operation.repository.ts` (`findByInvoice`), `integrations/integrations.module.ts`
- Test: `integrations/application/nfe-cancellation-rejected.listener.spec.ts`, `nfe/application/nfe-event-outcome.service.spec.ts` (caso novo), `integrations/infra/typeorm-integration-operation-rule.repositories.postgres.integration.spec.ts`

**Interfaces:**
- Consumes: `ApplicationEventBus.publishBestEffort`; `IIntegrationOperationRepository.setFiscal`; padrão de evento de `shared/events/live-invoice-authorized.events.ts` e de escuta de `account-notice` (decorator `@OnEvent`).
- Produces:
  ```ts
  export const FISCAL_CANCELLATION_REJECTED = 'fiscal.cancellation.rejected';
  export interface FiscalCancellationRejectedEvent extends ApplicationEvent { name: typeof FISCAL_CANCELLATION_REJECTED; tenantId: string; documentType: 'nfe'; documentId: string; reason: string }
  // repositório
  abstract findByInvoice(invoiceId: string, tenantId: string): Promise<IntegrationOperation | null>;
  ```
  Listener: acha a operação por `invoiceId` com `documentType 'nfe'` e `blockReason 'cancel_requested'`; `setFiscal(id, tenantId, 'needs_attention', 'cancel_failed')`; avisa o dono como na Tarefa 6 (reusar a mesma função, extraída para método público do emitter, `OperationEmitter.markCancelFailed(operation)`). Sem operação de integração para o documento, não faz nada.

- [ ] **Step 1: Testes falhando:** evento para documento ligado a uma operação em `cancel_requested` → vira `needs_attention/cancel_failed`; documento sem operação → nada e nenhum erro; operação de NFS-e com o mesmo id (impossível, mas filtre por tipo) → ignorada; `nfe-event-outcome.service.spec.ts`: a rejeição de um evento de cancelamento publica o evento uma vez, a de uma carta de correção não publica. Postgres: `findByInvoice` respeita o `tenantId` (o guarda `tenant-predicates` passa).
- [ ] **Step 2: Rodar** os specs. Esperado: FAIL.
- [ ] **Step 3: Implementar.** O listener roda sob `runWithTenant(event.tenantId, ...)`. Falha do listener nunca desfaz a rejeição (o bus já é `BestEffort`).
- [ ] **Step 4: Rodar** `yarn jest src/modules/integrations src/modules/nfe src/runtime-wiring.spec.ts`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(integracoes): cancelamento de NF-e recusado vira cancel_failed`.

### Task 8: Retomada automática dos motivos de precondição

**Files:**
- Create: `integrations/jobs/operation-retry.scheduler.ts`
- Modify: `integrations/domain/integration-operation.repository.ts` e `integrations/infra/typeorm-integration-operation.repository.ts` (`listAutoRetryable`), `integrations/application/operation.service.ts` (`retryWaiting`), `integrations/integrations.module.ts`, `worker-app.module.ts`, `runtime-wiring.spec.ts`
- Test: `integrations/application/operation.service.spec.ts`, `integrations/jobs/operation-retry.scheduler.spec.ts`, `integrations/infra/typeorm-integration-operation-rule.repositories.postgres.integration.spec.ts`, `api/src/runtime-wiring.spec.ts`

**Interfaces:**
- Consumes: `OperationEmitter.run(operation)`.
- Produces:
  ```ts
  export const AUTO_RETRY_REASONS: BlockReason[] = ['nfe_production_disabled', 'company_not_ready', 'uf_not_enabled'];
  // repositório (roda como sistema, entre tenants: runAsSystem('integration-auto-retry', ...))
  abstract listAutoRetryable(reasons: BlockReason[], limit: number): Promise<IntegrationOperation[]>; // sem invoiceId, fiscal_status needs_attention, mais antigas primeiro
  // OperationService
  retryWaiting(limit?: number): Promise<number> // quantas tentou (padrão 50), cada uma sob runWithTenant(op.tenantId)
  ```
  Scheduler `@Interval(60000)`, uma execução por vez (mesmo molde de `EventProcessorScheduler`), registrado só no `WorkerAppModule`.

- [ ] **Step 1: Testes falhando:** venda parada em `nfe_production_disabled` com o interruptor ligado depois sai `submitted` sozinha; venda em `customer_address_missing` **não** é tentada; venda com `invoiceId` não é listada; um erro numa venda não impede as outras; `runtime-wiring.spec.ts`: `OperationRetryScheduler` está nos providers do `WorkerAppModule` e **não** no `AppModule`. Postgres: a listagem cruza tenants sob `runAsSystem` e respeita o limite.
- [ ] **Step 2: Rodar** os specs. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Cada tentativa de uma venda que continua presa deixa o mesmo `blockReason` (sem novo aviso por e-mail: `tellOwners` só dispara quando o motivo muda ou na primeira vez; confira o dedupe do listener antes de ligar).
- [ ] **Step 4: Rodar** `yarn jest src/modules/integrations src/runtime-wiring.spec.ts` e os specs Postgres. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(integracoes): retomada automática de vendas paradas por precondição da NF-e`.

### Task 9: API pública aceita `documentType` e `product`

**Files:**
- Modify: `integrations/http/integrations.dto.ts` (`CreateConnectionDto`, `RuleDto`, novo `UpdateConnectionDto`), `integrations/http/integrations.controller.ts` (`present`, `presentRule`, `presentOperation`, novo `PATCH connections/:id`), `integrations/application/connection.service.ts` (`setDocumentType`, `putRules` valida por tipo), `web/lib/proxy-routes.ts` (se a rota `PATCH` entrar), `docs/openapi/*` e `web/public/openapi.json` (gerados), `web/messages/{pt,en}.json` (`ApiErrors`)
- Test: `integrations/http/integrations.controller.spec.ts`, `integrations/application/connection.service.spec.ts`, `api/test/openapi-contract.e2e-spec.ts`, `web/tests/proxy.test.ts`, `web/tests/api-error-codes.test.ts`

**Interfaces:**
- Consumes: Tarefa 1 (`documentType`, `product`, `freezeEmission`).
- Produces (JSON):
  - `POST /integrations/connections` aceita `documentType?: 'nfse' | 'nfe'`; todas as respostas de conexão trazem `documentType`.
  - `PATCH /integrations/connections/{id}` com `{ documentType }` (permissão `integrations.manage`); vale só para vendas futuras; auditoria `integration.document_type_changed`.
  - Regras: `RuleDto.product?: { ncm: string (8 dígitos); unit: string (1 a 6) }`, `unit` padrão `"UN"`; `presentRule` devolve `product`.
  - `PUT .../rules`: conexão `'nfe'` exige `product.ncm` na regra padrão (400 `INTEGRATION_RULE_PRODUCT_REQUIRED`) e dispensa `service`; conexão `'nfse'` exige `service` como hoje e recusa `product` (400 `INTEGRATION_RULE_PRODUCT_NOT_ALLOWED`). `ServiceDto` deixa de ser obrigatório no DTO (a validação passa para o serviço, por tipo).
  - `presentOperation` devolve `documentType`.
  - Erro: trocar o tipo para `'nfe'` com regra padrão sem `product` é permitido (a regra é editada depois); o painel avisa (Tarefa 13).

- [ ] **Step 1: Testes falhando:** criar conexão `'nfe'`; `GET` devolve `documentType`; `PATCH` troca o tipo e grava auditoria; `PUT rules` em conexão `'nfe'` sem `product.ncm` → 400 com o código; NCM com 7 dígitos → 400; regra `'nfse'` com `product` → 400; conexão sem `documentType` no corpo nasce `'nfse'` (compatibilidade); chave de API de teste não troca conexão `live` (mesma regra de ambiente dos outros endpoints). Contrato e2e: `PATCH /integrations/connections/{id}` e os campos novos nos casos de `POST` e `PUT rules` (linha ~827).
- [ ] **Step 2: Rodar** `yarn jest src/modules/integrations/http src/modules/integrations/application/connection` e `yarn test:e2e -- openapi-contract` (nome do script: confira em `api/package.json`). Esperado: FAIL.
- [ ] **Step 3: Implementar** DTOs, controlador (com `@ApiKeyEndpoint()` e `@RequirePermission('integrations.manage')`), serviço e textos `ApiErrors` pt/en dos dois códigos novos. `yarn openapi:generate`.
- [ ] **Step 4: Rodar** os specs acima, `git diff --quiet -- docs/openapi web/public/openapi.json` depois do commit, e `cd web && yarn vitest run tests/proxy.test.ts tests/api-error-codes.test.ts`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(integracoes): API aceita tipo de nota e dados de produto`.

---

## Fase 3: completar os dados que faltam

### Task 10: Endereço e IE guardados no cadastro do cliente

**Files:**
- Create: `api/src/infra/database/migrations/1793900000010-AddNfeDataToCustomers.ts`
- Modify: `invoice/domain/customer-directory.ts`, `invoice/infra/typeorm-customer-directory.ts`, `integrations/domain/saved-customer.port.ts`, `invoice/application/integration-saved-customers.ts`
- Test: `invoice/infra/typeorm-customer-directory.postgres.integration.spec.ts`, `integrations/domain/saved-customer.port.spec.ts` (novo), `integrations/application/operation-emitter.service.spec.ts`

**Interfaces:**
- Produces:
  - Coluna `customers.nfe_data jsonb NULL` = `{ address?: CustomerAddress; stateRegistration?: string }` (tipo `CustomerNfeData` em `customer-directory.ts`).
  - `KnownCustomer` ganha `nfeData: CustomerNfeData | null`.
  - `SavedCustomerPort.remember(tenantId, environment, taxId, nfeData: CustomerNfeData): Promise<void>`; `CustomerDirectory.rememberNfeData(scope, taxId, data)` mescla (campo salvo vazio é preenchido; o que já existe só muda por edição explícita, como o `remember` atual).
  - `completeFromSaved` passa a completar também `address` e `stateRegistration` do cliente da venda **quando a venda não os traz** (o que a plataforma mandou ganha).
- Consumes: `CustomerAddress` (Task 3).

- [ ] **Step 1: Testes falhando:** Postgres: `rememberNfeData` cria/mescla e o RLS impede ler de outro tenant; `completeFromSaved` completa endereço faltante e **não** troca endereço que a plataforma mandou; emitter: venda de Pix sem endereço de comprador já conhecido sai `submitted` sem pendência.
- [ ] **Step 2: Rodar** os specs. Esperado: FAIL.
- [ ] **Step 3: Implementar** migração, diretório, porta e adaptador. Nada de dados novos no cadastro de NFS-e: o campo só é lido por NF-e.
- [ ] **Step 4: Rodar** `yarn jest src/modules/integrations src/modules/invoice` e os Postgres. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(clientes): guardar endereço e IE do comprador para as próximas vendas`.

### Task 11: Resolver venda com endereço, IE e preço por item

**Files:**
- Modify: `integrations/http/integrations.dto.ts` (`SaleAddressDto`, `SaleCustomerDto`, `ResolveOperationDto`), `integrations/http/integrations.controller.ts` (`resolve`), `integrations/application/operation.service.ts` (`ResolveInput`, `toResolution`, `resolve`), `integrations/domain/integration-operation.repository.ts` + `integrations/infra/typeorm-integration-operation.repository.ts` (`applyResolution` aceita `items`), `integrations/application/operation.service.ts` (`detail` devolve `items` e `netCents`), `docs/openapi/*`, `web/messages/{pt,en}.json`
- Test: `integrations/application/operation.service.spec.ts`, `integrations/http/integrations.controller.spec.ts`, `integrations/infra/typeorm-integration-operation-rule.repositories.postgres.integration.spec.ts`, `api/test/openapi-contract.e2e-spec.ts`

**Interfaces:**
- Produces (JSON de `POST /integrations/operations/{id}/resolve`):
  - `customer.address` ganha `number` (1 a 60), `district` (2 a 60), `complement` (até 60); `customer.stateRegistration?: string (até 18)`.
  - Novo `itemPrices?: Array<{ index: number; unitPriceCents: number }>` (`index` é a posição em `snapshot.items`; inteiros positivos). A soma `quantity × unitPriceCents` dos itens tem de ser igual ao líquido da venda, senão 400 `INTEGRATION_ITEM_PRICES_MISMATCH`. Os preços ficam só em `snapshot.items[i].unitPriceCents` da operação (spec 8: não vão para o cadastro).
  - `GET /integrations/operations/{id}` devolve `items: Array<{ description: string | null; quantity: number; unitPriceCents: number | null }>` e `netCents`.
  - O endereço informado e a IE são salvos no cliente por `SavedCustomerPort.remember` (Tarefa 10) depois que a emissão é aceita (nunca antes, para não gravar dado de uma venda que falhou).
  - Validação: CEP 8 dígitos, `municipalityCode` 7 dígitos, `state` 2 letras (já existem); `INVALID_ADDRESS` atual (cidade sem estado) continua.

- [ ] **Step 1: Testes falhando:** resolver `customer_address_missing` com endereço completo e rodar o emitter → NF-e emitida e `remember` chamado uma vez; `item_prices_missing` com preços que fecham → emitida; preços que não fecham → 400 e nada gravado; tentar resolver depois do pedido congelado → 409 `OPERATION_REQUEST_FIXED` (como hoje); `detail` devolve `items`.
- [ ] **Step 2: Rodar** os specs. Esperado: FAIL.
- [ ] **Step 3: Implementar**; `yarn openapi:generate`; `ApiErrors` pt/en do código novo.
- [ ] **Step 4: Rodar** `yarn jest src/modules/integrations`, Postgres, contrato e2e, `git diff --quiet -- docs/openapi web/public/openapi.json`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(integracoes): completar endereço, IE e preços dos itens de uma venda pendente`.

---

## Fase 4: telas do painel

### Task 12: Tipos, rotas e estados no web

**Files:**
- Modify: `web/lib/api.ts` (linhas ~385-419: `IntegrationConnection`, `IntegrationRule`, `IntegrationRuleInput`, `IntegrationSale`, `IntegrationSaleDetail`, `ResolveSaleInput`, `SaleAddress`, `CreateIntegrationInput`, novo `integrations.setDocumentType`), `web/lib/integrations.ts` (`saleStatus`, `ConnectInput`, `connectProvider`), `web/lib/proxy-routes.ts` (`PATCH` em `integrations/connections/<id>`)
- Test: `web/tests/integrations.test.ts` (ou o spec existente de `lib/integrations`), `web/tests/proxy.test.ts`

**Interfaces:**
- Consumes: JSON da Tarefa 9 e 11.
- Produces: `IntegrationConnection.documentType`, `IntegrationRule.product`, `IntegrationSale.documentType`; `IntegrationSaleDetail.items`/`netCents`; `ConnectInput.documentType: 'nfse' | 'nfe'` e `ConnectInput.product?: { ncm: string; unit: string }`; `connectProvider` manda `documentType` no `create` e, para `'nfe'`, `putRules(..., [{ product, sendEmail }])` (sem `service`); `saleStatus`: `customer_address_missing`, `customer_name_missing` e `item_prices_missing` viram `waitingCustomer` (`canResolve: true, canRetry: true`); os três de precondição viram `needsAttention` com `canRetry: true`.

- [ ] **Step 1: Testes falhando:** `saleStatus` para os motivos novos; `connectProvider` com `'nfe'` chama `create` com `documentType: 'nfe'` e `putRules` com `product` e sem `service`; com `'nfse'` o corpo é idêntico ao de hoje (golden); allowlist aceita `PATCH integrations/connections/abc` e recusa `DELETE`.
- [ ] **Step 2: Rodar** `cd web && yarn vitest run tests/integrations.test.ts tests/proxy.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** os testes e `yarn typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(web): tipos e estados das vendas de produto`.

### Task 13: Conectar plataforma: seletor de tipo, NCM e unidade

**Files:**
- Modify: `web/components/dashboard/integrations/connect-flow.tsx`, `web/messages/{pt,en}.json` (`Integrations.connect.*`)
- Test: `web/tests/` do componente (siga o spec existente de `connect-flow`, se houver; senão `web/tests/connect-flow.test.tsx`)

**Interfaces:**
- Consumes: `ConnectInput` (Task 12); `NcmHelp`/link "Não sabe o NCM?" e a validação de NCM do formulário manual (`web/components/nfe/nfe-items-editor.tsx` e `web/lib/nfe-form.ts`; reuse o mesmo componente/função, não copie); aviso de prontidão da empresa: `companies/{id}/nfe-settings` (já na allowlist) e o cálculo de pendências que o formulário de NF-e já usa.
- Produces: no fluxo, `Select`/`Field` "Tipo de nota: Serviço (NFS-e) / Produto (NF-e)"; com Produto, campos NCM (8 dígitos) e Unidade (padrão `UN`), com o link; botão de conectar desabilitado com NCM inválido; aviso (não bloqueia) quando a empresa não está pronta para NF-e ou quando o ambiente é produção e a NF-e em produção não está liberada (`NFE_PRODUCTION_ENABLED` aparece em `GET /public-config`? confira `api/src/modules/public-config`; se não aparece, o aviso fica só para empresa incompleta e o motivo `nfe_production_disabled` cobre o resto).

- [ ] **Step 1: Testes falhando:** escolher Produto mostra NCM e unidade e esconde nada de NFS-e; NCM com 7 dígitos desabilita; enviar chama `connectProvider` com `documentType: 'nfe'` e `product: { ncm, unit }`; sem mexer no seletor, o envio é o de hoje; aviso aparece quando a empresa não tem o cadastro de NF-e completo.
- [ ] **Step 2: Rodar** o teste. Esperado: FAIL.
- [ ] **Step 3: Implementar** com os componentes `Select`/`Field` já usados no arquivo.
- [ ] **Step 4: Rodar** teste, `yarn typecheck`, `yarn lint:check`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(web): escolher serviço ou produto ao conectar uma plataforma`.

### Task 14: Detalhe da conexão e regras por produto

**Files:**
- Modify: `web/components/dashboard/integrations/connection-settings.tsx`, `connection-info.tsx`, `web/messages/{pt,en}.json`
- Test: `web/tests/connection-settings.test.tsx` (novo ou o existente)

**Interfaces:**
- Consumes: `IntegrationRule.product`, `IntegrationRuleInput.product`, `integrations.setDocumentType` (Task 12).
- Produces: `connection-info` mostra o tipo ("Nota de serviço (NFS-e)" / "Nota de produto (NF-e)"); `connection-settings` em conexão de produto mostra NCM e unidade da regra padrão (editáveis, mesma validação da Tarefa 13) e a lista "outras regras" mostra NCM/unidade em vez de serviço; `toInput` preserva `product` das regras por produto ao salvar; botão "Trocar tipo de nota" com confirmação que diz "vale só para vendas novas", que chama `setDocumentType`.

- [ ] **Step 1: Testes falhando:** salvar em conexão `'nfe'` manda `product` e **não** manda `service`; regra por produto com `product` sobrevive ao salvar; trocar o tipo mostra a confirmação e chama a API só ao confirmar.
- [ ] **Step 2: Rodar** o teste. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** teste, `yarn typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(web): tipo de nota e NCM no detalhe da conexão`.

### Task 15: Vendas pendentes: endereço com CEP, preço por item e IE

**Files:**
- Modify: `web/components/dashboard/integrations/sale-resolve-form.tsx` (linha ~190 trata só `customer_tax_id_missing`), `pending-sales-panel.tsx`, `web/messages/{pt,en}.json`
- Test: `web/tests/sale-resolve-form.test.tsx`

**Interfaces:**
- Consumes: `lookupCep(cep, signal)` de `web/lib/viacep.ts` (devolve `street`, `district`, `city`, `state`, `ibge`); `ResolveSaleInput` com `customer.address` (`number`, `district`, `complement`, `municipalityCode`) e `itemPrices`, `IntegrationSaleDetail.items` (Tarefas 11 e 12).
- Produces: para `customer_address_missing`, bloco de endereço (CEP preenche rua, bairro, cidade, UF e `municipalityCode` pelo IBGE; número e complemento digitados; CEP inexistente mostra erro e deixa digitar à mão); para `item_prices_missing`, uma linha por item com o preço unitário e a soma ao vivo contra o total líquido (botão desabilitado enquanto não fechar); para `customer_name_missing`, campo de nome; campo opcional "Inscrição estadual" quando o documento tem 14 dígitos. Envio monta `ResolveSaleInput` e chama `integrations.resolve`.

- [ ] **Step 1: Testes falhando:** CEP válido preenche os campos (mock de `lookupCep`); CEP inexistente mostra o erro; preços que não fecham desabilitam o envio, que fecham habilitam e mandam `itemPrices` em centavos; IE só aparece para CNPJ; sem os motivos novos o formulário é o de hoje.
- [ ] **Step 2: Rodar** o teste. Esperado: FAIL.
- [ ] **Step 3: Implementar** (centavos como inteiros, sem `float`; use o helper de dinheiro que o formulário de NF-e já usa em `web/lib/nfe-form.ts`).
- [ ] **Step 4: Rodar** teste, `yarn typecheck`, `yarn lint:check`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(web): completar endereço e preços dos itens em vendas pendentes`.

### Task 16: Lista de vendas aponta para a NF-e

**Files:**
- Modify: `web/components/dashboard/integrations/sales-list.tsx` (linha ~77), `web/messages/{pt,en}.json` (`sales.viewNfe`)
- Test: `web/tests/sales-list.test.tsx`

**Interfaces:**
- Consumes: `IntegrationSale.documentType` (Task 12).
- Produces: venda com `invoiceId` e `documentType === 'nfe'` leva a `/app/nfe/${invoiceId}` (página existente), com o texto "Ver NF-e"; `'nfse'` segue para `/app/invoices/${invoiceId}`.

- [ ] **Step 1: Teste falhando:** os dois links, pelo tipo.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** teste e `yarn typecheck`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(web): link da NF-e na lista de vendas da integração`.

---

## Fase 5: conectores e documentação

### Task 17: Endereço, pagamento e preço nos conectores que já estão na `main`

**Files:**
- Modify: `integrations/connectors/{kiwify,hotmart,stripe}/*.connector.ts` (e `kiwify.payload.ts`), seus `__fixtures__/` e specs; `woovi`, `abacatepay`, `pushinpay` só ganham `paymentMethod: 'pix'` (e `'boleto'` no `pushinpay` quando o fixture `boleto-paid.json` diz boleto)
- Test: `*.connector.spec.ts` de cada conector, `connectors/no-buyer-email.spec.ts` (confirmar que segue verde)

**Interfaces:**
- Consumes (Task 3): `CustomerAddress.{number,district,complement}`, `NormalizedOperation.{paymentMethod,freightCents}`, `items[].unitPriceCents`.
- Produces: cada conector preenche **só o que a plataforma realmente manda**. Verifique campo a campo contra a documentação oficial e os fixtures **antes** de mapear; se o payload não traz um dado (hoje os fixtures de Stripe e Hotmart têm só `country`), o conector não inventa e a venda cai em "Vendas pendentes". Expectativas a confirmar: Kiwify (`payment_method` já existe no fixture: `credit_card` → `'credit_card'`, `pix`, `boleto`), Hotmart (`buyer.address` e `payment.type`), Stripe (`customer_details.address`: só vira `CustomerAddress` completo se vierem rua **e** número separados; `line1` sozinho não serve para número/bairro, então fica pendente). Pix (Woovi, AbacatePay, PushinPay): `paymentMethod: 'pix'`, sem endereço.

- [ ] **Step 1: Testes falhando** por conector, com fixture real ou atualizado a partir da documentação (cite a URL da documentação no `__fixtures__/README.md` do conector): o `normalize` devolve `paymentMethod` e, quando o payload traz, `address` completa; sem endereço no payload → `address` ausente (nunca objeto parcial com campos vazios).
- [ ] **Step 2: Rodar** `yarn jest src/modules/integrations/connectors`. Esperado: FAIL.
- [ ] **Step 3: Implementar** os mapeamentos.
- [ ] **Step 4: Rodar** `yarn jest src/modules/integrations/connectors` e os `*.flow.postgres.integration.spec.ts`. Esperado: PASS (NFS-e inalterada: os specs antigos passam sem edição).
- [ ] **Step 5: Commit** `feat(conectores): meio de pagamento e endereço do comprador quando a plataforma informa`.

### Task 18 (opcional): Mesma coisa nos conectores que entrarem na `main`

**Files:**
- Modify: `integrations/connectors/<id>/*` dos conectores presentes na `main` na hora da execução. Hoje só em branch: `mercadopago` (`additional_info.payer.address`), `pagarme` (`customer.address`), `asaas` (`/customers`), `eduzz`, `monetizze`.
- Test: specs e fixtures de cada um.

**Interfaces:**
- Consumes/Produces: igual à Tarefa 17. Antes de começar: `git fetch && git ls-tree --name-only origin/main api/src/modules/integrations/connectors/`. Conector ausente da `main` não entra (não mexer em branch alheio); se nenhum entrou, pular a tarefa e registrar na descrição do PR da fase.

- [ ] **Step 1 a 5:** como a Tarefa 17, um commit por conector (`feat(conectores): <plataforma> informa endereço e pagamento`).

### Task 19: Documentação, página de integrações e blog

**Files:**
- Modify: `web/lib/docs/content/pt.ts` e `en.ts` (página de integrações, tabela de motivos perto da linha 2905 do `en.ts`, referência de conexão/regras), `web/lib/integrations-catalog.ts` e o texto da página pública `/integrations`, artigos de blog que citam integrações (ver `web/` por `blog` e o commit `eb549a02`), `web/public/openapi.json` (já gerado)
- Test: `web/tests/docs-content.test.ts` (o teste que cobre pt/en em paridade; se não houver, `web/tests/docs-parity.test.ts` que confere que toda chave de `pt.ts` existe em `en.ts`)

**Interfaces:**
- Consumes: tudo acima.
- Produces: seção "Serviço ou produto" (como escolher, NCM e unidade, o que sai sozinho, o que vai para pendentes, reembolso e prazo da SEFAZ com o aviso do contador, NF-e em teste desde já e produção atrás do interruptor), a tabela de motivos com os cinco novos, exemplos JSON de `documentType`/`product`, e a linha "também emite nota de produto (NF-e)" na página `/integrations` e nos artigos de blog. Textos simples, sem jargão; pt e en.

- [ ] **Step 1: Teste falhando:** paridade pt/en do conteúdo novo e presença dos cinco motivos na tabela de ambos os idiomas.
- [ ] **Step 2: Rodar** `cd web && yarn vitest run tests/docs-content.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Escrever** o conteúdo.
- [ ] **Step 4: Rodar** teste, `yarn typecheck`, `yarn lint:check`, e `cd api && yarn openapi:generate && git diff --quiet -- docs/openapi web/public/openapi.json`. Esperado: PASS.
- [ ] **Step 5: Commit** `docs(integracoes): escolher serviço ou produto e emitir NF-e pela integração`.

---

## Auto-revisão

- **Cobertura da spec:** 1 (Tarefas 1, 9, 13), 2 (1, 3, 9, 14), 3 (3, 5, 6, 10, 11, 17), 4 (6, 7), 5 (12 a 16), 6 (9, 11, 19; MCP sem tarefa, Decisões 2), 7 (5, 6, 8, 13), 8 (6, 8, 10 e Decisões). Os cinco itens do Review Focus têm teste nas Tarefas 1, 3, 5, 6 e 7.
- **Consistência de nomes:** `IntegrationDocumentType`, `documentType`, `product { ncm, unit }`, `buildNfeRequest`, `splitUnitPrices`, `cfopFor`, `NfeIssuancePort`/`NfeCancellationPort`/`NfeNotIssuableError`, `AUTO_RETRY_REASONS`, `findByInvoice`, `listAutoRetryable`, `rememberNfeData`, `itemPrices` usados igual nas tarefas que produzem e nas que consomem.
- **Proporção:** a spec tem 117 linhas e o plano é maior porque cobre API, worker, web e conectores em 19 tarefas; os corpos de código ficaram de fora e só as assinaturas, valores da spec e testes estão escritos.
