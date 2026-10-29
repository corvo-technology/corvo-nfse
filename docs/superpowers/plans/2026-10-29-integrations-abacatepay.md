# Integração AbacatePay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conector `abacatepay` (API v2): Checkout e pagamento transparente pagos na conta AbacatePay do cliente emitem a NFS-e automaticamente.

**Architecture:** Módulo `integrations/connectors/abacatepay` que implementa o contrato `Connector`. O `webhookSecret` é gerado pelo Corvo e vai na URL; a assinatura do corpo é conferida em seguida. Nenhuma alteração no núcleo.

**Tech Stack:** NestJS, `crypto.createHmac`, `fetch` nativo, Jest.

**Spec:** `docs/superpowers/specs/2026-10-29-payment-integrations-design.md` (seção 10, AbacatePay). Depende da infraestrutura e recomenda ter o plano da Woovi concluído (reaproveita o padrão).

## Global Constraints

- Identificador: `abacatepay`. Credenciais: `apiKey` (secreta) e `webhookSecret` (secreta, gerada pelo Corvo na criação).
- Autenticação em duas camadas: `?webhookSecret=` da URL igual ao salvo (tempo constante) **e** `X-Webhook-Signature` = HMAC-SHA256 base64 do corpo bruto com a chave pública documentada pela AbacatePay.
- O parâmetro `webhookSecret` nunca aparece em log, erro, Sentry nem banco além de `credentials_enc`.
- Envelope v2: `{ id, event, apiVersion, devMode, data }`. `deliveryId = id`. `devMode` define o ambiente (`true` → `test`).
- Gatilhos de pagamento: `checkout.completed`, `transparent.completed`. Estado: `*.refunded` → `refunded`, `*.disputed` → `disputed`. Demais eventos → `ignored`.
- `taxId` do evento vem mascarado; usar o documento completo só se a API de cliente devolver (Task 1 define).
- Mesmas regras de estilo e comandos do plano de infraestrutura.

## Review Focus

1. Segredo da URL correto e assinatura inválida: rejeita. Segredo errado e assinatura válida: rejeita. Teste na Task 2.
2. `devMode: true` numa conexão `live` (e o inverso): descartado, nunca emite. Coberto pela infraestrutura via `ParsedDelivery.environment`; teste do `parse` na Task 2.
3. `customer: null` no evento: `customer = null` e o motor trata como tomador ausente. Teste na Task 3.
4. Reenvio manual com novo `id` do envelope e mesma cobrança: mesma `operationKey`, uma só nota. Teste na Task 3.
5. `taxId` mascarado sem documento completo disponível: `taxIdMasked = true`, nada inventado. Teste na Task 3.

---

### Task 1: Confirmar o formato real com a conta de teste

**Files:**
- Create: `connectors/abacatepay/__fixtures__/checkout-completed.json`, `transparent-completed.json`, `checkout-refunded.json`, `checkout-disputed.json` (cada um com corpo bruto, cabeçalhos e a assinatura real)
- Create: `connectors/abacatepay/README.md`

**Interfaces:**
- Produces: fixtures sanitizadas e as respostas registradas no README.

- [ ] **Step 1: Criar a conta, gerar uma chave de API em modo dev e cadastrar o webhook** apontando para um receptor temporário com `?webhookSecret=` de teste. Pagar um Checkout e um pagamento transparente em `devMode`; provocar um reembolso.
- [ ] **Step 2: Salvar o corpo bruto e os cabeçalhos** e responder no README, com data: formato e unidade de `data.amount`; campos de `data.customer` (nome, e-mail, `taxId`); onde vão `externalId`/`metadata` e o id da cobrança individual (para a `operationKey`); como identificar a conta (id estável) no evento ou numa chamada autenticada com a `apiKey`; de onde vem a chave pública usada no HMAC (a documentação só mostra a constante `ABACATEPAY_PUBLIC_KEY`); se existe consulta de cliente que devolve o documento completo.
- [ ] **Step 3: Verificar a assinatura num script descartável** com o corpo salvo e a chave pública. Expected: igual ao cabeçalho. Se não for, registrar o que difere antes de seguir.
- [ ] **Step 4: Commit**

```bash
git add api/src/modules/integrations/connectors/abacatepay
git commit -m "docs(integrations): payloads reais da AbacatePay para fixtures"
```

---

### Task 2: Autenticação e parse

**Files:**
- Create: `connectors/abacatepay/abacatepay.connector.ts` (partes `authenticate` e `parse`), `abacatepay.manifest.ts`
- Test: `abacatepay.connector.auth.spec.ts`

**Interfaces:**
- Produces:
  - Manifesto: `id = 'abacatepay'`, `credentialFields = [{ key: 'apiKey', label: 'API key', secret: true }, { key: 'webhookSecret', label: 'Webhook secret', secret: true }]`. O `webhookSecret` é gerado pelo Corvo quando o cliente não envia (a API de conexões da infraestrutura aceita campos opcionais com `generate: true` no manifesto: acrescentar `generate?: boolean` em `CredentialField` e tratar em `ConnectionService.create` com 24 bytes aleatórios em base64url). A resposta da conexão traz `webhookUrl` já com `?webhookSecret=` **apenas na criação**.
  - `authenticate`: `bad_secret` quando o parâmetro difere; `missing_signature`; `bad_signature`.
  - `parse`: `operation` para `checkout.completed`/`transparent.completed`/`*.refunded`/`*.disputed` com `deliveryId = id`, `environment = devMode ? 'test' : 'live'`; `ignored` para os demais.

- [ ] **Step 1: Write the failing tests**

```ts
it('accepts the real fixture with the right secret and signature', ...);
it('rejects the right signature with a wrong webhookSecret', ...);
it('rejects the right secret with a wrong signature', ...);
it('rejects a body altered by one byte', ...);
it('compares secrets in constant time (uses timingSafeEqual)', ...); // espiona crypto.timingSafeEqual
it('parse: checkout.completed -> operation, environment from devMode', ...);
it('parse: devMode true -> environment test; false -> live', ...);
it('parse: transfer.completed -> ignored', ...);
it('error messages and rejection reasons never contain the secret', ...);
```

- [ ] **Step 2: Run tests to verify they fail** — `cd api && npx jest src/modules/integrations/connectors/abacatepay` → FAIL.
- [ ] **Step 3: Implement** com `createHmac('sha256', publicKey).update(rawBody).digest('base64')` e `timingSafeEqual` sobre buffers de mesmo tamanho (comparar comprimentos antes).
- [ ] **Step 4: Run** o mesmo comando → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/src/modules/integrations
git commit -m "feat(integrations): AbacatePay — segredo da URL, assinatura HMAC e leitura do evento"
```

---

### Task 3: Normalização e validação da conexão

**Files:**
- Modify: `abacatepay.connector.ts` (`normalize`, `validateConnection`)
- Create: `abacatepay.client.ts`
- Test: `abacatepay.connector.normalize.spec.ts`

**Interfaces:**
- Produces:
  - `AbacatePayClient { accountId(apiKey: string): Promise<string>; customerTaxId(apiKey: string, customerId: string): Promise<string | null> }` — chamadas confirmadas na Task 1; 401/403 → `ConnectorAuthError`; 429/5xx/rede → `ConnectorTransientError`.
  - `normalize` devolve `NormalizedOperation` com `operationKey` baseada no id da cobrança individual definido no README; `commercialState` por evento (`completed` → `paid`, `refunded` → `refunded`, `disputed` → `disputed`); `customer` do evento, completando o `taxId` por `customerTaxId` quando mascarado e o cliente tem id; `taxIdMasked = true` se continuar mascarado.

- [ ] **Step 1: Write the failing tests**

```ts
it('normalizes checkout-completed.json and transparent-completed.json to the expected objects', ...);
it('refunded and disputed fixtures keep the same operationKey as the paid one', ...);
it('customer null -> customer null', ...);
it('masked taxId is completed from the customer lookup when it returns a full document', ...);
it('masked taxId stays masked and flagged when the lookup returns nothing', ...);
it('the lookup failing with a transient error propagates ConnectorTransientError', ...);
it('manual resend with another envelope id yields the same operationKey', ...);
it('validateConnection returns the account id', ...);
```

- [ ] **Step 2: Run tests to verify they fail** — mesmo comando → FAIL.
- [ ] **Step 3: Implement** com `fetch` e `AbortSignal.timeout(10000)`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/src/modules/integrations
git commit -m "feat(integrations): AbacatePay — normalização, reembolso e documento do cliente"
```

---

### Task 4: Módulo, registro, fluxo e documentação

**Files:**
- Create: `connectors/abacatepay/abacatepay.module.ts`
- Modify: `api/src/app.module.ts`; `web/lib/docs/content/pt.ts`, `en.ts` (guia "Conectar a AbacatePay"); `web/tests/docs-integrations.test.ts`
- Test: `abacatepay.flow.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('providers lists abacatepay with both fields secret and no values', ...);
it('creating the connection returns a webhookUrl with the generated webhookSecret once, and GET never returns it again', ...);
it('signed checkout.completed creates one invoice', ...);
it('devMode true on a live connection answers 200 and creates nothing', ...);
it('refund after the invoice exists leaves the invoice and flags refund_after_invoice', ...);
it('docs guide mentions webhookSecret and checkout.completed in pt and en', ...);
```

- [ ] **Step 2: Run to verify it fails** — `cd api && npx jest src/modules/integrations/connectors/abacatepay/abacatepay.flow.spec.ts && cd ../web && npx vitest run tests/docs-integrations.test.ts` → FAIL.
- [ ] **Step 3: Implement** o módulo, o registro e o guia nas duas línguas.
- [ ] **Step 4: Run the suites** — `cd api && npx jest && npx tsc --noEmit -p tsconfig.json; cd ../web && npx vitest run` → PASS.
- [ ] **Step 5: Homologação manual (registrar no PR):** Checkout pago em `devMode` → nota em `test`; reenvio manual do webhook → sem segunda nota; reembolso → pendência `refund_after_invoice`.
- [ ] **Step 6: Commit**

```bash
git add api/src web
git commit -m "feat(integrations): conector AbacatePay registrado, testado e documentado"
```

---

## Self-review

- **Cobertura da spec (seção 10, AbacatePay):** segredo na URL e HMAC (Task 2), eventos e ambiente por `devMode` (Task 2), `taxId` mascarado (Task 3), reenvio com novo id (Task 3), docs e homologação (Task 4). Pontos que dependem da conta real (unidade do valor, id da cobrança, origem da chave pública) estão na Task 1.
- **Mudança no núcleo:** apenas `CredentialField.generate` e o tratamento em `ConnectionService.create`, que é uma extensão do contrato de manifesto, não uma condição por plataforma.
