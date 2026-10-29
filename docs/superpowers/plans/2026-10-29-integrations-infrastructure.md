# Integrações — infraestrutura Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receber eventos de plataformas de pagamento por um endpoint único, transformá-los em operações e emitir a NFS-e pelo fluxo existente, provado com dois conectores sintéticos de teste.

**Architecture:** Módulo `integrations` com registro de conectores, inbox e operações no Postgres (RLS), worker que reivindica eventos com lease, regras que congelam o pedido de emissão e uma porta (`InvoiceIssuancePort`) implementada no módulo de invoice. Nenhum código específico de plataforma no núcleo.

**Tech Stack:** NestJS, TypeORM + migrations, Postgres (RLS, `FOR UPDATE SKIP LOCKED`), `@nestjs/schedule`, Jest, `SecretsCipherService` existente.

**Spec:** `docs/superpowers/specs/2026-10-29-payment-integrations-design.md` (seções 4 a 9 e 11). Referência de princípios: `docs/integrations/architecture.md`.

## Global Constraints

- Prefixo de rotas: `/v1`. Rota de entrada: `POST /v1/integrations/inbound/:publicId`.
- `provider` é texto validado contra o registro; nunca enum de banco.
- Valores em centavos inteiros; `amount` do `CreateInvoiceDto` = `Number((amountCents / 100).toFixed(2))`.
- Competência = `paidAt` em `America/Sao_Paulo`, formato `YYYY-MM-DD`.
- Chave de idempotência: `integ_` + SHA-256 hex de `tenantId|environment|provider|externalAccountId|operationKey`.
- Estados do evento: `received`, `processing`, `retry_pending`, `processed`, `ignored`, `needs_attention`, `dead`. Máximo de 8 tentativas, depois `dead`.
- Estado comercial só avança: `pending` < `paid` < `disputed` < `refunded`; `canceled` é final.
- Credenciais e corpos de evento cifrados em repouso com `SecretsCipherService`. Nunca logar `webhookSecret`, cabeçalhos de autorização ou credenciais.
- Corpo de entrada: máximo 256 KB. Comparação de segredos em tempo constante (`crypto.timingSafeEqual`).
- Migrations: `1792540000000-CreateIntegrations.ts` em diante, no padrão de `1792510000000-CreateCompanySimplesRates.ts` (método privado `schema(runner)`, RLS `FORCE`, política `tenant_isolation_policy`).
- Código de produção em inglês, mensagens ao usuário em português, comentários só quando o porquê não é óbvio (padrão do repositório).
- Rodar a cada tarefa: `cd api && npx jest <caminho>`; antes de cada commit: `npx eslint <arquivos> && npx prettier --check <arquivos>`.

## Review Focus

1. Corpo autenticado mas ilegível (JSON inválido): grava `needs_attention` e responde 200, sem derrubar a requisição. Teste na Task 4.
2. Pagamento com valor que não é número exato de centavos ou com `amountCents <= 0`: bloqueia com `invalid_amount`, nunca emite. Teste na Task 6.
3. Reembolso chegando antes do aviso de pagamento: aviso tardio não emite. Teste na Task 6.
4. Conexão pausada ou desconectada enquanto o evento está na fila: nenhuma emissão. Teste na Task 8.
5. Mesma cobrança com `deliveryId` novo e mesmo `operationKey`: uma emissão só. Teste na Task 10.

## File Structure

```text
api/src/modules/integrations/
  integrations.module.ts
  domain/
    connector.ts                  # contratos, tipos, erros do conector
    connector-registry.ts         # registro e catálogo
    integration-connection.ts     # entidade + máquina de estados
    integration-event.ts          # tipos de evento e backoff
    integration-operation.ts      # NormalizedOperation -> estado, merge monotônico
    integration-rule.ts           # regra e seleção
    emission-planner.ts           # elegibilidade + pedido congelado + chave
    invoice-issuance.port.ts      # InvoiceIssuancePort
    *.repository.ts               # portas dos repositórios
  application/
    connection.service.ts
    credentials.service.ts
    inbound-receiver.service.ts
    event-processor.service.ts
    operation.service.ts
  http/
    inbound.controller.ts
    inbound-rate-limit.guard.ts
    integrations.controller.ts
    integrations.dto.ts
  infra/
    *.orm-entity.ts
    typeorm-*.repository.ts
  jobs/
    event-processor.scheduler.ts
  testing/                        # só usado por testes
    synthetic-connectors.ts
api/src/modules/invoice/application/integration-invoice-issuer.ts
api/src/infra/database/migrations/1792540000000-CreateIntegrations.ts
```

---

### Task 1: Contratos e registro de conectores

**Files:**
- Create: `api/src/modules/integrations/domain/connector.ts`
- Create: `api/src/modules/integrations/domain/connector-registry.ts`
- Test: `api/src/modules/integrations/domain/connector-registry.spec.ts`

**Interfaces:**
- Produces: tudo o que a spec seção 4 define (`IntegrationEnvironment`, `InboundRequest`, `ConnectionView`, `ParsedDelivery`, `DeliveryAuth`, `NormalizedOperation`, `Connector`, `ConnectorManifest`), mais:
  - `class ConnectorTransientError extends Error`, `class ConnectorAuthError extends Error`, `class ConnectorDataError extends Error` (todos com `constructor(message: string)`).
  - `class ConnectorRegistry { register(connector: Connector): void; get(id: string): Connector; has(id: string): boolean; manifests(): ConnectorManifest[] }`.

- [ ] **Step 1: Write the failing test** `connector-registry.spec.ts`

```ts
it('registers a connector and returns it by id', () => {
  const registry = new ConnectorRegistry();
  const connector = fakeConnector('woovi');
  registry.register(connector);
  expect(registry.get('woovi')).toBe(connector);
  expect(registry.has('woovi')).toBe(true);
});
it('refuses a duplicate id', () => {
  const registry = new ConnectorRegistry();
  registry.register(fakeConnector('woovi'));
  expect(() => registry.register(fakeConnector('woovi'))).toThrow('already registered');
});
it('refuses an id that is not lowercase letters, digits or hyphen', () => {
  expect(() => new ConnectorRegistry().register(fakeConnector('Woovi!'))).toThrow('Invalid connector id');
});
it('throws a not-found error for an unknown id', () => {
  expect(() => new ConnectorRegistry().get('nope')).toThrow('Unknown connector: nope');
});
it('manifests() exposes no credential values', () => {
  const registry = new ConnectorRegistry();
  registry.register(fakeConnector('woovi'));
  expect(JSON.stringify(registry.manifests())).not.toContain('secret-value');
});
```

`fakeConnector(id)` é um helper local ao spec que devolve um `Connector` com manifesto mínimo.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/modules/integrations/domain/connector-registry.spec.ts`
Expected: FAIL, `Cannot find module './connector-registry'`.

- [ ] **Step 3: Implement** os tipos em `connector.ts` exatamente como na spec seção 4 e `ConnectorRegistry` em `connector-registry.ts`. `register` valida `/^[a-z0-9-]+$/` e duplicidade. Usar `Map<string, Connector>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/modules/integrations/domain/connector-registry.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/integrations/domain
git commit -m "feat(integrations): contratos de conector e registro"
```

---

### Task 2: Migration e entidades com RLS

**Files:**
- Create: `api/src/infra/database/migrations/1792540000000-CreateIntegrations.ts`
- Create: `api/src/modules/integrations/infra/integration-connection.orm-entity.ts`, `integration-event.orm-entity.ts`, `integration-operation.orm-entity.ts`, `integration-rule.orm-entity.ts`
- Test: `api/src/modules/integrations/infra/integrations.postgres.integration.spec.ts` (mesmo estilo e helpers de `api/src/modules/billing/infra/billing.postgres.integration.spec.ts`)
- Modify: `api/src/infra/database/tenant-rls.postgres.integration.spec.ts` — incluir as 4 tabelas no inventário de tabelas com RLS.

**Interfaces:**
- Produces: tabelas e colunas exatamente como na spec seção 5; as entidades ORM expõem as colunas em `camelCase` (`tenantId`, `connectionId`, `claimToken`, `lockedUntil`, `nextAttemptAt`, …).

- [ ] **Step 1: Write the failing test** `integrations.postgres.integration.spec.ts`, usando o setup de banco do spec de billing:

```ts
it('creates the four tables with row level security forced', async () => { /* consulta pg_class.relforcerowsecurity para cada tabela */ });
it('rejects a second delivery with the same (tenant, environment, provider, account, delivery_id)', async () => { /* 23505 */ });
it('rejects a second operation with the same operation_key for the same account', async () => { /* 23505 */ });
it('allows the same account to be reconnected after the first connection is disconnected', async () => { /* índice parcial */ });
it('rejects two active connections for the same (provider, environment, account)', async () => { /* 23505, mesmo entre tenants */ });
it('hides another tenant\'s rows', async () => { /* runWithTenant(A) não vê linhas de B */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/modules/integrations/infra/integrations.postgres.integration.spec.ts`
Expected: FAIL (tabelas inexistentes). Se o ambiente local não tiver Postgres de teste, o spec deve ser pulado do mesmo jeito que os outros `*.postgres.integration.spec.ts`; nesse caso rodar com o banco de `deploy/docker-compose.local.yml`.

- [ ] **Step 3: Implement** a migration `CreateIntegrations1792540000000` criando as 4 tabelas da spec seção 5 com FKs (`tenants`, `nfse_companies`), CHECKs de estado e RLS (`ENABLE` + `FORCE` + `tenant_isolation_policy` com `owner OR system`, padrão de `CreateCompanySimplesRates`). `down` remove as tabelas na ordem inversa. As entidades ORM seguem o estilo de `webhook-config.orm-entity.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/modules/integrations/infra src/infra/database/tenant-rls.postgres.integration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/infra/database api/src/modules/integrations/infra
git commit -m "feat(integrations): tabelas de conexões, eventos, operações e regras com RLS"
```

---

### Task 3: Credenciais e conexões

**Files:**
- Create: `api/src/modules/integrations/domain/integration-connection.ts`, `integration-connection.repository.ts`
- Create: `api/src/modules/integrations/application/credentials.service.ts`, `connection.service.ts`
- Create: `api/src/modules/integrations/infra/typeorm-integration-connection.repository.ts`
- Test: `credentials.service.spec.ts`, `connection.service.spec.ts`, `integration-connection.spec.ts`

**Interfaces:**
- Consumes: `ConnectorRegistry` (Task 1), `SecretsCipherService` (`encrypt(plaintext: string): string`, `decrypt(ciphertext: string): string`), entidades da Task 2.
- Produces:
  - `type ConnectionState = 'draft' | 'active' | 'paused' | 'reauth_required' | 'disconnected'`.
  - `IntegrationConnection` com `transition(to: ConnectionState): void` (lança `InvalidConnectionTransitionError`): `draft→active`, `active→paused`, `paused→active`, `active|paused→reauth_required`, `reauth_required→active`, qualquer exceto `disconnected`→`disconnected`. `disconnected` é final.
  - `CredentialsService { seal(credentials: Record<string,string>): string; open(sealed: string): Record<string,string> }`.
  - `ConnectionService`:
    - `create(tenantId: string, input: { provider: string; companyId: string; environment: IntegrationEnvironment; credentials: Record<string,string>; activeFrom?: Date }): Promise<IntegrationConnection>` — gera `publicId` com 18 bytes aleatórios em base64url (24 caracteres); rejeita `provider` desconhecido e credencial que falte campo do manifesto.
    - `validate(tenantId: string, id: string): Promise<IntegrationConnection>` — chama `connector.validateConnection`, grava `externalAccountId`.
    - `activate(tenantId, id)`, `pause(tenantId, id)`, `disconnect(tenantId, id)`.
    - `toView(connection: IntegrationConnection): ConnectionView` (decifra em memória).
    - `findByPublicId(publicId: string): Promise<IntegrationConnection | null>` — usa `runAsSystem('integration-inbound', ...)`.
  - Adicionar `'integration-inbound'` a `SystemPurpose` em `api/src/infra/persistence/typeorm/tenant-context.storage.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// integration-connection.spec.ts
it.each([['draft','active'],['active','paused'],['paused','active'],['active','reauth_required'],['reauth_required','active'],['paused','disconnected']])(
  'allows %s -> %s', ...);
it.each([['draft','paused'],['disconnected','active'],['draft','reauth_required']])('refuses %s -> %s', ...);
// credentials.service.spec.ts
it('sealed credentials do not contain the plaintext and open() returns the same object', ...);
// connection.service.spec.ts
it('create() generates a 24-char base64url publicId and never returns credentials', ...);
it('create() rejects an unknown provider', ...);
it('create() rejects credentials missing a field declared in the manifest', ...);
it('activate() fails while externalAccountId is null', ...);
it('activate() fails when the company has no certificate-ready state', ...); // usa CompanyService existente; ver nota no Step 3
it('findByPublicId() runs as system and returns null for an unknown id', ...);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest src/modules/integrations`
Expected: FAIL com módulos inexistentes.

- [ ] **Step 3: Implement** conforme as assinaturas. `activate` também exige ao menos uma regra (consulta o repositório de regras da Task 6 por meio de uma porta `RuleCounter { countByConnection(id: string): Promise<number> }` injetada; nesta tarefa o teste usa um dublê). Para "empresa pronta", reutilizar a verificação que `InvoiceService.prepareEmission` já faz (empresa ativa no tenant) via `CompanyService.findByIdAndTenant` — olhar `invoice.service.company-resolution.spec.ts` para o nome exato do método.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/modules/integrations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/integrations api/src/infra/persistence/typeorm/tenant-context.storage.ts
git commit -m "feat(integrations): conexões, credenciais cifradas e máquina de estados"
```

---

### Task 4: Entrada HTTP e gravação do evento

**Files:**
- Create: `api/src/modules/integrations/application/inbound-receiver.service.ts`
- Create: `api/src/modules/integrations/http/inbound.controller.ts`, `inbound-rate-limit.guard.ts`
- Create: `api/src/modules/integrations/domain/integration-event.repository.ts`, `infra/typeorm-integration-event.repository.ts`
- Test: `inbound-receiver.service.spec.ts`, `inbound.controller.spec.ts`

**Interfaces:**
- Consumes: `ConnectionService.findByPublicId`, `ConnectionService.toView`, `ConnectorRegistry`, `CredentialsService`, `SecretsCipherService`, `runWithTenant`.
- Produces:
  - `InboundReceiverService.receive(publicId: string, req: InboundRequest): Promise<{ status: 'accepted' | 'duplicate' | 'ignored' | 'test' }>`; lança `NotFoundException` (conexão inexistente, `draft` ou `disconnected`) e `UnauthorizedException` (autenticação do conector falhou).
  - `IntegrationEventRepository { insertReceived(input: { tenantId; connectionId; provider; environment; externalAccountId; deliveryId; externalType; payloadEnc: string; state: 'received' | 'needs_attention'; lastError?: string }): Promise<{ id: string; created: boolean }> }` — `ON CONFLICT DO NOTHING` na chave única e `created = false` quando já existia.
  - Controller: `@Controller('integrations/inbound') @PublicRoute() @RawResponse() @UseGuards(InboundRateLimitGuard)`, `@Post(':publicId') @HttpCode(200)`, responde `{ received: true }`. Limite de corpo `256 * 1024` (413 acima). Variável `RATE_LIMIT_INTEGRATION_INBOUND` (padrão 600/min por IP), no padrão de `stripe-webhook-rate-limit.guard.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it('returns 401 and stores nothing when connector.authenticate says not ok', ...);
it('returns 404 for an unknown publicId, and the body equals the 404 of a disconnected connection', ...);
it('returns accepted and stores a received event for an operation delivery', ...);
it('returns duplicate and stores one row when the same deliveryId arrives twice (including Promise.all of two)', ...);
it('returns test and stores nothing for kind test', ...);
it('returns ignored and stores nothing for kind ignored', ...);
it('stores a paused connection\'s event as received', ...);
it('stores an authenticated event whose parse() throws as needs_attention and still answers 200', ...);
it('drops an event whose environment differs from the connection (answers 200, stores nothing)', ...);
it('drops an event whose externalAccountId differs from the connection', ...);
it('answers 500 and does not claim success when persistence fails', ...);
it('controller returns 413 for a body above 256 KB before calling the connector', ...);
it('payloadEnc does not contain the raw body text', ...);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest src/modules/integrations/application/inbound-receiver.service.spec.ts src/modules/integrations/http/inbound.controller.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Ordem em `receive`: achar conexão (sistema) → 404 se `draft`/`disconnected`/ausente → `authenticate` (401) → `parse` dentro de try/catch (falha vira evento `needs_attention` com `deliveryId = sha256(rawBody)` e `externalType = 'unparseable'`) → `test`/`ignored` retornam sem gravar → conferir ambiente e conta (se vierem no `ParsedDelivery`) e descartar divergentes com log sem PII → `runWithTenant(connection.tenantId, ...)` para `insertReceived` com `payloadEnc = cipher.encrypt(rawBody.toString('utf8'))`. O controller monta `InboundRequest` a partir de `req.rawBody`, `req.headers` (minúsculas) e `req.query`, como `StripeWebhookController` faz.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/modules/integrations/application/inbound-receiver.service.spec.ts src/modules/integrations/http/inbound.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/integrations
git commit -m "feat(integrations): endpoint de entrada genérico e inbox de eventos"
```

---

### Task 5: Worker — reivindicar eventos com lease

**Files:**
- Create: `api/src/modules/integrations/domain/integration-event.ts` (backoff + tipos), `application/event-processor.service.ts`, `jobs/event-processor.scheduler.ts`
- Modify: `typeorm-integration-event.repository.ts` (métodos de claim)
- Modify: o módulo do processo worker para registrar o scheduler (localizar com `grep -n "main.worker" api/src` e abrir o módulo raiz do worker).
- Test: `integration-event.spec.ts`, `event-processor.service.spec.ts`, `typeorm-integration-event.repository.postgres.integration.spec.ts`

**Interfaces:**
- Produces:
  - `nextAttemptDelayMs(attempt: number, random: () => number): number` — `min(2^attempt * 5000, 3600000)` com jitter de ±20%; `attempt` começa em 1.
  - `IntegrationEventRepository.claimBatch(limit: number, leaseMs: number, now: Date): Promise<ClaimedEvent[]>` onde `ClaimedEvent = { id; tenantId; connectionId; provider; payloadEnc; attempts; claimToken }`. Usa uma única query com `FOR UPDATE SKIP LOCKED`, `attempts = attempts + 1`, novo `claim_token`, `locked_until = now + leaseMs`.
  - `markResult(id: string, claimToken: string, result: { state: 'processed'|'ignored'|'needs_attention'|'retry_pending'|'dead'; operationId?: string; lastError?: string; nextAttemptAt?: Date }): Promise<boolean>` — `UPDATE ... WHERE id = :id AND claim_token = :token`; devolve `false` quando o token não bate.
  - `EventProcessorService.runOnce(now?: Date): Promise<number>` — reivindica até 20 e processa cada um (Task 8 completa o processamento; aqui chama um `EventHandler { handle(event: ClaimedEvent): Promise<EventOutcome> }` injetado).
  - `EventProcessorScheduler` com `@Interval(5000)`, capturando e registrando erro.

- [ ] **Step 1: Write the failing tests**

```ts
// integration-event.spec.ts
it('backoff doubles per attempt, caps at one hour and stays within ±20% jitter', ...);
// postgres integration
it('two concurrent claimBatch calls never return the same event', ...);
it('an event with an expired lease is claimed again with a new claimToken', ...);
it('markResult with a stale claimToken returns false and leaves the row untouched', ...);
it('events not yet due (next_attempt_at in the future) are not claimed', ...);
// event-processor.service.spec.ts
it('moves an event to retry_pending with the computed delay when the handler throws ConnectorTransientError', ...);
it('moves an event to dead on the 8th failed attempt', ...);
it('does not overwrite the result when markResult reports a lost claim', ...);
it('keeps processing the remaining events when one handler call throws', ...);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest src/modules/integrations -t "claim|backoff|retry_pending|dead"`
Expected: FAIL.

- [ ] **Step 3: Implement** o repositório com SQL cru via `manager.query` (CTE `WITH due AS (SELECT id FROM ... FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE ... FROM due RETURNING ...`) executado em `runAsSystem('worker-discovery', ...)` porque o worker procura eventos de todos os tenants; o processamento de cada evento depois roda em `runWithTenant(event.tenantId, ...)`. Registrar o scheduler só no processo worker (`CORVO_RUNTIME_ROLE=worker`), nunca no da API.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/modules/integrations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src
git commit -m "feat(integrations): worker que reivindica eventos com lease e backoff"
```

---

### Task 6: Operações, regras e planejamento da emissão

**Files:**
- Create: `domain/integration-operation.ts`, `domain/integration-rule.ts`, `domain/emission-planner.ts` e as portas `integration-operation.repository.ts`, `integration-rule.repository.ts`
- Create: `infra/typeorm-integration-operation.repository.ts`, `infra/typeorm-integration-rule.repository.ts`
- Create: `application/operation.service.ts`
- Test: `emission-planner.spec.ts`, `integration-operation.spec.ts`, `operation.service.spec.ts`

**Interfaces:**
- Consumes: `NormalizedOperation`, `CreateInvoiceDto` (`api/src/modules/invoice/http/invoice.dto.ts`).
- Produces:
  - `mergeCommercialState(current: CommercialState, incoming: CommercialState): CommercialState` — aplica a ordem monotônica da spec; `canceled` é final.
  - `idempotencyKeyFor(input: { tenantId; environment; provider; externalAccountId; operationKey }): string`.
  - `selectRule(rules: IntegrationRule[], items: NormalizedOperation['items']): { rule: IntegrationRule } | { error: 'no_rule' | 'ambiguous_rule' }` — produto único conhecido e com regra → essa; senão a regra padrão (`externalProductId = null`); itens com produtos diferentes e regras diferentes → `ambiguous_rule`.
  - `planEmission(input: { connection: { id; companyId; state; activeFrom: Date | null; environment; externalAccountId }; operation: { snapshot: NormalizedOperation; commercialState: CommercialState }; rules: IntegrationRule[]; tenantId: string; provider: string }): EmissionPlan` onde `EmissionPlan = { kind: 'issue'; ruleId: string; request: CreateInvoiceDto; requestHash: string; idempotencyKey: string } | { kind: 'blocked'; reason: BlockReason } | { kind: 'needs_attention'; reason: BlockReason }` e `BlockReason` é a união dos motivos da spec seção 6 (`connection_inactive`, `before_active_from`, `refunded`, `disputed`, `not_paid`, `unsupported_currency`, `invalid_amount`, `seller_not_issuer`, `no_rule`, `ambiguous_rule`, `customer_tax_id_missing`, `refund_after_invoice`, `quota_exceeded`, `invoice_rejected`).
  - `OperationService.apply(tenantId: string, connectionId: string, normalized: NormalizedOperation, eventId: string): Promise<IntegrationOperation>` — upsert pela chave única, aplica `mergeCommercialState`, atualiza `snapshot` apenas quando o estado avança ou o `occurredAt` é mais novo.

- [ ] **Step 1: Write the failing tests** (`emission-planner.spec.ts` é o centro)

```ts
it('plans an issue with amount 49.9, competenceDate 2026-10-29 for paidAt 2026-10-30T01:30:00Z (São Paulo)', ...);
it('builds the customer from the snapshot and the service from the rule', ...);
it('puts discount in the request only when discountCents > 0', ...);
it('truncates externalId to 100 characters', ...);
it('blocks with refunded / disputed / not_paid by commercial state', ...);
it('blocks with before_active_from when paidAt is earlier than activeFrom', ...);
it('blocks with connection_inactive for paused and reauth_required', ...);
it.each([0, -5])('blocks invalid_amount for amountCents %s', ...);
it('blocks unsupported_currency for USD', ...);
it('blocks seller_not_issuer', ...);
it('needs_attention customer_tax_id_missing when taxId is null', ...);
it('needs_attention customer_tax_id_missing when taxIdMasked is true', ...);
it('needs_attention when taxId has 12 digits', ...);
it('issues without customer when the rule allows anonymous and the tax id is missing', ...);
it('no_rule / ambiguous_rule from selectRule', ...);
it('idempotencyKeyFor ignores connection id and rule and is stable', ...);
it('requestHash changes when the amount changes and is equal for equal requests', ...);
// integration-operation.spec.ts
it('a late paid never overrides refunded', ...);
it('disputed then refunded advances; refunded then disputed does not', ...);
// operation.service.spec.ts
it('apply() twice with the same key keeps one row', ...);
it('apply() with an older occurredAt does not replace the snapshot', ...);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest src/modules/integrations/domain`
Expected: FAIL.

- [ ] **Step 3: Implement** funções puras em `domain/` (sem acesso a banco). `planEmission` segue a ordem de elegibilidade da spec seção 6 e devolve na primeira falha. Competência: converter com `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })`. `requestHash`: SHA-256 do JSON canônico do pedido (chaves ordenadas) — reutilizar a função de hash canônico do invoice se estiver exportada (`hashPayload` em `invoice.service.ts` não é exportada; criar um utilitário pequeno em `integrations/domain` em vez de exportá-la).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/modules/integrations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/integrations
git commit -m "feat(integrations): operações, regras e planejamento do pedido de emissão"
```

---

### Task 7: Ponte de emissão no módulo de invoice

**Files:**
- Create: `api/src/modules/integrations/domain/invoice-issuance.port.ts`
- Create: `api/src/modules/invoice/application/integration-invoice-issuer.ts`
- Modify: `api/src/modules/invoice/application/invoice.service.ts` (extrair o corpo de `emit` e `prepareEmission` para aceitar um ambiente explícito)
- Modify: `api/src/modules/invoice/invoice.module.ts` (provider e export)
- Test: `integration-invoice-issuer.spec.ts`, e os specs existentes do invoice devem continuar passando.

**Interfaces:**
- Produces:
  - `InvoiceIssuancePort { issue(input: { tenantId: string; environment: IntegrationEnvironment; request: CreateInvoiceDto; idempotencyKey: string }): Promise<{ invoiceId: string; replay: boolean }> }` e o token `INVOICE_ISSUANCE_PORT = Symbol('InvoiceIssuancePort')`.
  - `InvoiceService.emitInEnvironment(dto: CreateInvoiceDto, tenantId: string, environment: ExecutionEnvironment, idempotencyKeyHeader?: string): Promise<Invoice>` — corpo atual de `emit`; `emit(dto, tenantId, authContext, key)` passa a chamar `emitInEnvironment(dto, tenantId, executionEnvironment(authContext), key)`. `prepareEmission` ganha o mesmo tratamento (`prepareEmissionInEnvironment`), `prepareEmission` o chama. Nenhum comportamento HTTP muda.

- [ ] **Step 1: Write the failing tests**

```ts
it('issue() creates the invoice through emitInEnvironment with the idempotency key', ...);
it('issue() called again with the same key and request returns the same invoiceId and replay=true', ...);
it('issue() with the same key and a different request throws IdempotencyConflictError', ...);
it('does not need an AuthContext: no user, session or api key is created', ...);
it('does not reserve usage twice on replay', ...); // usa o fake de QuotaService/lifecycle do invoice.service.spec.ts
// invoice.service.spec.ts existente:
it('emit() still derives the environment from the AuthContext', ...); // já coberto; só rodar
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest src/modules/invoice/application/integration-invoice-issuer.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Antes de mexer, rodar `npx jest src/modules/invoice` e anotar que passa. A refatoração é mecânica: renomear o parâmetro `authContext` para `environment` onde só `executionEnvironment(authContext)` era usado; conferir com `grep -n "authContext" api/src/modules/invoice/application/invoice.service.ts` se algum outro campo é lido (a análise de 2026-10-29 indicou que não). `replay` é `prepared.kind === 'replay'`: para saber isso sem duplicar lógica, `emitInEnvironment` continua devolvendo `Invoice`, e o issuer consulta `InvoiceRepository.findByIdempotencyKey(key, tenantId, environment)` antes de emitir para preencher `replay`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/modules/invoice src/modules/integrations`
Expected: PASS, incluindo toda a suíte antiga do invoice.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules
git commit -m "feat(invoice): porta de emissão para integrações, sem autenticação HTTP"
```

---

### Task 8: Processamento do evento de ponta a ponta

**Files:**
- Create: `api/src/modules/integrations/application/event-handler.service.ts` (implementa `EventHandler` da Task 5)
- Modify: `operation.service.ts` (métodos `plan`, `submit`)
- Test: `event-handler.service.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 5, 6, 7.
- Produces: `EventHandlerService.handle(event: ClaimedEvent): Promise<EventOutcome>` onde `EventOutcome = { state: 'processed' | 'ignored' | 'needs_attention'; operationId?: string; lastError?: string }`. Erros `ConnectorTransientError` propagam para o `EventProcessorService` (retry); `ConnectorAuthError` coloca a conexão em `reauth_required` e devolve `needs_attention`; `ConnectorDataError` devolve `needs_attention`.
- Fluxo: abrir `payloadEnc` → `connector.normalize` → `OperationService.apply` → reler conexão (estado atual, não o do início) → `planEmission` → se `issue`: gravar `emission_request`, hash e chave **antes** de chamar `InvoiceIssuancePort.issue` → gravar `invoice_id` e `fiscal_status = 'submitted'`. Se a operação já tem `emission_request`, reutilizá-lo sem recalcular.

- [ ] **Step 1: Write the failing tests**

```ts
it('paid event with a rule and a valid customer issues once and stores invoiceId', ...);
it('does not issue when the connection was paused after the event was received', ...);
it('does not issue when the connection was disconnected after the event was received', ...);
it('stores the frozen request before calling the port; a crash after the port call and before saving invoiceId is recovered by retry with the same invoice', ...);
it('retry after rule change reuses the stored emission_request and key', ...);
it('refund event after the invoice exists sets block_reason refund_after_invoice and keeps fiscal_status submitted', ...);
it('FiscalValidationError from the port becomes needs_attention invoice_rejected with the message', ...);
it('quota error from the port becomes needs_attention quota_exceeded', ...);
it('an unexpected error propagates so the event is retried', ...);
it('ConnectorAuthError moves the connection to reauth_required', ...);
it('ConnectorDataError becomes needs_attention with the error message', ...);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest src/modules/integrations/application/event-handler.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Mapear erros do módulo de invoice: `FiscalValidationError` (`@/shared/fiscal/fiscal-validation-error`), `QuotaExceededError` e `IdempotencyConflictError` (procurar a origem com `grep -rn "class QuotaExceededError\|class IdempotencyConflictError" api/src`). `IdempotencyConflictError` indica pedido diferente para a mesma chave: tratar como `needs_attention` com `invoice_rejected`, nunca trocar a chave.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/modules/integrations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/integrations
git commit -m "feat(integrations): processamento do evento até a emissão, com pedido congelado"
```

---

### Task 9: API administrativa

**Files:**
- Create: `http/integrations.controller.ts`, `http/integrations.dto.ts`
- Modify: `api/src/modules/auth/application/auth-context.service.ts` — adicionar `'integrations.view'` e `'integrations.manage'` nas mesmas listas onde estão `'webhooks.view'` e `'webhooks.manage'` (linhas ~143 e ~162); conferir o tipo `RequiredTenantPermission` em `require-permission.decorator.ts`.
- Modify: `application/connection.service.ts` (listagens, regras), `application/operation.service.ts` (`completeCustomer`, `retry`)
- Test: `integrations.controller.spec.ts`, ajustes nos specs de permissão existentes se listarem permissões.

**Interfaces:**
- Produces as rotas da spec seção 8. DTOs com `class-validator`:
  - `CreateConnectionDto { provider: string; companyId: string (UUID); environment: 'test'|'live'; credentials: Record<string,string>; activeFrom?: string (ISO) }`
  - `RuleDto { externalProductId?: string | null; service: ServiceDto; sendEmail: boolean; allowAnonymousCustomer?: boolean }` e `PutRulesDto { rules: RuleDto[] }` (máx. 50; rejeita duas regras com o mesmo `externalProductId`).
  - `CompleteCustomerDto { name?: string; taxId: string; email?: string }` — `taxId` validado com `@/shared/tax-id` (11 ou 14 dígitos válidos).
  - Resposta de conexão: `{ id, provider, environment, companyId, state, externalAccountId, activeFrom, webhookUrl, createdAt }`, sem credenciais e sem `publicId` fora de `webhookUrl`.
  - `OperationService.completeCustomer(tenantId, id, dto)` grava o tomador no `snapshot` e zera `needs_attention`; `retry(tenantId, id)` reprocessa a operação (recalcula só se não há pedido congelado).

- [ ] **Step 1: Write the failing tests**

```ts
it('GET /integrations/providers lists manifests without credentials', ...);
it('POST /integrations/connections returns webhookUrl and never the credentials', ...);
it('every route requires integrations.view or integrations.manage as specified', ...); // verifica metadata de RequirePermission
it('PUT rules rejects two rules with the same externalProductId', ...);
it('PATCH operation customer rejects an invalid CPF/CNPJ', ...);
it('PATCH operation customer then retry issues the invoice', ...);
it('another tenant gets 404 on connection, events and operations', ...);
it('activate returns 409 with a clear message when no rule exists', ...);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest src/modules/integrations/http`
Expected: FAIL.

- [ ] **Step 3: Implement** seguindo `webhooks-config.controller.ts` (`@ApiKeyEndpoint()`, `@RequirePermission`, `@ApiOperation`, `@ApiCursorResponse()` nas listagens com `CursorQuery`). `webhookUrl` usa a variável de URL pública da API já existente (procurar `API_PUBLIC_URL`/`APP_URL` em `infra/config/env.schema.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest src/modules/integrations src/modules/auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src
git commit -m "feat(integrations): API de conexões, regras, eventos e pendências"
```

---

### Task 10: Conectores sintéticos, módulo e aceite

**Files:**
- Create: `testing/synthetic-connectors.ts`, `integrations.module.ts`
- Modify: `api/src/app.module.ts` (importar `IntegrationsModule`)
- Test: `integrations.acceptance.spec.ts` (Nest `Test.createTestingModule` com Postgres de teste, sem Redis nem prefeitura; `InvoiceIssuancePort` real ligado a um `InvoiceService` com repositórios de teste, ou dublê com a mesma semântica de idempotência)

**Interfaces:**
- Produces: `syntheticJsonConnector` (id `synthetic-json`: assina com HMAC-SHA256 no cabeçalho `x-synthetic-signature`, `deliveryId = body.id`) e `syntheticFormConnector` (id `synthetic-form`: segredo na query `?token=`, corpo `application/x-www-form-urlencoded`, `deliveryId = body.event_ref`). Formatos diferentes de propósito. Exportados só de `testing/`; o módulo de produção **não** os registra.
- `IntegrationsModule.forRoot()` registra o `ConnectorRegistry` vazio de conectores reais; módulos de conector (planos seguintes) registram o seu via `ConnectorRegistry.register` na inicialização (`OnModuleInit`), no padrão de `invoice-emit.handler.ts`.

- [ ] **Step 1: Write the failing acceptance tests** — uma por linha da spec seção 11:

```ts
it('invalid signature -> 401 and no rows', ...);
it('same event twice, sequential and parallel -> one event row and one operation', ...);
it('two different events for the same charge -> one invoice', ...);
it('resend with a new deliveryId for the same charge -> one invoice', ...);
it('test event -> 200, nothing stored', ...);
it('refund before paid notice -> no invoice', ...);
it('masked customer -> needs_attention; PATCH customer + retry -> invoice issued', ...);
it('paused connection -> event stored, no invoice', ...);
it('crash after the port accepted and before invoice_id saved -> retry returns the same invoice and no second usage reservation', ...);
it('old worker finishing after lease expiry cannot overwrite the new result', ...);
it('works with Redis down: the processor only needs Postgres', ...);
it('a second tenant cannot read the first tenant\'s connection, events or operations', ...);
it('two synthetic connectors with different formats work with no edit to the core', ...);
it('the existing POST /v1/invoices flow is unchanged', ...); // roda a suíte de invoice existente no Step 4
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest src/modules/integrations/integrations.acceptance.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** o módulo (providers, controllers, `TypeOrmModule.forFeature` das 4 entidades, import do `InvoiceModule` para o `INVOICE_ISSUANCE_PORT`) e os dois conectores sintéticos. Conferir que o `rawBody` chega ao controller para `application/x-www-form-urlencoded` (ver `bootstrap-http.ts`, `rawBody: true`).

- [ ] **Step 4: Run the whole suite**

Run: `cd api && npx jest && npx tsc --noEmit -p tsconfig.json && npx eslint src/modules/integrations`
Expected: tudo PASS; `tsc` e `eslint` sem erros novos (os avisos de complexidade já existentes não contam).

- [ ] **Step 5: Commit**

```bash
git add api/src
git commit -m "feat(integrations): módulo, conectores sintéticos e testes de aceite"
```

---

### Task 11: Documentação da API

**Files:**
- Modify: `web/lib/docs/content/pt.ts` e `en.ts` — nova seção "Integrações de pagamento" no mesmo formato das seções existentes (webhooks): conceito, `webhookUrl`, ciclo de vida da conexão, regras, pendências, tabela de estados do evento e da operação, exemplos de `curl` para `POST /integrations/connections`, `PUT .../rules`, `PATCH .../customer`.
- Modify: `api/FRONTEND_API.md` com as novas rotas.
- Test: o teste de consistência de docs existente (`web/tests/price-consistency.test.tsx` verifica exemplos de preço) deve continuar passando; adicionar `web/tests/docs-integrations.test.ts` que garante que cada rota da spec seção 8 aparece nas duas línguas.

- [ ] **Step 1: Write the failing test** `docs-integrations.test.ts`: para cada rota da spec seção 8, `expect(ptSource).toContain(route)` e `expect(enSource).toContain(route)`.
- [ ] **Step 2: Run test to verify it fails** — `cd web && npx vitest run tests/docs-integrations.test.ts` → FAIL.
- [ ] **Step 3: Write the docs** (pt e en) e `FRONTEND_API.md`.
- [ ] **Step 4: Run** `cd web && npx vitest run` → PASS (toda a suíte).
- [ ] **Step 5: Commit**

```bash
git add web api/FRONTEND_API.md
git commit -m "docs(integrations): documentação da API de integrações"
```

---

## Self-review

- **Cobertura da spec:** D1/D2 (Tasks 2, 4), D3 (5), D4 (1), D5 e D6 (6, 8, 9), D7 (7: mesmo caminho de `emit`), D8 (8), D10 (4), seção 6 (6, 8), seção 7 (5), seção 8 (9), seção 9 (3, 4), seção 11 (10), docs (11). D9 (ordem dos conectores) é dos planos seguintes.
- **Tipos consistentes:** `ClaimedEvent`, `EventOutcome`, `EmissionPlan`, `BlockReason`, `InvoiceIssuancePort` definidos antes de serem usados; `emitInEnvironment` é o único ponto novo no invoice.
- **Pontos a confirmar na execução (não são lacunas de decisão):** nome exato do método de empresa em `CompanyService` (Task 3), localização do módulo do worker (Task 5), origem de `QuotaExceededError`/`IdempotencyConflictError` (Task 8) e variável de URL pública da API (Task 9). Cada um tem o comando de busca na própria tarefa.
