# Integração Stripe (conta do cliente) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conector `stripe`: pagamentos de Checkout avulso e faturas de assinatura pagas na conta Stripe do cliente emitem a NFS-e automaticamente, uma nota por pagamento.

**Architecture:** Módulo `integrations/connectors/stripe` com o contrato `Connector`. Usa o SDK `stripe` para verificar assinatura e consultar o objeto atual. É independente do webhook de billing do próprio Corvo (`webhooks/stripe`): credenciais e rota são outras.

**Tech Stack:** NestJS, SDK `stripe` (já usado em `stripe-billing.adapter.ts`; reutilizar a versão do `package.json`), Jest.

**Spec:** `docs/superpowers/specs/2026-10-29-payment-integrations-design.md` (seção 10, Stripe). Depende da infraestrutura e recomenda Woovi e AbacatePay concluídas.

## Global Constraints

- Identificador: `stripe`. Credenciais: `restrictedKey` (`rk_...`, secreta) e `webhookSigningSecret` (`whsec_...`, secreta), ambos da conta do cliente. Nunca usar as variáveis de billing do Corvo.
- Assinatura: `Stripe-Signature` verificada com `stripe.webhooks.constructEvent(rawBody, header, webhookSigningSecret)`, tolerância padrão do SDK.
- Ambiente: `event.livemode` (`true` → `live`). Conta: o `externalAccountId` da conexão é o `acct_...` devolvido por `stripe.accounts.retrieve()` na validação.
- Escopo do primeiro fluxo: `checkout.session.completed` (com `payment_status = 'paid'`), `checkout.session.async_payment_succeeded`, `invoice.paid`, `charge.refunded`. Demais eventos → `ignored`. Somente `currency = 'brl'`.
- Identidade: `operationKey = 'pi:' + paymentIntentId` quando existir; senão `'in:' + invoiceId`; senão `'cs:' + sessionId`. Checkout, fatura e PaymentIntent do mesmo pagamento precisam convergir.
- Consulta ao Stripe só com a chave restrita do cliente, com permissões mínimas de leitura (Checkout Sessions, Invoices, PaymentIntents, Customers, Charges) documentadas no manifesto.
- Mesmas regras de estilo e comandos do plano de infraestrutura.

## Review Focus

1. Checkout assíncrono (`checkout.session.completed` com `payment_status = 'unpaid'`): não emite; emite só em `async_payment_succeeded`. Teste na Task 2.
2. Pagamento de assinatura gera `invoice.paid`, `payment_intent.succeeded` e `charge.succeeded`: uma só `operationKey`. Teste na Task 3.
3. Reembolso parcial (`charge.refunded` com `amount_refunded < amount`): `commercialState = 'refunded'` com `externalRefs.partial = 'true'` e pendência, nunca cancelamento. Teste na Task 3.
4. Cliente sem CPF/CNPJ: Stripe não coleta `tax_ids` brasileiros por padrão; tomador sem documento vira pendência. Teste na Task 3.
5. Moeda diferente de BRL: bloqueio `unsupported_currency` (vem do motor comum); o conector só garante `currency` correta. Teste na Task 3.

---

### Task 1: Fixtures com a conta Stripe em modo teste

**Files:**
- Create: `connectors/stripe/__fixtures__/*.json` — `checkout-session-completed-paid.json`, `checkout-session-completed-unpaid.json`, `checkout-async-payment-succeeded.json`, `invoice-paid.json`, `charge-refunded-full.json`, `charge-refunded-partial.json`, `payment-intent-succeeded.json`
- Create: `connectors/stripe/README.md`

- [ ] **Step 1: Com a Stripe CLI (`stripe listen --forward-to` para um receptor temporário e `stripe trigger`)** ou uma conta de teste, gerar os eventos acima em BRL, e salvar corpo bruto, cabeçalho `Stripe-Signature` e o `whsec_` do listener.
- [ ] **Step 2: Registrar no README** onde estão, em cada evento, os campos: valor (`amount_total`, `amount_paid`), moeda, e-mail e nome do cliente, `tax_ids`/`customer_details.tax_ids`, `payment_intent`, `invoice`, `subscription`, `created`/`status_transitions.paid_at`, descrição de itens (`line_items` exige expandir) e produto (`price.product`). Confirmar também se `checkout.session.completed` traz `customer_details.tax_ids` quando a sessão coleta documento.
- [ ] **Step 3: Commit**

```bash
git add api/src/modules/integrations/connectors/stripe
git commit -m "docs(integrations): eventos reais da Stripe para fixtures"
```

---

### Task 2: Autenticação, parse e Checkout

**Files:**
- Create: `connectors/stripe/stripe.connector.ts` (`authenticate`, `parse`, parte de `normalize` para Checkout), `stripe.manifest.ts`, `stripe.client.ts`
- Test: `stripe.connector.checkout.spec.ts`

**Interfaces:**
- Produces:
  - `StripeClient { constructEvent(rawBody: Buffer, signature: string, secret: string): Stripe.Event; retrieveSession(key: string, id: string): Promise<Stripe.Checkout.Session> (expand: line_items, customer, payment_intent); retrieveInvoice(key: string, id: string): Promise<Stripe.Invoice>; retrieveAccountId(key: string): Promise<string> }`; erros 401/403 → `ConnectorAuthError`; 429/5xx/rede → `ConnectorTransientError`.
  - `authenticate`: usa `constructEvent`; falha → `{ ok: false, reason: 'bad_signature' }`; cabeçalho ausente → `missing_signature`.
  - `parse`: `operation` para os quatro tipos suportados com `deliveryId = event.id`, `environment = event.livemode ? 'live' : 'test'`; `ignored` para os demais; Checkout com `payment_status = 'unpaid'` → `ignored` (será tratado por `async_payment_succeeded`).
  - `normalize` para Checkout: consulta a sessão atual (nunca confia só no corpo do webhook), `operationKey` pela regra de identidade, `customer` de `customer_details`.

- [ ] **Step 1: Write the failing tests**

```ts
it('accepts the real fixture signature and rejects an altered body', ...);
it('rejects a missing Stripe-Signature header', ...);
it('parse: livemode false -> test, true -> live', ...);
it('parse: checkout.session.completed unpaid -> ignored', ...);
it('parse: checkout.session.completed paid -> operation', ...);
it('parse: checkout.session.async_payment_succeeded -> operation', ...);
it('parse: customer.created -> ignored', ...);
it('normalize(checkout paid) retrieves the current session and builds the NormalizedOperation from it', ...);
it('operationKey is pi:<paymentIntent> when the session has one', ...);
it('transient client error -> ConnectorTransientError; 401 -> ConnectorAuthError', ...);
```

- [ ] **Step 2: Run tests to verify they fail** — `cd api && npx jest src/modules/integrations/connectors/stripe` → FAIL.
- [ ] **Step 3: Implement** `StripeClient` com `new Stripe(key, { apiVersion })` por chamada (a chave é do cliente; não manter instância global) e `timeout: 10000`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/src/modules/integrations/connectors/stripe
git commit -m "feat(integrations): Stripe — assinatura, leitura do evento e Checkout"
```

---

### Task 3: Faturas, convergência de identidade e reembolsos

**Files:**
- Modify: `stripe.connector.ts` (`normalize` para `invoice.paid` e `charge.refunded`)
- Test: `stripe.connector.invoice-refund.spec.ts`

**Interfaces:**
- Produces: `normalize(invoice.paid)` consulta a fatura, usa `payment_intent` como chave quando existir (`pi:`) senão `in:`; `externalRefs = { invoice, subscription?, paymentIntent?, charge? }`; `paidAt` = `status_transitions.paid_at`. `normalize(charge.refunded)` resolve a mesma `operationKey` (via `payment_intent` do charge), `commercialState = 'refunded'`, e `externalRefs.partial = 'true'` quando `amount_refunded < amount`. `customer.taxId` vem de `tax_ids` com `type = 'br_cpf' | 'br_cnpj'` quando houver; senão `null`.

- [ ] **Step 1: Write the failing tests**

```ts
it('Checkout paid, invoice.paid and the payment_intent of the same payment share one operationKey', ...);
it('subscription cycle 1 and cycle 2 have different operationKeys', ...);
it('invoice.paid without payment_intent falls back to in:<invoice>', ...);
it('charge.refunded full -> refunded with the same key as the payment', ...);
it('charge.refunded partial -> refunded and externalRefs.partial true', ...);
it('taxId from a br_cpf tax id', ...);
it('taxId null when the customer has no brazilian tax id', ...);
it('currency usd is passed through as USD (the common engine blocks it)', ...);
it('amountCents is an integer taken from amount_paid / amount_total, never a float', ...);
```

- [ ] **Step 2: Run tests to verify they fail** — mesmo comando → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/src/modules/integrations/connectors/stripe
git commit -m "feat(integrations): Stripe — faturas de assinatura, convergência de identidade e reembolsos"
```

---

### Task 4: Validação da conexão, módulo, fluxo e documentação

**Files:**
- Modify: `stripe.connector.ts` (`validateConnection`)
- Create: `connectors/stripe/stripe.module.ts`
- Modify: `api/src/app.module.ts`; `web/lib/docs/content/pt.ts`, `en.ts` (guia "Conectar a Stripe": criar chave restrita com as permissões de leitura listadas, criar o endpoint de webhook no painel com os quatro eventos, copiar o `whsec_`, criar a conexão, regras por produto); `web/tests/docs-integrations.test.ts`
- Test: `stripe.flow.spec.ts`

**Interfaces:**
- `validateConnection({ restrictedKey, webhookSigningSecret })` → `{ externalAccountId }` com o id da conta (`acct_...`); rejeita chave que não começa com `rk_` com `ConnectorDataError('Use uma chave restrita (rk_...)')`.

- [ ] **Step 1: Write the failing tests**

```ts
it('providers lists stripe with both fields secret and no values', ...);
it('validateConnection returns the acct id and rejects a non-restricted key', ...);
it('signed checkout paid creates one invoice', ...);
it('invoice.paid + payment_intent.succeeded + checkout for the same payment create one invoice', ...);
it('livemode true on a test connection answers 200 and creates nothing', ...);
it('partial refund after the invoice exists flags refund_after_invoice and cancels nothing', ...);
it('does not read or use the billing STRIPE_* environment variables', ...); // espiona ConfigService
it('docs guide lists the four events and the read permissions in pt and en', ...);
```

- [ ] **Step 2: Run to verify it fails** — `cd api && npx jest src/modules/integrations/connectors/stripe/stripe.flow.spec.ts && cd ../web && npx vitest run tests/docs-integrations.test.ts` → FAIL.
- [ ] **Step 3: Implement** módulo, registro e guia.
- [ ] **Step 4: Run the suites** — `cd api && npx jest && npx tsc --noEmit -p tsconfig.json; cd ../web && npx vitest run` → PASS.
- [ ] **Step 5: Homologação manual (registrar no PR):** com a Stripe CLI em modo teste, Checkout pago → nota em `test`; assinatura com dois ciclos → duas notas; reembolso parcial → pendência.
- [ ] **Step 6: Commit**

```bash
git add api/src web
git commit -m "feat(integrations): conector Stripe da conta do cliente, testado e documentado"
```

---

## Self-review

- **Cobertura da spec (seção 10, Stripe):** assinatura pelo SDK (Task 2), chave restrita e credenciais próprias (Tasks 2 e 4), gatilhos e convergência de identidade (Tasks 2 e 3), assinaturas por ciclo (Task 3), reembolso (Task 3), ambiente por `livemode` (Tasks 2 e 4), documentação (Task 4).
- **Risco declarado:** `tax_ids` brasileiros não são coletados por padrão pela Stripe; na prática muitos pagamentos vão cair em pendência de tomador. O guia deve orientar a coletar o CPF/CNPJ no Checkout.
