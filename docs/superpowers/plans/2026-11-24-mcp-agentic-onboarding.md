# MCP completo (certificado, créditos e auditoria) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** depois do login OAuth, o agente cadastra a empresa, envia o certificado A1, emite e compra créditos (Pix ou cartão) só pelo MCP, e toda ação que muda algo na conta fica registrada numa aba "Auditoria" em Configurações.

**Architecture:** um módulo Nest global novo `account-audit` (tabela `account_audit_events` com RLS, porta `AccountAuditRecorder`, ator da requisição em AsyncLocalStorage preenchido por um interceptor global, API de listagem e expurgo de 1 ano). O MCP ganha dois escopos opcionais (`nfse:certificates`, `billing:purchase`), checagem do papel do membro na hora da chamada, conteúdo `image` nas respostas e três ferramentas novas que chamam os mesmos serviços do site. Cada serviço que muda algo grava a auditoria depois da própria escrita, então site, API e MCP ficam iguais.

**Tech Stack:** NestJS + TypeORM/Postgres (RLS), Jest; Next.js 16 + next-intl + Vitest/RTL; `qrcode` (já em `api/package.json`).

**Spec:** `docs/superpowers/specs/2026-11-24-mcp-agentic-onboarding-design.md` (ler inteira). Executores leem spec e plano.

## Global Constraints

- Ambiente: `source ~/.nvm/nvm.sh && nvm use 24`; yarn v1. API: `cd api && yarn jest <arquivo> [-t "<nome>"]`. Web: `cd web && yarn vitest run tests/<arquivo>`. Ao fim de toda tarefa: `yarn typecheck` e `yarn lint:check` no pacote tocado (na API também `yarn typecheck:tests`).
- Testes `*.postgres.integration.spec.ts` só valem com `MIGRATION_TEST_DATABASE_URL=postgresql://localhost/<db>_test`; sem a variável eles pulam e a tarefa **não** está pronta.
- Senha ou arquivo do certificado **nunca** aparecem em log, Sentry, auditoria, resposta ou mensagem de erro (inclusive erro de validação de parâmetro).
- Auditoria **nunca** guarda segredo: `metadata` passa por `sanitizeAuditMetadata` (só valores primitivos; chaves que casam `/pass|secret|token|pfx|private|authorization|cookie|api_?key|cert(ificate)?_?(file|data)/i` são descartadas; no máx. 20 chaves; strings cortadas em 200 caracteres).
- Falha ao gravar auditoria nunca derruba a ação: `record()` nunca lança; registra `Logger.error` e `captureRuntimeException(error, runtime, 'account-audit.record')`. A gravação acontece **depois** da escrita da ação e fora da transação dela.
- Leituras (listar, consultar) não são auditadas. Só ações que mudam algo.
- Escopos novos desmarcados por padrão. Textos exatos: `nfse:certificates` → "Enviar o certificado digital da empresa"; `billing:purchase` → "Gerar cobranças de créditos (Pix ou cartão). O pagamento é sempre feito por você." Nota da tela de autorização: "Se você permitir, o agente pode enviar o certificado. A Corvo guarda criptografado e nunca devolve a senha." (sai "Certificados A1 e senhas não são disponibilizados ao agente…").
- Certificado: 50 KB decodificado no máximo; um ativo por empresa e ambiente; substitui o anterior e avisa.
- Compra: só `kind: 'avulso'`, mesmas regras do site (`AVULSO_UNIT_CENTS = 99`, `AVULSO_MIN_UNITS = 3`); chave de idempotência gerada pela ferramenta; o pagamento é sempre concluído pela pessoa.
- Self-hosted (`IS_SELF_HOSTED`): `credits_purchase` e `payment_status` não são registradas e `billing:purchase` não é oferecido nem anunciado.
- Retenção da auditoria: 365 dias.
- Textos para a pessoa em português simples ("cartão ou Pix"); descrições de ferramenta em inglês como as atuais; identificadores em inglês; commits em pt-BR convencionais (`feat(mcp): ...`) terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Numeração fiscal não muda. Toda consulta de repositório em tabela com `tenant_id` leva o predicado de tenant (`tenant-predicates.spec.ts`).
- Não criar `code:` novo de erro HTTP (o teste web `api-error-codes` exige tradução de todo código). Erros das ferramentas MCP são texto.

## Review Focus

1. Gravar auditoria dentro de uma transação aberta: se o INSERT falhar, o Postgres aborta a transação da ação. Esperado: a ação conclui. Teste na Tarefa 1 (`record resolves and writes outside the ambient transaction when the insert fails`).
2. Conexão MCP antiga (só `nfse:read nfse:write`) chamando `certificate_upload`/`credits_purchase`. Esperado: mensagem simples pedindo para conectar de novo e marcar a caixa, não "Forbidden". Teste na Tarefa 2.
3. Membro que perdeu `billing.manage` (ou `nfse.certificates.manage`) depois de autorizar. Esperado: recusa clara na hora da chamada. Teste na Tarefa 2 (wrapper) e na Tarefa 4.
4. `pfx_base64` grande, com prefixo `data:`, com quebra de linha ou que não é base64. Esperado: erro claro sem ecoar o valor; quebras de linha e prefixo `data:...;base64,` aceitos. Teste na Tarefa 3.
5. `payment_status` com id de pagamento de outra conta ou inexistente. Esperado: "pagamento não encontrado", nada vaza. Teste na Tarefa 4.

---

## Ondas, donos de arquivo e conflitos

Cada tarefa roda num worktree próprio a partir de `main` atualizado e abre o próprio PR. Uma onda só começa quando os PRs da anterior foram integrados. Dentro da onda, as tarefas só dependem umas das outras pelos blocos **Interfaces**.

| Onda | Tarefa | PR |
|---|---|---|
| 1 | 1 Base da auditoria (API) | `feat(auditoria): tabela, gravação e listagem` |
| 1 | 2 Escopos opcionais e base do MCP (API + tela de autorização) | `feat(mcp): escopos de certificado e compra` |
| 2 | 3 Ferramenta `certificate_upload` + auditoria de certificado | `feat(mcp): envio do certificado` |
| 2 | 4 Ferramentas `credits_purchase` e `payment_status` + auditoria de cobrança | `feat(mcp): compra de créditos` |
| 2 | 5 Auditoria nas ações fiscais (empresa, nota, lote, importação, agenda, contador) | `feat(auditoria): ações fiscais` |
| 2 | 6 Auditoria nas ações de acesso e cobrança (membros, convites, chaves, agentes, pagamento, plano) | `feat(auditoria): acesso e cobrança` |
| 2 | 7 Aba "Auditoria" em Configurações (web) | `feat(web): aba de auditoria` |
| 3 | 8 Instruções do `initialize` e descrições no roteiro | `feat(mcp): instruções do roteiro` |
| 3 | 9 Documentação (página do MCP e `llms.txt`) | `docs(mcp): ferramentas novas` |

**Donos únicos (ninguém mais edita):**
- Onda 1 — T1: `api/src/app.module.ts`, `api/src/worker-app.module.ts`, `api/src/infra/database/rls-tables.ts`, migração nova, `api/src/infra/persistence/typeorm/tenant-work-discovery.ts`, `api/src/modules/account-audit/**`. T2: `mcp-client-policy.ts`, `mcp-consent.controller.ts`, `mcp-discovery.controller.ts`, `mcp-registration.controller.ts`, `mcp.server.ts`, o método `wrapWithScopeCheck` e o construtor-base de `mcp.service.ts`, `web/app/(dashboard)/mcp/authorize/page.tsx`, `web/lib/api.ts`, `web/messages/{pt,en}.json`. T1 e T2 não compartilham arquivo.
- Onda 2 — T3: `certificate.service.ts`, `infra/logging/logging.module.ts`, `company-create.tool.ts`, `company-update.tool.ts`. T4: `mcp.module.ts`, `checkout-router.service.ts`, `stripe-payments.service.ts`, `nfse-issue.tool.ts`. T5: `company.service.ts`, `invoice.service.ts`, `invoice-substitution.service.ts`, `invoice-batch.service.ts`, `import-emit.service.ts`, `schedule.service.ts`, `accountant-package.service.ts`. T6: `payment-fulfillment.service.ts`, `billing.service.ts`, `invitation.service.ts`, `invite-member.service.ts`, `membership.service.ts`, `api-key.service.ts`, `mcp-auth.service.ts`, `mcp-connection.service.ts`. T7: tudo em `web/` (inclusive `web/messages/{pt,en}.json`, `web/lib/api.ts`, proxy, `route-permissions.ts`).
- Onda 3 — T8: `mcp.server.ts` e descrições em `mcp/tools/*.tool.ts`. T9: `web/lib/docs/content/{pt,en}.ts`, `web/lib/llms.ts` e testes de docs.

**Pontos de conflito e como evitar:**
- `mcp.service.ts` (T3 e T4 na onda 2). T3 não adiciona parâmetro ao construtor (usa `companyService` e `certificates`, já injetados); importa logo abaixo do import de `company-create.tool` e registra logo depois do bloco de `COMPANY_CREATE_TOOL`. T4 acrescenta parâmetros **no fim** do construtor, importa logo abaixo do import de `credits-balance.tool` e registra num bloco próprio logo antes de `private wrapWithScopeCheck`. Nenhum dos dois edita `mcp.service.tools.spec.ts`: cada um cria o próprio `mcp.service.<feature>.spec.ts`. O segundo PR a entrar faz rebase; conflito, se houver, é de import.
- `web/messages/{pt,en}.json`: na onda 1 só T2; na onda 2 só T7. T7 só acrescenta chaves (`Settings.tabs`, `Audit`), sem reordenar o arquivo.
- `account-audit-action.ts` é congelado depois da onda 1: o catálogo de ações da T1 já traz todos os códigos da onda 2. Se faltar um, a tarefa pede ao orquestrador em vez de editar.
- Migração: timestamp maior que a mais nova em `main` no momento da execução (hoje `1792950000000`); a T1 usa `1792960000000` se ainda for o maior.

---

## Onda 1

### Task 1: Base da auditoria (tabela, gravação, ator, listagem, expurgo)

**Files:**
- Create: `api/src/infra/database/migrations/1792960000000-CreateAccountAuditEvents.ts`
- Modify: `api/src/infra/database/rls-tables.ts` (acrescenta `'account_audit_events'` em `TENANT_RLS_TABLES`)
- Modify: `api/src/infra/persistence/typeorm/tenant-work-discovery.ts` (kind `'account-audit-retention'`)
- Create em `api/src/modules/account-audit/`: `domain/account-audit-action.ts`, `domain/account-audit.ts`, `domain/sanitize-audit-metadata.ts`, `application/audit-actor.context.ts`, `application/audit-actor.interceptor.ts`, `application/audit-actor-label.resolver.ts`, `application/account-audit.service.ts`, `infra/account-audit-event.orm-entity.ts`, `infra/typeorm-account-audit.repository.ts`, `http/account-audit.controller.ts`, `http/list-audit-events.query.ts`, `jobs/account-audit-retention.scheduler.ts`, `testing/fake-account-audit.ts`, `account-audit.module.ts`
- Modify: `api/src/app.module.ts` (`AccountAuditModule.forRoot('api')`), `api/src/worker-app.module.ts` (`AccountAuditModule.forRoot('worker')` + scheduler)
- Test: `domain/sanitize-audit-metadata.spec.ts`, `application/account-audit.service.spec.ts`, `application/audit-actor.interceptor.spec.ts`, `http/account-audit.controller.spec.ts`, `infra/account-audit.postgres.integration.spec.ts`, `jobs/account-audit-retention.scheduler.spec.ts`

**Interfaces:**
- Consumes: `hashIp(ip, secret)` de `@/modules/platform-admin/infra/platform-admin-audit.repository`; `resolveClientIp` de `@/shared/http/client-ip`; `runWithTenant`; `queryCursorPage`/`CursorQuery`/`CursorPage`; `RequirePermission`; `executionEnvironment(ctx)`; `captureRuntimeException`.
- Produces (todas as tarefas da onda 2 usam só isto):

```ts
// domain/account-audit-action.ts — catálogo congelado após a onda 1
export const ACCOUNT_AUDIT_ACTIONS = [
  'company.created', 'company.updated', 'company.deleted',
  'certificate.uploaded', 'certificate.replaced', 'certificate.revoked',
  'invoice.issued', 'invoice.cancelled', 'invoice.substituted', 'invoice.email_resent',
  'invoice.batch_issued', 'import.emitted',
  'schedule.created', 'schedule.paused', 'schedule.resumed', 'schedule.cancelled',
  'billing.charge_created', 'billing.payment_confirmed', 'billing.plan_changed',
  'member.invited', 'member.removed', 'member.role_changed', 'invitation.accepted',
  'api_key.created', 'api_key.revoked', 'agent.connected', 'agent.disconnected',
  'accountant.package_sent', 'accountant.email_changed',
] as const;
export type AccountAuditAction = (typeof ACCOUNT_AUDIT_ACTIONS)[number];

// domain/account-audit.ts
export type AuditActorType = 'user' | 'agent' | 'api_key' | 'system';
export type AuditActorRef = { type: AuditActorType; id: string | null; onBehalfOfUserId?: string | null; ipHash?: string | null };
export const SYSTEM_ACTOR: AuditActorRef; // { type: 'system', id: null }
export type AuditTargetType = 'company' | 'certificate' | 'invoice' | 'import' | 'schedule' | 'payment' | 'plan'
  | 'member' | 'invitation' | 'api_key' | 'agent_connection' | 'accountant';
export type AuditMetadata = Record<string, string | number | boolean | null>;
export interface AccountAuditInput {
  tenantId: string;
  environment?: ExecutionEnvironment | null;   // null/omitido = ação da conta (membros, chaves, cobrança)
  action: AccountAuditAction;
  target?: { type: AuditTargetType; id?: string | null; label?: string | null };
  metadata?: Record<string, unknown>;           // sanitizado na gravação
  actor?: AuditActorRef;                         // padrão: ator da requisição; sem requisição: SYSTEM_ACTOR
}
export abstract class AccountAuditRecorder { abstract record(input: AccountAuditInput): Promise<void>; }
export interface AccountAuditEventView {
  id: string; occurredAt: string; environment: 'test' | 'live' | null;
  actor: { type: AuditActorType; label: string; onBehalfOf: string | null };
  action: AccountAuditAction;
  target: { type: string | null; id: string | null; label: string | null };
  metadata: AuditMetadata;
}

// application/audit-actor.context.ts
export function runWithAuditActor<T>(actor: AuditActorRef, work: () => T): T;
export function currentAuditActor(): AuditActorRef | undefined;

// testing/fake-account-audit.ts
export class FakeAccountAudit extends AccountAuditRecorder {
  readonly events: Array<AccountAuditInput & { actor: AuditActorRef; metadata: AuditMetadata }>;
}
```

`AccountAuditModule` é `@Global()`, exporta `AccountAuditRecorder` (implementado por `AccountAuditService`) e registra `AuditActorInterceptor` como `APP_INTERCEPTOR` só no `forRoot('api')`. HTTP: `GET /v1/audit-events?actor_type=user|agent|api_key|system&from=<ISO>&to=<ISO>&limit=1..100(50)&cursor=` → `CursorPage<AccountAuditEventView>`, `@RequirePermission('settings.manage')`, só sessão (sem `@ApiKeyEndpoint`, fora do OpenAPI público).

- [ ] **Step 1: Testes que falham — sanitização**

`sanitize-audit-metadata.spec.ts`:
```ts
it('drops secret-looking keys and keeps safe primitives', () =>
  expect(sanitizeAuditMetadata({ password: 'x', pfx_base64: 'y', apiKey: 'k', token: 't', units: 50, method: 'pix' }))
    .toEqual({ units: 50, method: 'pix' }));
it('drops objects and arrays, keeps null and booleans', () =>
  expect(sanitizeAuditMetadata({ nested: { a: 1 }, list: [1], replaced: true, number: null })).toEqual({ replaced: true, number: null }));
it('cuts strings to 200 characters and keeps at most 20 keys', ...); // 'a'.repeat(500) → length 200; 30 chaves → 20
```

- [ ] **Step 2: Rodar e ver falhar** — `cd api && yarn jest src/modules/account-audit/domain` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `sanitizeAuditMetadata(input: unknown): AuditMetadata`** com a regex e os limites de Global Constraints.

- [ ] **Step 4: Testes que falham — ator e gravação**

`audit-actor.interceptor.spec.ts`:
```ts
it('maps an MCP bearer to an agent acting for the user', ...);   // authContext.mcpConnectionId='c1', authUserId='u1' → { type:'agent', id:'c1', onBehalfOfUserId:'u1' }
it('maps an API key request to the key id', ...);                 // principalType:'api_key', request.validatedApiKeyId='k1' → { type:'api_key', id:'k1' }
it('maps a cookie session to the user', ...);                      // → { type:'user', id: authUserId }
it('leaves no actor when the request has no authContext', ...);   // currentAuditActor() === undefined dentro do handler
it('stores only a hash of the client ip', ...);                    // ipHash === hashIp(ip, otp.hmacSecret), nunca o IP
```
`account-audit.service.spec.ts` (repositório e resolver falsos):
```ts
it('records the request actor with resolved labels', ...);        // agent c1 → actor_label 'Claude', actor_on_behalf_of_label 'Pedro Henrique'
it('records SYSTEM_ACTOR with label "Sistema" outside a request', ...);
it('uses the explicit actor over the request actor', ...);
it('never stores secrets in metadata', ...);                      // metadata { password:'p', pfx_base64:'b', units: 3 } → gravado { units: 3 }
it('resolves without throwing and reports to Sentry when the insert fails', ...); // repo.insert rejeita → record() resolve; captureRuntimeException chamado 1x com 'account-audit.record'
it('record resolves and writes outside the ambient transaction when the insert fails', ...); // dentro de TypeOrmTransactionContext.run(manager,...) o repositório usa DataSource.manager, não o manager da transação
```

- [ ] **Step 5: Rodar e ver falhar.**

- [ ] **Step 6: Implementar**
  - `audit-actor.context.ts`: `AsyncLocalStorage<AuditActorRef>`.
  - `AuditActorInterceptor.intercept`: mesmo formato de `TenantDatabaseInterceptor` (envolve o `subscribe` em `runWithAuditActor`); ordem do mapeamento: `mcpConnectionId` → agent; `principalType === 'api_key'` → api_key com `request.validatedApiKeyId`; senão user (`authUserId`). `ipHash = hashIp(resolveClientIp(request), config.getOrThrow<OtpConfig>('otp').hmacSecret)`.
  - `AuditActorLabelResolver.resolve(actor, tenantId): Promise<{ label: string; onBehalfOf: string | null }>`: user → `auth_users.name` ou e-mail; agent → nome do cliente OAuth de `mcp_connections.client_id` (padrão "Agente de IA") e `onBehalfOf` = nome da pessoa; api_key → `api_keys.name`; system → "Sistema". Labels são gravados no momento da ação (não mudam depois).
  - `AccountAuditService.record`: monta a linha, sanitiza, chama `repository.insert` dentro de `runWithTenant(tenantId)`; `try/catch` total (Logger.error só com `error.name` e a ação, nunca o input) + `captureRuntimeException(error, runtime, 'account-audit.record')`; `runtime` vem do token `ACCOUNT_AUDIT_RUNTIME` fornecido por `forRoot`.
  - Repositório: escreve com `dataSource.manager` (nunca o manager de `TypeOrmTransactionContext`); `listPage(tenantId, environment, filters, cursor)` com `tenantId` no `where`, `(environment = :env OR environment IS NULL)`, ordem `occurred_at DESC, id DESC` via `queryCursorPage`; `deleteOlderThan(tenantId, cutoff: Date): Promise<number>`.

- [ ] **Step 7: Rodar os testes unitários e ver passar.**

- [ ] **Step 8: Migração + teste de integração que falha**

Tabela `account_audit_events`: `id uuid PK default gen_random_uuid()`, `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, `environment varchar(10) NULL CHECK (environment IN ('test','live'))`, `occurred_at timestamptz NOT NULL DEFAULT now()`, `actor_type varchar(10) NOT NULL CHECK (actor_type IN ('user','agent','api_key','system'))`, `actor_id text NULL`, `actor_label varchar(200) NOT NULL`, `actor_on_behalf_of_label varchar(200) NULL`, `action varchar(64) NOT NULL`, `target_type varchar(32) NULL`, `target_id text NULL`, `target_label varchar(200) NULL`, `metadata jsonb NOT NULL DEFAULT '{}'` com `CHECK (pg_column_size(metadata) <= 4096)`, `ip_hash varchar(64) NULL`. Índice `(tenant_id, occurred_at DESC, id DESC)`. RLS `ENABLE` + `FORCE`, com o mesmo predicado de `CreateAccountantPackageSends1792950000000` (`owner OR system`), mas políticas separadas `FOR SELECT`, `FOR INSERT` e `FOR DELETE`; **sem** política de UPDATE (só acrescenta).

`account-audit.postgres.integration.spec.ts` (copiar o arranjo de `accountant-package-send.postgres.integration.spec.ts`):
```ts
it('a tenant only lists its own events', ...);
it('the runtime role cannot update an event', ...);        // UPDATE afeta 0 linhas
it('lists current environment plus account-level events, newest first, with a working cursor', ...); // env 'live' vê 'live' e null, não 'test'
it('filters by actor_type and period', ...);
it('deleteOlderThan removes only rows older than the cutoff of that tenant', ...);
```

- [ ] **Step 9: Rodar com banco e ver falhar; implementar a migração; acrescentar `'account_audit_events'` em `TENANT_RLS_TABLES`; rodar de novo e ver passar** — `MIGRATION_TEST_DATABASE_URL=... yarn jest src/modules/account-audit/infra src/infra/database src/infra/persistence/tenant-predicates.spec.ts`.

- [ ] **Step 10: Controller + expurgo, testes que falham**

`account-audit.controller.spec.ts`:
```ts
it('requires settings.manage', ...);                       // metadata de permissão = ['settings.manage']
it('passes the session environment and filters to the repository', ...);
it('rejects actor_type outside the four values and limit above 100', ...); // 400 pela validation pipe
```
`account-audit-retention.scheduler.spec.ts`:
```ts
it('deletes events older than 365 days for every tenant with old rows', ...); // discovery.visit('account-audit-retention', …); cutoff = now - 365 dias
```

- [ ] **Step 11: Implementar** `AccountAuditController` (`@Controller('audit-events')`, `GET`), `ListAuditEventsQuery extends CursorQuery` (`actor_type?`, `from?`, `to?` ISO 8601, `limit` máx. 100), `AccountAuditRetentionScheduler` (`@Cron(EVERY_DAY_AT_3AM)`, `observeScheduledTask('account-audit.retention', …)`), kind `'account-audit-retention'` em `TenantWorkDiscovery.discover` (tenants com `occurred_at < now() - interval '365 days'`), `AccountAuditModule.forRoot(runtime)` e registro em `app.module.ts` e `worker-app.module.ts` (scheduler só no worker).

- [ ] **Step 12: Verificar** — `yarn jest src/modules/account-audit src/runtime-wiring.spec.ts src/worker-app.module-composition.spec.ts src/infra/persistence` (com banco), `yarn typecheck && yarn typecheck:tests && yarn lint:check`. `yarn openapi:generate` não deve mudar `docs/openapi` nem `web/public/openapi.json` (`git diff --quiet`).

- [ ] **Step 13: Commit** — `git add api && git commit -m "feat(auditoria): tabela, gravação e listagem de eventos da conta"`.

---

### Task 2: Escopos opcionais, checagem de papel e conteúdo rico no MCP

**Files:**
- Modify: `api/src/modules/mcp/mcp-client-policy.ts`, `mcp-consent.controller.ts`, `mcp-discovery.controller.ts`, `mcp-registration.controller.ts`, `mcp.server.ts`, `mcp.service.ts` (só `wrapWithScopeCheck` e injeção de `ITenantMembershipRepository`)
- Modify: `web/app/(dashboard)/mcp/authorize/page.tsx`, `web/lib/api.ts` (tipos e `mcp.decide`), `web/messages/pt.json`, `web/messages/en.json` (`McpAuthorize`)
- Test: `mcp-client-policy.spec.ts`, `mcp-consent.controller.spec.ts` (criar se não existir), `mcp.server.spec.ts`, `mcp.service.scope.spec.ts` (novo), `web/tests/mcp-authorize.test.tsx`

**Interfaces:**
- Produces:

```ts
// mcp-client-policy.ts
export const MCP_SCOPES = ['nfse:read', 'nfse:write'] as const;                 // padrão, sem mudança
export const MCP_OPTIONAL_SCOPES = ['nfse:certificates', 'billing:purchase'] as const;
export function offeredOptionalScopes(selfHosted: boolean): string[];           // sem 'billing:purchase' quando selfHosted
export function supportedScopes(selfHosted: boolean): string[];                 // MCP_SCOPES + offeredOptionalScopes
export const SCOPE_PERMISSION: Record<string, TenantPermission>;
//   'nfse:read'→'nfse.invoices.view', 'nfse:write'→'nfse.invoices.issue',
//   'nfse:certificates'→'nfse.certificates.manage', 'billing:purchase'→'billing.manage'
export function missingScopeMessage(scope: string): string;
//   "Esta conexão não tem permissão para: <SCOPE_DESCRIPTIONS[scope]>. Peça para a pessoa conectar a Corvo de novo e marcar essa opção na tela Autorizar Corvo."
export function missingMemberPermissionMessage(permission: TenantPermission): string;
//   "Seu papel nesta conta não permite esta ação (<permission>). Peça a um administrador da conta."

// mcp.server.ts
export type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export class McpToolResult { constructor(readonly content: McpContent[]) {} }
// handler que devolve McpToolResult → result.content usado como está; qualquer outro valor → texto JSON como hoje

// mcp.service.ts
private wrapWithScopeCheck(handler: ToolHandler, requiredScope: string, memberPermission?: TenantPermission): ToolHandler;
// sem escopo → Error(missingScopeMessage); com memberPermission → busca membership (findByAuthUserAndTenant(ctx.authUserId, ctx.activeTenantId)),
// inativa ou sem a permissão em permissionsForTenantRole(role) → Error(missingMemberPermissionMessage)
```
- Consent API (GET `/mcp/consent`) ganha `optional_scopes: { name; description }[]` e, por tenant, `allowed_optional_scopes: string[]`. `allowed_scopes`/`scopes` continuam só com os obrigatórios. POST aceita em `scope` os opcionais marcados, mesmo que o cliente não os tenha registrado nem pedido; cada opcional exige o papel (`SCOPE_PERMISSION`), senão 403 `MCP_SCOPE_NOT_ALLOWED` (código já existente).

- [ ] **Step 1: Testes da API que falham**

```ts
// mcp-client-policy.spec.ts
it('parses the optional scopes and keeps the default request unchanged', ...); // parseScopes('nfse:read billing:purchase x') → ['nfse:read','billing:purchase']
it('hides billing:purchase when self-hosted', ...);                          // supportedScopes(true) não contém 'billing:purchase'
it('describes the new scopes with the exact consent texts', ...);            // SCOPE_DESCRIPTIONS['nfse:certificates'] === 'Enviar o certificado digital da empresa'
// mcp-consent.controller.spec.ts
it('offers the optional scopes unchecked even when the client registered only nfse:read nfse:write', ...);
it('marks billing:purchase not allowed for a developer', ...);                // allowed_optional_scopes sem 'billing:purchase'
it('grants an optional scope the user checked', ...);                         // createAuthorizationCode recebe scope 'nfse:read nfse:write nfse:certificates'
it('refuses an optional scope the role cannot grant with MCP_SCOPE_NOT_ALLOWED', ...);
// mcp.service.scope.spec.ts
it('tells an old connection to reconnect and check the option', ...);       // ctx.scope 'nfse:read nfse:write', escopo exigido 'nfse:certificates' → message === missingScopeMessage('nfse:certificates'); não contém 'Forbidden'
it('refuses at call time when the member lost the permission', ...);         // role 'developer', memberPermission 'billing.manage' → missingMemberPermissionMessage
it('refuses an inactive membership', ...);
// mcp.server.spec.ts
it('passes McpToolResult content through, including images', ...);          // content [{type:'text'},{type:'image',data,mimeType:'image/png'}]
// discovery spec (existente ou novo)
it('advertises the four scopes in scopes_supported', ...);
```

- [ ] **Step 2: Rodar e ver falhar** — `cd api && yarn jest src/modules/mcp`.

- [ ] **Step 3: Implementar** as assinaturas acima. Discovery e registro usam `supportedScopes(IS_SELF_HOSTED)`; o padrão de registro e de `authorize` continua `MCP_SCOPES`.

- [ ] **Step 4: Rodar e ver passar.**

- [ ] **Step 5: Teste web que falha** (`web/tests/mcp-authorize.test.tsx`):
```ts
it('shows the optional permissions unchecked and sends only the base scopes by default', ...); // checkbox "Enviar o certificado digital da empresa" not.toBeChecked(); decide com scope 'nfse:read nfse:write'
it('sends the optional scope the user checks', ...);                                            // scope termina com 'nfse:certificates'
it('disables an optional permission the role cannot grant', ...);
it('shows the new certificate note', ...); // "Se você permitir, o agente pode enviar o certificado. A Corvo guarda criptografado e nunca devolve a senha."
```

- [ ] **Step 6: Rodar e ver falhar; implementar** — `TOOL_GROUPS` ganha `"nfse:certificates"` e `"billing:purchase"` (ícones `FileKey2` e `CreditCard`); seção "Permissões extras" com uma caixa por `optional_scopes`, desmarcada; `mcp.decide(params, decision, tenantId?, environment?, scopes?: string[])` envia `scope` = obrigatórios + marcados. Mensagens pt/en: `McpAuthorize.certificateNote` (texto novo), `McpAuthorize.optional.title`, `McpAuthorize.scopes.nfse:certificates`, `McpAuthorize.scopes.billing:purchase` e `tools.certificates.*`, `tools.purchase.*`. Em inglês: "Upload the company's digital certificate"; "Create credit charges (Pix or card). You always make the payment yourself."; "If you allow it, the agent can upload the certificate. Corvo stores it encrypted and never returns the password."

- [ ] **Step 7: Verificar** — `cd web && yarn vitest run tests/mcp-authorize.test.tsx tests/consent.test.ts && yarn typecheck && yarn lint`; `cd api && yarn jest src/modules/mcp && yarn typecheck && yarn typecheck:tests && yarn lint:check`.

- [ ] **Step 8: Commit** — `feat(mcp): escopos opcionais de certificado e compra na tela de autorização`.

---

## Onda 2 (começa com T1 e T2 em `main`)

### Task 3: `certificate_upload` e auditoria de certificado

**Files:**
- Create: `api/src/modules/mcp/tools/certificate-upload.tool.ts`, `certificate-upload.tool.spec.ts`, `api/src/modules/mcp/mcp.service.certificate.spec.ts`, `api/src/modules/mcp/certificate-upload.no-leak.spec.ts`
- Modify: `api/src/modules/mcp/mcp.service.ts` (import + registro, ver "Pontos de conflito"), `api/src/modules/certificate/application/certificate.service.ts` (+ spec), `api/src/infra/logging/logging.module.ts` (+ spec), `api/src/modules/mcp/tools/company-create.tool.ts`, `company-update.tool.ts` (+ specs)

**Interfaces:**
- Consumes: `McpToolResult` não é necessário (resposta é texto JSON); `wrapWithScopeCheck(handler, 'nfse:certificates', 'nfse.certificates.manage')` (T2); `AccountAuditRecorder`, `FakeAccountAudit`, `runWithAuditActor` (T1); `CompanyService.findByTaxId`, `CertificateService.upload/listByCompany`, `executionEnvironment`.
- Produces:

```ts
export const CERTIFICATE_UPLOAD_TOOL: ToolDefinition; // name 'certificate_upload'; input { tax_id: string, pfx_base64: string, password: string } todos obrigatórios
export function createCertificateUploadHandler(
  companies: Pick<CompanyService, 'findByTaxId'>,
  certificates: Pick<CertificateService, 'upload' | 'listByCompany'>,
): (raw: unknown, ctx: AuthContext) => Promise<{
  tax_id: string; holder: string; valid_until: string; environment: 'test' | 'live'; replaced: boolean; message: string;
}>;
export const MAX_PFX_BYTES = 50 * 1024;
export const MAX_PFX_BASE64_CHARS = 70_000;
```
`holder` = CN do `subject` (ou o `subject` inteiro sem CN). `message`: "Certificado salvo." ou "Certificado salvo. Ele substituiu o certificado anterior desta empresa."

- [ ] **Step 1: Testes que falham — ferramenta**

```ts
it('uploads through CertificateService in the connection environment and returns only public data', ...);
//   upload(companyId, tenant, Buffer, 'segredo', 'live'); resultado sem 'password' nem 'pfx'
it('says when it replaced the active certificate', ...);              // listByCompany devolve 1 ativo → replaced true
it('accepts line breaks and a data:...;base64, prefix', ...);
it('refuses a file larger than 50 KB without echoing it', ...);       // "O arquivo tem mais de 50 KB."
it('refuses text that is not base64 without echoing it', ...);        // "O arquivo do certificado não está em base64."
it('maps a wrong password or invalid file to a simple message', ...); // CertificateInvalidError → "Senha errada ou arquivo inválido."
it('maps an expired certificate', ...);                               // "Certificado vencido em 31/01/2026."
it('maps a CNPJ mismatch using only public CNPJs', ...);              // "O CNPJ do certificado é 11.222.333/0001-81, o da empresa é 99.888.777/0001-66."
it('reports unknown failures without the raw error', ...);            // Error('hunter2 bad mac') → "Não foi possível salvar o certificado. Tente de novo."
it('names only the invalid fields on validation errors', ...);        // password: 123 → mensagem contém 'password' e não contém '123'
```

- [ ] **Step 2: Teste que falha — não vazamento (ponta a ponta)** (`certificate-upload.no-leak.spec.ts`): monta `McpServer` com a ferramenta embrulhada, espiona `Logger.prototype.{log,warn,error,debug,verbose}`, `console.*` e `captureRuntimeException`, usa `FakeAccountAudit` e senha `'S3nh@-Secreta-123'` + base64 marcador. Para cada cenário (sucesso, senha errada, vencido, CNPJ diferente, erro desconhecido cuja mensagem contém a senha, parâmetro inválido):
```ts
expect(JSON.stringify(response)).not.toContain(PASSWORD);
expect(JSON.stringify(response)).not.toContain(PFX_B64.slice(0, 32));
expect(allSpyCalls()).not.toContain(PASSWORD);           // logs, console e Sentry
expect(JSON.stringify(fakeAudit.events)).not.toContain(PASSWORD);
```
E no `logging.module.spec.ts`:
```ts
it('redacts MCP tool arguments that carry the certificate', ...);
// SENSITIVE_LOG_REDACTION_PATHS contém 'req.body.params.arguments.password' e 'req.body.params.arguments.pfx_base64'
// e um pino com esses paths grava '[REDACTED]' para ambos (também em 'req.body.*.params.arguments.*' de lote)
```

- [ ] **Step 3: Teste que falha — auditoria no serviço** (`certificate.service.spec.ts`):
```ts
it('records certificate.uploaded with the company as target and no secrets', ...); // target { type:'company', id, label: CNPJ formatado }, metadata { valid_until }
it('records certificate.replaced when an active one existed', ...);
it('records certificate.revoked on revoke', ...);
it('records the agent as actor when called inside runWithAuditActor(agent)', ...);
it('still returns the certificate when the recorder fails', ...);
```

- [ ] **Step 4: Rodar e ver falhar** — `yarn jest src/modules/mcp/tools/certificate-upload src/modules/mcp/certificate-upload.no-leak src/modules/certificate src/infra/logging`.

- [ ] **Step 5: Implementar**
  - Handler: valida com class-validator e, no erro, informa só `error.property` (nunca `value`/constraints com valor); tira prefixo `data:[^,]*;base64,` e espaços; checa `length <= MAX_PFX_BASE64_CHARS`, regex base64 e `Buffer.length <= MAX_PFX_BYTES`; acha a empresa por CNPJ; `replaced` = `listByCompany` tinha ativo; chama `upload`; `try/catch` envolve tudo e só relança `Error` com as mensagens fixas acima (o `cause` não é anexado).
  - `CertificateService`: injeta `AccountAuditRecorder` (último parâmetro do construtor) e grava depois do `save` (upload) e do `save` do revoke; `environment` = o do certificado.
  - `logging.module.ts`: acrescenta os dois caminhos (e os equivalentes `req.body.*.params.arguments.*`).
  - `mcp.service.ts`: registra com `wrapWithScopeCheck(createCertificateUploadHandler(this.companyService, this.certificates), 'nfse:certificates', 'nfse.certificates.manage')`.
  - Descrição da ferramenta (inglês): enviar o A1 (.pfx em base64 e a senha) de uma empresa já cadastrada; a senha vem do cofre do agente; a Corvo guarda criptografado e nunca devolve; depois chamar `company_fiscal_status`.
  - `company_create`/`company_update`: descrição e mensagem de sucesso passam a apontar para `certificate_upload` (ex.: "Company created. Upload the certificate with certificate_upload before issuing in live.").
  - `mcp.service.certificate.spec.ts`: `it('registers certificate_upload behind nfse:certificates')`.

- [ ] **Step 6: Rodar e ver passar; ajustar specs quebradas pelo parâmetro novo do construtor (`yarn typecheck:tests`).**

- [ ] **Step 7: Verificar** — `yarn jest src/modules/mcp src/modules/certificate src/infra/logging && yarn typecheck && yarn typecheck:tests && yarn lint:check`.

- [ ] **Step 8: Commit** — `feat(mcp): envio do certificado A1 pelo agente, sem vazar senha`.

---

### Task 4: `credits_purchase`, `payment_status` e auditoria de cobrança

**Files:**
- Create: `api/src/modules/mcp/tools/credits-purchase.tool.ts`, `payment-status.tool.ts` (+ specs), `api/src/modules/mcp/mcp.service.credits.spec.ts`
- Modify: `api/src/modules/mcp/mcp.service.ts` (parâmetros no fim do construtor; bloco próprio antes de `wrapWithScopeCheck`), `mcp.module.ts` (importa `BillingCoreModule`), `api/src/modules/billing/application/stripe-payments.service.ts` (+ spec), `checkout-router.service.ts` (+ spec), `api/src/modules/mcp/tools/nfse-issue.tool.ts` (+ spec)

**Interfaces:**
- Consumes: `McpToolResult`, `wrapWithScopeCheck(..., 'billing:purchase', 'billing.manage')` (T2); `AccountAuditRecorder` (T1); `CheckoutRouterService.start`, `WooviPaymentsService.paymentStatus`, `BillingService.checkoutStatus`, `BillingUsageService.status`, `AVULSO_UNIT_CENTS`, `AVULSO_MIN_UNITS`, `QRCode.toBuffer` de `qrcode`, `IS_SELF_HOSTED`.
- Produces:

```ts
// stripe-payments.service.ts — campos novos, a tela do site continua usando só url
export type CardCheckout = { method: 'card'; url: string; paymentId?: string; sessionId?: string };
// paymentId = id da linha em payment_intents (também no replay: previous.id); sessionId = id da sessão Stripe quando criada agora

export const CREDITS_PURCHASE_TOOL: ToolDefinition; // input { units: integer >= 3, method: 'pix' | 'card' }
export function createCreditsPurchaseHandler(
  checkout: Pick<CheckoutRouterService, 'start'>,
): (raw: unknown, ctx: AuthContext) => Promise<McpToolResult>;
//   Pix  → text JSON { payment_id, method:'pix', units, amount_cents, amount: 'R$ 2,97', expires_at, pix_copy_paste, payment_link_url, next_step }
//          + { type:'image', mimeType:'image/png', data: <PNG base64 gerado de brCode> }
//   card → text JSON { payment_id, session_id, method:'card', units, amount_cents, amount, checkout_url, next_step }
//   next_step: "Mostre o QR Code ou o código copia-e-cola para a pessoa pagar. Depois consulte com payment_status."
//              (cartão: "Mostre o link para a pessoa pagar com cartão. Depois consulte com payment_status.")

export const PAYMENT_STATUS_TOOL: ToolDefinition;   // input { payment_id?: uuid, session_id?: string } — exatamente um
export function createPaymentStatusHandler(
  pix: Pick<WooviPaymentsService, 'paymentStatus'>,
  billing: Pick<BillingService, 'checkoutStatus'>,
  usage: Pick<BillingUsageService, 'status'>,
): (raw: unknown, ctx: AuthContext) => Promise<{
  payment_id: string | null; status: 'pending' | 'paid' | 'expired' | 'cancelled'; units: number | null; paid_at: string | null; balance?: number;
}>;
//   'failed' do PaymentStatusView vira 'cancelled'; balance (mesma conta de credits_balance) só quando 'paid'
```
`checkoutRouter.start` grava `billing.charge_created` (ator da requisição; `environment` null; target `{ type:'payment', id: paymentId }`; metadata `{ method, kind, units, amount_cents }`) depois que o provedor respondeu. Um replay idempotente grava de novo (aceito).

- [ ] **Step 1: Testes que falham**

```ts
// credits-purchase.tool.spec.ts
it('starts an avulso Pix charge with a tool-generated idempotency key', ...); // start(tenant, { kind:'avulso', units: 50, method:'pix' }, key) e key casa /^mcp-[0-9a-f-]{36}$/
it('returns the copy-and-paste code, the payment link and a PNG QR image', ...); // content[1].type 'image', mimeType 'image/png', Buffer.from(data,'base64') começa com 0x89 'PNG'
it('returns the Stripe checkout url and session for card', ...);
it('shows the price: 50 units cost 4950 cents and "R$ 49,50"', ...);
it('refuses fewer than 3 units without charging', ...);                       // start não chamado
it('explains when Pix is unavailable and suggests card', ...);                 // ServiceUnavailableException PIX_UNAVAILABLE → "Pix indisponível agora. Tente com cartão (method: card)."
it('describes the unit price and asks the agent to confirm amount and quantity with the person', ...); // description contém '0.99' e 'confirm'
// payment-status.tool.spec.ts
it('maps pending, paid, expired and failed', ...);                             // failed → 'cancelled'
it('returns the new credit balance once paid', ...);
it('answers "pagamento não encontrado" for an unknown or foreign id', ...);   // paymentStatus → null; mensagem não contém o id de outra conta
it('accepts session_id for card and maps activated to paid', ...);
it('requires exactly one of payment_id or session_id', ...);
// mcp.service.credits.spec.ts
it('registers credits_purchase and payment_status behind billing:purchase with billing.manage', ...);
it('does not register them when self-hosted', ...);                            // jest.mock('@/shared/deployment-mode', () => ({ IS_SELF_HOSTED: true }))
// stripe-payments.service.spec.ts
it('returns the payment id and the session id for a new card checkout', ...);
it('returns the stored payment id on replay', ...);
// checkout-router.service.spec.ts
it('records billing.charge_created with method, kind, units and amount, no secrets', ...);
it('does not record when the provider fails', ...);
// nfse-issue.tool.spec.ts
it('suggests credits_purchase when credits run out', ...);   // erro com code ERROR_INSUFFICIENT_CREDITS ou ERROR_QUOTA_EXCEEDED → mensagem termina com
//   " Sem créditos: use credits_purchase para gerar uma cobrança (Pix ou cartão) e payment_status para acompanhar."
it('does not suggest a purchase when self-hosted', ...);
```

- [ ] **Step 2: Rodar e ver falhar** — `yarn jest src/modules/mcp src/modules/billing/application`.

- [ ] **Step 3: Implementar** as assinaturas acima. Código do erro lido de `(err as HttpException).getResponse?.()` → `.code`. QR: `QRCode.toBuffer(brCode, { type: 'png', width: 320 })`; se `brCode` for null, sem imagem e com `payment_link_url`. Valor formatado com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`. Ferramentas registradas só se `!IS_SELF_HOSTED`.

- [ ] **Step 4: Rodar e ver passar; `yarn typecheck:tests` (o construtor da `McpService` cresceu: o spec existente usa 40 dependências vazias, conferir que ainda cobre).**

- [ ] **Step 5: Verificar** — `yarn jest src/modules/mcp src/modules/billing && yarn typecheck && yarn typecheck:tests && yarn lint:check`; `yarn openapi:generate` sem diff.

- [ ] **Step 6: Commit** — `feat(mcp): compra de créditos por Pix ou cartão e acompanhamento do pagamento`.

---

### Task 5: Auditoria nas ações fiscais

**Files (Modify + specs ao lado):** `api/src/modules/company/application/company.service.ts`, `api/src/modules/invoice/application/invoice.service.ts`, `invoice-substitution.service.ts`, `invoice-batch.service.ts`, `api/src/modules/import/application/import-emit.service.ts`, `api/src/modules/invoice-schedule/application/schedule.service.ts`, `api/src/modules/invoice/application/package/accountant-package.service.ts`

**Interfaces:**
- Consumes: `AccountAuditRecorder`, `FakeAccountAudit`, `runWithAuditActor`, `SYSTEM_ACTOR` (T1). Não edita `account-audit/**`.
- Produces: nada para outras tarefas.

Mapa (sempre depois da escrita; `environment` = o da empresa/nota; `target.label` é dado, nunca texto traduzido):

| Método | Ação | target | metadata |
|---|---|---|---|
| `CompanyService.create` / `update` / `delete` | `company.created` / `company.updated` / `company.deleted` | company, id, CNPJ formatado | `{ legal_name }` (update: `{ fields: 'a,b' }` com os nomes dos campos alterados) |
| `InvoiceService.emitInEnvironment` (nota aceita, não em replay) | `invoice.issued` | invoice, id, nome do tomador ou "Consumidor" | `{ amount, number }` (`number` quando já existir) |
| `InvoiceService.cancel` | `invoice.cancelled` | invoice | `{ number }` |
| `InvoiceSubstitutionService.substitute` | `invoice.substituted` | invoice (a nova) | `{ substitutes_invoice_id }` |
| `InvoiceService.requestEmail` | `invoice.email_resent` | invoice | — (nunca o e-mail) |
| `InvoiceBatchService.emitBatch` | `invoice.batch_issued` (um evento por lote) | — | `{ accepted, rejected }` |
| `ImportEmitService.emit` | `import.emitted` | import, id, nome do arquivo | `{ rows }` |
| `ScheduleService.createFromEmission` / `pause` / `resume` / `cancel` | `schedule.created` / `paused` / `resumed` / `cancelled` | schedule | — |
| `AccountantPackageService.sendNow` (e `sendMonthly` como `SYSTEM_ACTOR`) | `accountant.package_sent` | company | `{ month, invoice_count }` |
| `AccountantPackageService.setEmail` | `accountant.email_changed` | company | — (nunca o e-mail) |

- [ ] **Step 1: Testes que falham** — um por linha do mapa no spec do serviço, no formato:
```ts
it('records company.created with the CNPJ as target label', async () => {
  // serviço com FakeAccountAudit → audit.events[0] toMatchObject({ action:'company.created', tenantId, environment:'test', target:{ type:'company', id, label:'11.222.333/0001-81' } })
});
```
mais, uma vez por serviço: `it('keeps the action when the recorder fails')` (recorder que rejeita → método resolve) e, em `invoice.service`, `it('does not record an idempotent replay')`; em `accountant-package`, `it('records the monthly send as Sistema')`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** — `AccountAuditRecorder` como último parâmetro do construtor; `await this.audit.record(...)` depois da escrita e fora de qualquer `transaction(...)`.
- [ ] **Step 4: Rodar e ver passar; corrigir specs e módulos de teste que constroem esses serviços (`yarn typecheck:tests`; specs de módulo que compilam o grafo importam `AccountAuditModule.forRoot('api')` ou fornecem `FakeAccountAudit`).**
- [ ] **Step 5: Verificar** — `yarn jest src/modules/company src/modules/invoice src/modules/import src/modules/invoice-schedule && yarn typecheck && yarn typecheck:tests && yarn lint:check`.
- [ ] **Step 6: Commit** — `feat(auditoria): registra ações de empresa, nota, lote, importação, agenda e contador`.

---

### Task 6: Auditoria nas ações de acesso e cobrança

**Files (Modify + specs ao lado):** `api/src/modules/billing/application/payment-fulfillment.service.ts`, `billing.service.ts`, `api/src/modules/auth/application/invitation.service.ts`, `invite-member.service.ts`, `membership.service.ts`, `api-key.service.ts`, `api/src/modules/mcp/mcp-auth.service.ts`, `mcp-connection.service.ts`

**Interfaces:** mesmas da Tarefa 5. Todos estes eventos têm `environment: null`, exceto chaves de API e conexões MCP (que têm ambiente: usar o delas).

| Método | Ação | ator | target | metadata |
|---|---|---|---|---|
| `PaymentFulfillmentService.apply` | `billing.payment_confirmed` | `SYSTEM_ACTOR` | payment, id | `{ provider, kind, units, amount_cents }` |
| `PaymentFulfillmentService.activatePlan`, `BillingService` (upgrade/downgrade/aplicação de assinatura) | `billing.plan_changed` | requisição ou `SYSTEM_ACTOR` (webhook) | plan, slug, nome do plano | `{ from, to }` |
| `InvitationService.invite` / `resend` | `member.invited` | requisição | invitation, id, — | `{ role }` (nunca o e-mail nem o token) |
| `InvitationService.accept` | `invitation.accepted` | user que aceitou | member | `{ role }` |
| `InviteMemberService.removeMember` | `member.removed` | requisição | member, id, nome | — |
| `MembershipService.update` (papel mudou) | `member.role_changed` | requisição | member | `{ from, to }` |
| `ApiKeyService.create` / `revoke` / `delete` | `api_key.created` / `api_key.revoked` | requisição | api_key, id, nome | `{ key_prefix, scope }` (nunca a chave nem o hash) |
| `McpAuthService.attachConnection` (conexão nova) | `agent.connected` | user que autorizou | agent_connection, id, nome do cliente | `{ scopes: 'nfse:read nfse:write …' }` |
| `McpConnectionService.revoke` | `agent.disconnected` | requisição | agent_connection, id, nome do cliente | — |

- [ ] **Step 1: Testes que falham** — um por linha, como na Tarefa 5, e mais:
```ts
it('never stores the raw API key or its hash', ...);         // JSON.stringify(audit.events) não contém a chave criada nem key_hash
it('never stores the invitation token or email', ...);
it('records a webhook payment confirmation as Sistema', ...); // actor.type 'system'
it('keeps the action when the recorder fails', ...);         // um por serviço
```
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** (mesma regra: último parâmetro do construtor, gravação depois da escrita, fora da transação).
- [ ] **Step 4: Rodar e ver passar; corrigir specs/módulos de teste (`yarn typecheck:tests`).**
- [ ] **Step 5: Verificar** — `yarn jest src/modules/billing src/modules/auth src/modules/mcp && yarn typecheck && yarn typecheck:tests && yarn lint:check`.
- [ ] **Step 6: Commit** — `feat(auditoria): registra membros, convites, chaves, agentes, pagamentos e plano`.

---

### Task 7: Aba "Auditoria" em Configurações (web)

**Files:**
- Create: `web/lib/audit.ts`, `web/app/(dashboard)/app/settings/layout.tsx`, `web/app/(dashboard)/app/settings/audit/page.tsx`, `web/components/settings/settings-tabs.tsx`, `web/components/settings/audit-list.tsx`
- Modify: `web/lib/api.ts` (`auditEvents.list`), `web/app/api/proxy/[...path]/route.ts` (`[/^audit-events$/, ["GET"]]`), `web/lib/route-permissions.ts` (`["/app/settings/audit", "settings.manage"]`, antes de `/app/settings`), `web/messages/pt.json`, `web/messages/en.json`
- Test: `web/tests/settings-audit.test.tsx`, `web/tests/audit-messages.test.ts`, `web/tests/proxy.test.ts`, `web/tests/route-permissions.test.ts`

**Interfaces:**
- Consumes: `GET /v1/audit-events` e `AccountAuditEventView` (T1, chaves em camelCase como no contrato).
- Produces:

```ts
// web/lib/audit.ts
export const AUDIT_ACTIONS: readonly string[];  // cópia de ACCOUNT_AUDIT_ACTIONS
export type AuditActorFilter = "all" | "user" | "agent" | "api_key" | "system";
export type AuditEvent = { id: string; occurredAt: string; environment: "test" | "live" | null;
  actor: { type: "user" | "agent" | "api_key" | "system"; label: string; onBehalfOf: string | null };
  action: string; target: { type: string | null; id: string | null; label: string | null }; metadata: Record<string, string | number | boolean | null> };
export function auditItemText(event: AuditEvent, t: (key: string, values?: Record<string, unknown>) => string): string;
//   billing.* com metadata.method/units → "Pix · 50 créditos" / "Cartão · 50 créditos"; senão target.label; sem nada → "—"
// web/lib/api.ts
export const auditEvents = { list: (params: { actorType?: Exclude<AuditActorFilter,"all">; from?: string; to?: string; cursor?: string; limit?: number }, signal?: AbortSignal) => Promise<Page<AuditEvent>> };
```

Tela: abas como links (`Geral` → `/app/settings`, `Auditoria` → `/app/settings/audit`; a aba Auditoria só aparece com `can("settings.manage")`). Tabela com colunas Quando / Quem / Ação / Item. "Quando" relativo ("há 6 h", via `Intl.RelativeTimeFormat` do locale) com `title` = data e hora exatas. "Quem": agente → `label` + selo "Agente" + "· {onBehalfOf}"; sistema → "Sistema". Filtros: Quem (Todos, Pessoas, Agentes, Chaves de API, Sistema) e Período (7 dias, 30 dias, 1 ano — padrão 30 dias). "Carregar mais" segue `nextCursor`. Estado vazio e de erro com textos próprios.

- [ ] **Step 1: Testes que falham**
```ts
// audit-messages.test.ts
it('has a pt and en label for every action the API records', ...); // lê ../api/src/modules/account-audit/domain/account-audit-action.ts, extrai os códigos entre aspas, compara com AUDIT_ACTIONS e com Audit.actions.<code> em pt e en
// settings-audit.test.tsx
it('lists who did what and when, in the reference format', ...);  // "Pedro Henrique", "Emitiu nota"; agente → "Claude", selo "Agente", "· Pedro"; sistema → "Sistema", "Pagamento confirmado", "Pix · 50 créditos"
it('shows the exact date on hover', ...);                         // title contém a data completa
it('filters by agents and by period', ...);                       // auditEvents.list chamado com { actorType:'agent', from: <ISO de 7 dias atrás> }
it('loads more with the cursor', ...);
it('hides the Auditoria tab without settings.manage', ...);
// proxy.test.ts
it('forwards GET audit-events and refuses POST', ...);
// route-permissions.test.ts
it('requires settings.manage for /app/settings/audit', ...);
```
- [ ] **Step 2: Rodar e ver falhar** — `cd web && yarn vitest run tests/settings-audit.test.tsx tests/audit-messages.test.ts tests/proxy.test.ts tests/route-permissions.test.ts`.
- [ ] **Step 3: Implementar.** Mensagens: `Settings.tabs.{general,audit}`; `Audit.{title,subtitle,columns.{when,who,action,item},filters.{who,period,all,user,agent,api_key,system,d7,d30,y1},agentBadge,system,empty,error,loadMore,charge.{pix,card}}`; `Audit.actions.<código>` em pt (ex.: `invoice.issued` "Emitiu nota", `certificate.uploaded` "Enviou certificado", `billing.payment_confirmed` "Pagamento confirmado") e en.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Verificar** — `yarn vitest run && yarn typecheck && yarn lint`.
- [ ] **Step 6: Commit** — `feat(web): aba Auditoria em Configurações`.

---

## Onda 3 (começa com a onda 2 em `main`)

### Task 8: Instruções do `initialize` e descrições no roteiro

**Files:** Modify `api/src/modules/mcp/mcp.server.ts` (+ `mcp.server.spec.ts`), `api/src/modules/mcp/mcp.service.ts` (passa o texto ao servidor), descrições em `mcp/tools/{cnpj-lookup,company-create,company-fiscal-status,nfse-issue,credits-balance,credits-purchase,payment-status,certificate-upload}.tool.ts`.

**Interfaces:**
- Produces: `export function mcpInstructions(selfHosted: boolean): string` em `mcp.server.ts`; `new McpServer({ instructions })`; o resultado do `initialize` ganha `instructions` (campo do protocolo).

Texto (inglês, um passo por linha), seguindo a seção 5.4 da spec: o usuário já fez login pelo OAuth; 1 `cnpj_lookup`; 2 `company_create`; 3 `certificate_upload` (senha só do cofre do agente, nunca repetir na conversa); 4 `company_fiscal_status` até "pronto para emitir"; 5 `nfse_issue`; 6 `credits_balance`; 7 `credits_purchase` (confirmar quantidade e valor com a pessoa; mostrar QR Code/copia-e-cola ou link; a pessoa sempre paga); 8 `payment_status` até `paid`, depois seguir emitindo; ferramentas sem permissão → pedir para reconectar marcando a opção. Self-hosted: sem os passos 7 e 8.

- [ ] **Step 1: Testes que falham**
```ts
it('sends instructions on initialize that follow the agent route in order', ...); // índices crescentes de cnpj_lookup, company_create, certificate_upload, company_fiscal_status, nfse_issue, credits_balance, credits_purchase, payment_status
it('says the person always completes the payment', ...);
it('omits credits_purchase and payment_status when self-hosted', ...);
it('tool descriptions point to the next step of the route', ...); // company_create → 'certificate_upload'; certificate_upload → 'company_fiscal_status'; credits_purchase → 'payment_status'
```
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar** — `yarn jest src/modules/mcp`.
- [ ] **Step 3: Verificar** — `yarn typecheck && yarn typecheck:tests && yarn lint:check`.
- [ ] **Step 4: Commit** — `feat(mcp): instruções do roteiro login → empresa → certificado → nota → créditos`.

### Task 9: Documentação (página do MCP e `llms.txt`)

**Files:** Modify `web/lib/docs/content/pt.ts`, `web/lib/docs/content/en.ts`, `web/lib/llms.ts`; Test `web/tests/llms.test.ts`, `web/tests/docs-parity.test.ts` (e `docs-mcp-clients.test.ts` se cobrir a lista de ferramentas).

Conteúdo: na página do MCP, as ferramentas `certificate_upload`, `credits_purchase`, `payment_status`; os escopos opcionais com os textos exatos de Global Constraints; o roteiro da seção 5.4; "a senha fica no cofre do agente; a Corvo guarda criptografado e nunca devolve"; "o pagamento é sempre feito pela pessoa"; a aba Auditoria. Em `llms.ts` (pt e en), uma linha nova para cada ferramenta e a frase do roteiro.

- [ ] **Step 1: Testes que falham**
```ts
it('llms.txt names the three new MCP tools in both languages', ...);
it('the MCP docs page lists the optional scopes with the consent texts', ...);
```
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar** — `cd web && yarn vitest run tests/llms.test.ts tests/docs-parity.test.ts tests/docs-mcp-clients.test.ts`.
- [ ] **Step 3: Verificar** — `yarn typecheck && yarn lint`.
- [ ] **Step 4: Commit** — `docs(mcp): certificado, compra de créditos e auditoria`.

---

## Fecho de cada onda (orquestrador)

Depois de integrar os PRs da onda: em `main` atualizado, `cd api && yarn jest && yarn typecheck && yarn typecheck:tests && yarn lint:check` (com `MIGRATION_TEST_DATABASE_URL`), `yarn openapi:generate` sem diff, e `cd web && yarn vitest run && yarn typecheck && yarn lint`. Remover os worktrees dos PRs já enviados.
