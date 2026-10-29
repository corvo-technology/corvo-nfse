# Integração Woovi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conector `woovi`: cobrança Pix paga na conta Woovi do cliente emite a NFS-e automaticamente.

**Architecture:** Módulo `integrations/connectors/woovi` que implementa o contrato `Connector` e se registra no `ConnectorRegistry` na inicialização. Nenhuma alteração no núcleo.

**Tech Stack:** NestJS, `crypto.createVerify('sha256')` (RSA), `fetch` nativo, Jest.

**Spec:** `docs/superpowers/specs/2026-10-29-payment-integrations-design.md` (seção 10, Woovi). Depende de `docs/superpowers/plans/2026-10-29-integrations-infrastructure.md` concluído.

## Global Constraints

- Identificador do conector: `woovi`. Credencial: `appId` (secreta).
- Cabeçalho de assinatura: `x-webhook-signature`, RSA-SHA256, base64, sobre o corpo bruto.
- Chave pública: `GET /api/v1/webhook/public-keys` da Woovi, cacheada em memória por 1 hora; em falha de verificação, buscar de novo uma vez antes de rejeitar.
- Gatilho: `OPENPIX:CHARGE_COMPLETED`. `operationKey = "charge:" + charge.correlationID`.
- Tomador = `charge.customer`; `pix.payer` nunca é usado como tomador.
- Sem ambiente no evento: vale o ambiente da conexão.
- Valor em centavos: confirmar na Task 1 (a documentação não explicita a unidade de `charge.value`).
- Mesmas regras de estilo e comandos do plano de infraestrutura.

## Review Focus

1. Pix recebido sem cobrança (`pix` sem `charge`): `kind: 'ignored'`, nunca vira venda. Teste na Task 2.
2. Evento de teste do cadastro do webhook: `kind: 'test'`, nada gravado. Teste na Task 2.
3. `charge.customer` ausente ou sem `taxID`: `customer.taxId = null` e o motor pede o dado; nunca cair para `pix.payer`. Teste na Task 3.
4. Chave pública rotacionada: uma assinatura válida com chave nova passa após uma nova busca. Teste na Task 2.
5. Valor em reais convertido para centavos sem erro de ponto flutuante (`49.9` → `4990`). Teste na Task 3.

---

### Task 1: Confirmar o formato real com a conta sandbox

**Files:**
- Create: `api/src/modules/integrations/connectors/woovi/__fixtures__/charge-completed.json`, `webhook-test.json`, `pix-without-charge.json`, `public-keys.json`
- Create: `api/src/modules/integrations/connectors/woovi/README.md` (o que foi confirmado, com a data)

**Interfaces:**
- Produces: fixtures sanitizadas (CPF/e-mail trocados por dados falsos, assinatura real preservada junto de uma chave pública real) usadas pelas tarefas seguintes, e as respostas às perguntas abaixo registradas no README.

- [ ] **Step 1: Criar a conta sandbox, configurar um webhook apontando para um receptor temporário (por exemplo, um endpoint de teste do `webhook.site`) e gerar uma cobrança Pix paga.**
- [ ] **Step 2: Salvar o corpo bruto, os cabeçalhos e a chave pública.** Responder no README: a unidade de `charge.value` e de `pix.value`; o nome exato do evento no corpo (campo `event`); como o evento de teste do cadastro se parece; qual chamada autenticada por `Authorization: <appId>` devolve o identificador da conta (comparar com `company.id` do evento); se `charge.customer.taxID` vem com ou sem máscara.
- [ ] **Step 3: Conferir a verificação da assinatura num script descartável** com a chave de `public-keys.json` e o corpo salvo. Expected: assinatura válida. Se não for, registrar no README o que muda (formato da chave, codificação) antes de seguir.
- [ ] **Step 4: Commit**

```bash
git add api/src/modules/integrations/connectors/woovi
git commit -m "docs(integrations): payloads reais da Woovi para fixtures"
```

---

### Task 2: Autenticação e parse

**Files:**
- Create: `connectors/woovi/woovi-public-key.provider.ts`, `connectors/woovi/woovi.connector.ts` (parte `authenticate` e `parse`), `connectors/woovi/woovi.manifest.ts`
- Test: `woovi.connector.auth.spec.ts`

**Interfaces:**
- Consumes: `Connector`, `InboundRequest`, `ConnectionView`, `ParsedDelivery`, `DeliveryAuth` (infraestrutura Task 1).
- Produces:
  - `WooviPublicKeyProvider { get(forceRefresh?: boolean): Promise<string> }` — busca e cacheia por 1 hora.
  - `WooviConnector implements Connector` com `manifest.id = 'woovi'`, `credentialFields = [{ key: 'appId', label: 'AppID', secret: true }]`, instruções do webhook em pt e en (URL, evento `OPENPIX:CHARGE_COMPLETED`).
  - `authenticate(req, connection)`: `{ ok: false, reason: 'missing_signature' }` sem cabeçalho; `{ ok: false, reason: 'bad_signature' }` quando a verificação falha mesmo após atualizar a chave.
  - `parse(req)`: `test` para o evento de teste do cadastro; `ignored` para eventos que não são `OPENPIX:CHARGE_COMPLETED`; `operation` com `deliveryId` conforme as fixtures (campo estável entre reenvios, definido no README da Task 1), `externalAccountId = company.id`.

- [ ] **Step 1: Write the failing tests**

```ts
it('accepts the real fixture signature with the real public key', ...);
it('rejects a body altered by one byte', ...);
it('rejects a missing x-webhook-signature header', ...);
it('refreshes the public key once and accepts a signature made with the new key', ...);
it('does not refresh more than once per request when the signature is invalid', ...);
it('parse: webhook-test.json -> kind test', ...);
it('parse: pix-without-charge.json -> kind ignored', ...);
it('parse: charge-completed.json -> operation with the deliveryId and externalAccountId from the fixture', ...);
it('parse: a different event name -> ignored', ...);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest src/modules/integrations/connectors/woovi`
Expected: FAIL.

- [ ] **Step 3: Implement.** `crypto.createVerify('sha256')` com a chave pública em PEM (montar o PEM a partir da chave base64 conforme o README). Tratar JSON inválido em `parse` lançando erro (a infraestrutura já grava `needs_attention`).

- [ ] **Step 4: Run tests to verify they pass** — mesmo comando. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/integrations/connectors/woovi
git commit -m "feat(integrations): Woovi — assinatura RSA e leitura do evento"
```

---

### Task 3: Normalização e validação da conexão

**Files:**
- Modify: `connectors/woovi/woovi.connector.ts` (`normalize`, `validateConnection`)
- Create: `connectors/woovi/woovi.client.ts`
- Test: `woovi.connector.normalize.spec.ts`

**Interfaces:**
- Produces:
  - `WooviClient { accountId(appId: string): Promise<string> }` — chamada autenticada identificada no README da Task 1; erro 401/403 → `ConnectorAuthError`; 429/5xx/rede → `ConnectorTransientError`.
  - `normalize({ payload, ... })` devolve `NormalizedOperation` com: `operationKey = 'charge:' + charge.correlationID`; `commercialState = 'paid'`; `externalRefs = { chargeCorrelationId, chargeTransactionId, pixTransactionId }`; `paidAt` = `pix.time`; `amountCents` conforme a unidade confirmada; `currency = 'BRL'`; `discountCents = 0`; `customer` de `charge.customer` (`taxId` só dígitos, `taxIdMasked` quando houver `*`); `items = []`; `sellerIssuesInvoice = true`.
  - `validateConnection({ appId })` → `{ externalAccountId }` igual ao `company.id` dos eventos.

- [ ] **Step 1: Write the failing tests**

```ts
it('normalizes charge-completed.json to the expected NormalizedOperation', ...); // objeto completo comparado
it('uses charge.customer, never pix.payer, as the customer', ...);
it('customer.taxId is null and taxIdMasked false when charge.customer has no taxID', ...);
it('taxIdMasked is true when taxID contains asterisks', ...);
it('converts 49.9 reais to 4990 cents without float error', ...); // só se a unidade confirmada for reais; senão, teste de passagem direta em centavos
it('validateConnection returns the account id from the client', ...);
it('client 401 -> ConnectorAuthError', ...);
it('client 503 and network error -> ConnectorTransientError', ...);
```

- [ ] **Step 2: Run tests to verify they fail** — `cd api && npx jest src/modules/integrations/connectors/woovi` → FAIL.
- [ ] **Step 3: Implement** `WooviClient` com `fetch` e timeout de 10 s (`AbortSignal.timeout(10000)`); `normalize` não faz chamada de rede (o payload já é completo).
- [ ] **Step 4: Run** o mesmo comando → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/src/modules/integrations/connectors/woovi
git commit -m "feat(integrations): Woovi — normalização da cobrança e validação da conta"
```

---

### Task 4: Módulo, registro e fluxo completo

**Files:**
- Create: `connectors/woovi/woovi.module.ts` (provê o conector e registra no `ConnectorRegistry` em `OnModuleInit`)
- Modify: `api/src/app.module.ts` (importar `WooviConnectorModule`)
- Test: `woovi.flow.spec.ts` (reutiliza o módulo de aceite da infraestrutura com o conector real e fixtures)

**Interfaces:**
- Consumes: `IntegrationsModule` da infraestrutura.

- [ ] **Step 1: Write the failing test**

```ts
it('GET /integrations/providers lists woovi with the appId field marked secret and without values', ...);
it('a signed charge-completed delivery creates one invoice through the rule of the connection', ...);
it('the same delivery sent twice creates one invoice', ...);
it('a webhook-test delivery answers 200 and stores nothing', ...);
it('a delivery with a bad signature answers 401', ...);
```

- [ ] **Step 2: Run test to verify it fails** — `cd api && npx jest src/modules/integrations/connectors/woovi/woovi.flow.spec.ts` → FAIL.
- [ ] **Step 3: Implement** o módulo e o registro. Em produção a chave pública e o cliente usam `fetch` real; no teste, injetar dublês com as fixtures.
- [ ] **Step 4: Run the suite** — `cd api && npx jest && npx tsc --noEmit -p tsconfig.json` → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/src
git commit -m "feat(integrations): conector Woovi registrado e testado de ponta a ponta"
```

---

### Task 5: Documentação e homologação

**Files:**
- Modify: `web/lib/docs/content/pt.ts`, `en.ts` — guia "Conectar a Woovi": criar a conexão, colar a URL do webhook no painel da Woovi, evento a marcar, configurar a regra, testar com cobrança de R$ 1,00 em `test`, ativar em `live`.
- Test: `web/tests/docs-integrations.test.ts` (estende o da infraestrutura: o guia da Woovi existe em pt e en).

- [ ] **Step 1: Estender o teste** para exigir `OPENPIX:CHARGE_COMPLETED` e `/integrations/inbound` no guia, em pt e en. Rodar `cd web && npx vitest run tests/docs-integrations.test.ts` → FAIL.
- [ ] **Step 2: Escrever o guia** nas duas línguas.
- [ ] **Step 3: Rodar** `cd web && npx vitest run` → PASS.
- [ ] **Step 4: Homologação manual (registrar o resultado na descrição do PR):** conexão `test`, cobrança paga → nota em `test`; mesma cobrança reenviada → sem segunda nota; pagador sem CPF → pendência → `PATCH` do tomador + `retry` → nota emitida.
- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "docs(integrations): guia de conexão da Woovi"
```

---

## Self-review

- **Cobertura da spec (seção 10, Woovi):** assinatura RSA (Task 2), gatilho e `operationKey` (Tasks 2 e 3), tomador (Task 3), teste do cadastro (Task 2), validação da conta (Task 3), docs (Task 5). A incerteza sobre unidade de valor e identidade da conta está explícita na Task 1 e nas tarefas que dependem dela.
- **Reembolso da Woovi:** esta entrega não trata eventos de reembolso (a documentação consultada não os descreve); eles caem em `ignored`. Registrar na descrição do PR.
