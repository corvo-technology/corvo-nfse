# Admin da plataforma — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** dar ao dono da Corvo uma área `/app/admin` (visão geral, usuários, detalhe, atenção, histórico) e a ação "dar notas avulsas", protegidas por `PLATFORM_ADMIN_EMAILS` e por um guard que recalcula a cada requisição.

**Arquitetura:** módulo Nest `platform-admin` com rotas `/v1/platform/*` atrás de `PlatformAdminGuard` (404 para qualquer um que não seja admin por sessão). Leituras de todos os clientes passam por `PlatformReadSession` (`SystemPurpose 'platform-admin'` + `SET TRANSACTION READ ONLY`). Escrita só existe na concessão de notas, dentro de `runAsPlatformAdminOnTenant`, com auditoria na mesma transação. O web ganha páginas sob `/app/admin`, com gate no servidor e entradas novas na lista do proxy.

**Stack:** NestJS + TypeORM/Postgres (RLS), Jest; Next.js 16 + next-intl + Vitest/RTL.

**Spec:** `docs/superpowers/specs/2026-11-23-platform-admin-design.md` (ler inteira, inclusive 5.8). Executores leem spec e plano.

## Global Constraints

- Variável nova **única**: `PLATFORM_ADMIN_EMAILS` (lista separada por vírgula; minúsculas, sem espaços; vazia/ausente = ninguém é admin; sem fallback para "primeiro usuário").
- Admin = e-mail na lista **e** `auth_users.email_verified_at IS NOT NULL`, só por sessão por cookie. Chave de API e MCP nunca são admin. `AuthContext.isPlatformAdmin` continua `false` e `contextType` continua `'tenant'` (5.8.1).
- Não admin, chave de API e MCP recebem **404** `RESOURCE_NOT_FOUND` nas rotas do admin. Sem cookie, o `CookieAuthGuard` global responde 401 como em qualquer rota (indistinguível).
- Leitura de todos os clientes: só `PlatformReadSession` (transação `READ ONLY`); nenhum SQL de escrita sob `platform-admin/infra/read`. Nunca devolver: chave de API inteira (só `key_prefix`), `key_hash`, colunas `encrypted_*` de certificado, tokens de sessão, `payment_intents.checkout`.
- Concessão: `amount` inteiro 1–500; `reason` 5–500 caracteres; `notifyUser` padrão `false`; cabeçalho `Idempotency-Key` obrigatório (1–200 caracteres, código existente `IDEMPOTENCY_KEY_INVALID`). Lançamento `type:'bonus', source:'bonus'`; nunca `grantAvulso`. Mesma chave com dados diferentes: 409 `IDEMPOTENCY_KEY_REUSED`.
- Auditoria: `platform_admin_audit_events` sem RLS, guarda para sempre; sucesso na **mesma transação** do crédito (fail-closed); falha em transação separada (se até ela falhar, `Logger.error`). `user_viewed` por carregamento do detalhe, gravado **antes** de devolver os dados.
- Janelas: "hoje" = dia em `America/Sao_Paulo` (UTC−3 fixo); 7 e 30 dias = rolantes. Notas de **produção** = `nfse_invoices.environment = 'live'`; teste = `'test'`.
- Self-hosted (`IS_SELF_HOSTED`): rota de concessão não existe (404); páginas escondem créditos, planos, pagamentos, receita e o botão; usuários, empresas e notas continuam.
- Texto de UI em pt-BR e en (`web/messages`), sem inventar `code:` novo na API além de `IDEMPOTENCY_KEY_REUSED` (o teste `api-error-codes` exige tradução de todo código).
- Código, identificadores e mensagens de commit: identificadores em inglês; commits em pt-BR, convencionais (`feat(admin): ...`).
- Comandos: API `cd api && yarn jest <arquivo> [-t "<nome>"]`; testes `*.postgres.integration.spec.ts` precisam de `MIGRATION_TEST_DATABASE_URL=postgresql://localhost/<db>_test` (sem a variável eles **pulam**: a tarefa só está pronta quando rodou com banco). Web `cd web && yarn vitest run tests/<arquivo>`. Ao fim de cada tarefa: `yarn typecheck` (e `yarn typecheck:tests` na API) do pacote tocado.

## Decisão da receita (spec 5.8 item 6)

Evidência no código: renovação e primeira cobrança de assinatura **Stripe** não vão para `payment_intents`. `BillingService.webhook` (`api/src/modules/billing/application/billing.service.ts`) trata `invoice.paid` só por `applySubscription` (atualiza `tenant_billing`) e `recordEvent` grava em `webhook_events` apenas `(provider_event_id, event_type, payload_sha256)`, sem valor nem tenant; `ProviderEvent` nem carrega o valor. Já Woovi (Pix Automático) grava uma linha `kind='plan'`, `cycle='monthly'`, `status='paid'` por ciclo (`woovi-payments.service.ts`, `provider_ref` único), e Stripe pagamento único (anual, avulso) grava `kind` `'plan'|'avulso'` com `provider='stripe'`. Valores reais: `PaymentIntentKind = 'plan' | 'avulso'`; `PaymentIntentStatus = 'pending'|'authorized'|'paid'|'expired'|'mismatch'|'rejected'|'cancelled'`.

**Ramo escolhido: passar a gravar.** A Tarefa 5 faz o webhook `invoice.paid` (com assinatura e valor > 0) inserir uma linha `provider='stripe'`, `kind='plan'`, `cycle='monthly'`, `status='paid'`, `provider_ref = invoice.id`. Receita = soma de `payment_intents` com `status='paid'`. O histórico anterior à publicação não é reconstruído: a tela diz, com a data, desde quando as assinaturas no cartão entram (`revenue.stripeRecordedSince`). As linhas "contrato" Woovi ficam `authorized` e nunca entram na soma.

## Contrato HTTP (fonte única; API e web seguem estes tipos)

Respostas simples vêm em `{ data: T }`; listas em `CursorPage` (`{ data, pagination: { limit, hasMore, nextCursor } }`). Tipos em `api/src/modules/platform-admin/platform-admin.contract.ts` (Tarefa 8) e espelhados em `web/lib/platform-admin.ts` (Tarefa 6).

```ts
type Windows = { today: Win; d7: Win; d30: Win }; type Win = { authorized: number; rejected: number; rejectionRate: number | null };
type PlatformOverview = {
  users: { total: number; new7d: number; new30d: number };
  invoices: { live: Windows; test: Windows };
  revenue: { d7: Rev; d30: Rev; stripeRecordedSince: string | null };   // Rev = { subscriptionCents; avulsoCents; totalCents }
  adminGrants: { units7d: number; units30d: number };                   // não é receita
};
type PlatformUserRow = { id; email; name; createdAt; planSlug: string | null; liveInvoicesThisMonth: number;
  avulsoBalance: number; companiesCount: number; lastActivityAt: string | null };   // relativo ao workspace próprio (tenant_id = user id; senão o admin mais antigo)
type PlatformUserDetail = { user: { id; email; name; emailVerifiedAt; createdAt; lastLoginAt: string | null };
  workspaces: { tenantId; role; isOwn: boolean; plan: { slug; name } | null;
    usage: { included; authorized; reserved; periodEnd } | null; avulsoBalance: number;
    companies: { id; taxId; legalName; municipalityCode; environment; certificateValidUntil: string | null }[];
    recentInvoices: { id; status; amount: number; environment; lastErrorCode: string | null; createdAt }[];  // 20
    credits: { id; type; source: string | null; amount; description: string | null; createdAt }[];          // 20
    payments: { id; kind; provider; amountCents; status; paidAt: string | null }[];                         // 20
    apiKeys: { id; name; keyPrefix; environment; lastUsedAt: string | null }[];
    mcpConnections: { id; clientName; lastUsedAt: string | null }[] }[] };
type PlatformAttention = {   // cada item traz userId (admin mais antigo do tenant, senão o próprio tenantId) e tenantId; até 100 por lista
  staleInvoices: { invoiceId; tenantId; userId; status; updatedAt }[];
  expiringCertificates: { companyId; tenantId; userId; taxId; validUntil }[];
  failingWebhooks: { tenantId; userId; failedCount24h: number; lastFailureAt }[];
  failedPayments: { tenantId; userId; source: 'intent' | 'subscription'; status; at }[] };
type PlatformAuditEvent = { id; actorEmail; action: 'credit_grant' | 'user_viewed'; targetTenantId: string | null; targetUserId: string | null;
  reason: string | null; payload: Record<string, unknown>; success: boolean; createdAt };
type CreditGrantResult = { tenantId: string; amount: number; balance: number; replayed: boolean };
```

Endpoints: `GET /v1/platform/overview`, `GET /v1/platform/users?search&limit&cursor` (limit máx. 50), `GET /v1/platform/users/:id`, `GET /v1/platform/attention`, `GET /v1/platform/audit?limit&cursor`, `POST /v1/platform/tenants/:tenantId/credit-grants`.

## Ondas, pontos quentes e migrações

Dentro de uma onda as tarefas tocam arquivos disjuntos e rodam em paralelo (um worktree cada). Uma onda só começa quando a anterior foi integrada; tarefas de onda posterior dependem das anteriores **só** pelos blocos Interfaces.

| Onda | Tarefas |
|---|---|
| 1 | 1 acesso/política, 2 último login, 3 escopo e leitura somente-leitura, 4 auditoria, 5 receita Stripe, 6 web cliente/proxy, 7 web mensagens |
| 2 | 8 guard e módulo núcleo, 9 web gate e menu, 10 web modal de concessão |
| 3 | 11 visão geral (API), 12 lista de usuários (API), 13 detalhe (API), 14 atenção e histórico (API), 15 concessão (API), 16–19 páginas web |
| 4 | 20 fiação e invariantes |

**Pontos quentes (cada um tem dono único):** `api/src/app.module.ts` e `platform-admin.module.ts` → Tarefa 20; `tenant-context.storage.ts` → 3; `auth.module.ts`, `session.controller.ts`, `env.schema.ts`, `.env.example`, `deploy/README.md`, `SELF_HOSTING.md`, `TENANT_ISOLATION.md` → 1; `api-key.guard.ts` → 8; `credits.service.ts` → 15; `web/messages/{pt,en}.json` → 7 (todas as chaves das páginas já nascem lá); `web/app/api/proxy/[...path]/route.ts`, `web/lib/api.ts`, `web/lib/auth.tsx`, `web/lib/platform-admin.ts` → 6; `web/components/dashboard/sidebar.tsx` e `web/app/(dashboard)/app/layout.tsx` → 9. Cada feature de API tem o **próprio** módulo Nest (`*.module.ts`), que a Tarefa 20 registra.

**Migrações** (todas posteriores a `1792910000000-AddSelfHostedPlan`, únicas): `1792920000000-AddAuthUserLastLoginAt` (T2), `1792930000000-CreatePlatformAdminAuditEvents` (T4), `1792940000000-AddInvoiceEnvStatusCreatedIndex` (T11).

## Review Focus

Falhas que a spec implica mas nenhum teste óbvio cobre (cada uma tem teste na tarefa dona):

1. **Saldo em cache inflado** quando o commit falha depois do `grantBonus` (o cache de 24 h guarda o saldo de dentro da transação desfeita) → teste na Tarefa 15.
2. **Duas requisições simultâneas com a mesma `Idempotency-Key`**: uma só concessão, a outra devolve o resultado da primeira → Tarefa 15.
3. **Vazamento para o cliente**: `GET /credits/history` serializa `metadata`; motivo e e-mail do admin não podem ir para lá → Tarefa 15.
4. **Busca com `%`, `_`, máscara de CNPJ e texto longo** na lista de usuários → Tarefa 12.
5. **Fronteira do dia em BRT e linhas de contrato Woovi** (`authorized`) na receita, e notas de bônus contadas como receita → Tarefa 11.

Também cobertos: `switchTenant` perde a flag no web (T1/T6), detalhe de usuário inexistente ou id inválido (T13), `last_login_at` nunca bloqueia o login (T2).

---

### Tarefa 1: Quem é admin (política, sessão, env, docs)

**Onda 1.**

**Files:**
- Create: `api/src/modules/auth/application/platform-admin.policy.ts`, `platform-admin.policy.spec.ts`; `api/src/infra/config/platform-admin-env.spec.ts`; `api/src/modules/auth/http/session.controller.platform-admin.spec.ts`
- Modify: `api/src/infra/config/env.schema.ts` (campo opcional), `api/src/modules/auth/auth.module.ts` (provider e exports `PlatformAdminPolicy` e `TypeOrmTenantRepository`), `api/src/modules/auth/http/session.controller.ts`
- Modify (docs): `api/.env.example`, `deploy/.env.example`, `deploy/README.md`, `SELF_HOSTING.md` (linha na tabela de configurações), `api/TENANT_ISOLATION.md` (parágrafo: propósito `platform-admin`, transação `READ ONLY`, auditoria sem RLS). `deploy/docker-compose.yml` não muda (`env_file` já repassa).

**Interfaces:**
- Produces: `parsePlatformAdminEmails(raw: string | undefined): ReadonlySet<string>`; `class PlatformAdminPolicy { constructor(config: ConfigService, users: AuthUserService); resolve(authUserId: string): Promise<{ isAdmin: boolean; email: string | null }> }`. Sessão: `GET /auth/session` **e** `POST /auth/session/tenant` passam a devolver `isPlatformAdmin: boolean` no topo de `data` (não dentro de `context`).

Evidência do e-mail verificado: `MagicLinkService.completeLogin` (único funil de código e de Google/GitHub, `oauth.controller.ts:162`) chama `markEmailVerified`, e `oauth-providers.ts` só aceita e-mail verificado pelo provedor. Nenhum fluxo precisa de correção.

- [ ] **Step 1: testes que falham**

```ts
// platform-admin.policy.spec.ts
it('normaliza a lista', () => expect([...parsePlatformAdminEmails(' Ana@X.com, b@y.com ,,')]).toEqual(['ana@x.com','b@y.com']));
it.each([undefined, '', '  '])('vazio %p = ninguém', (raw) => expect(parsePlatformAdminEmails(raw).size).toBe(0));
it('admin: na lista e verificado, comparando em minúsculas', async () => expect(await policy('ana@x.com', { email: 'Ana@X.com', emailVerifiedAt: new Date() }).resolve('u1')).toEqual({ isAdmin: true, email: 'Ana@X.com' }));
it('na lista mas e-mail não verificado não é admin', async () => expect((await policy('ana@x.com', { email: 'ana@x.com', emailVerifiedAt: null }).resolve('u1')).isAdmin).toBe(false));
it('fora da lista, usuário inexistente e env vazio não são admin', async () => { /* três asserts isAdmin === false */ });
it('lê o usuário a cada chamada (sem cache)', async () => { const p = policy(...); await p.resolve('u1'); await p.resolve('u1'); expect(users.findById).toHaveBeenCalledTimes(2); });
// platform-admin-env.spec.ts: parseEnvConfig({ ...base, PLATFORM_ADMIN_EMAILS: 'a@b.com' }).PLATFORM_ADMIN_EMAILS === 'a@b.com'; ausente => undefined (copiar a base de deployment-mode-env.spec.ts)
// session.controller.platform-admin.spec.ts
it('getSession devolve isPlatformAdmin true para admin, com context.isPlatformAdmin false e contextType tenant', ...);
it('switchTenant também devolve isPlatformAdmin', ...);
```

- [ ] **Step 2:** `cd api && yarn jest src/modules/auth/application/platform-admin.policy.spec.ts src/infra/config/platform-admin-env.spec.ts src/modules/auth/http/session.controller.platform-admin.spec.ts` — esperado: FAIL ("Cannot find module './platform-admin.policy'").
- [ ] **Step 3:** implementar `PlatformAdminPolicy` (a lista é lida uma vez no construtor de `config.get<string>('PLATFORM_ADMIN_EMAILS')`; `resolve` lê `AuthUserService.findById` a cada chamada); `PLATFORM_ADMIN_EMAILS: z.string().optional()` no schema; injetar a política no `SessionController` e acrescentar a flag nas duas respostas; registrar/exportar no `AuthModule`; escrever as docs (tabela de `SELF_HOSTING.md`: "Lista de e-mails que viram admin da plataforma; vazio = ninguém"; nota de que o e-mail precisa estar verificado e de que no self-hosted a concessão não existe).
- [ ] **Step 4:** repetir o Step 2 — esperado PASS; `cd api && yarn typecheck && yarn typecheck:tests`; `grep -c PLATFORM_ADMIN_EMAILS api/.env.example deploy/.env.example deploy/README.md SELF_HOSTING.md` — cada arquivo com contagem ≥ 1; `grep -c platform-admin api/TENANT_ISOLATION.md` ≥ 1.
- [ ] **Step 5:** `git add api docs deploy SELF_HOSTING.md && git commit -m "feat(admin): política de admin por e-mail verificado e flag na sessão"`

---

### Tarefa 2: `auth_users.last_login_at`

**Onda 1.**

**Files:**
- Create: `api/src/infra/database/migrations/1792920000000-AddAuthUserLastLoginAt.ts`, `1792920000000-AddAuthUserLastLoginAt.spec.ts` (mesmo formato de `add-cancellation-requested-at.spec.ts`), `api/src/modules/auth/application/magic-link.service.login.spec.ts`
- Modify: `api/src/infra/persistence/typeorm/entities/auth.orm-entities.ts` (`AuthUserOrmEntity.lastLoginAt`), `api/src/modules/auth/domain/auth-user.ts`, `.../domain/auth-user.repository.ts`, `api/src/infra/persistence/typeorm/repositories/auth.repositories.ts`, `api/src/modules/auth/application/auth-user.service.ts` (+ `auth-user.service.spec.ts`), `api/src/modules/auth/application/magic-link.service.ts`

**Interfaces:**
- Produces: `AuthUser.lastLoginAt?: Date | null` (opcional, para não quebrar fixtures); `IAuthUserRepository.updateLastLoginAt(authUserId: string, at: Date): Promise<void>` (um `UPDATE ... SET last_login_at`, sem ler e regravar o usuário); `AuthUserService.markLogin(authUserId: string, now?: Date): Promise<void>`.

Achado: o `markLogin` da spec **não roda em login nenhum**. Só o `AuthLoginRecordedListener` o chama, e esse listener não está registrado nem tem emissor. A tarefa chama `markLogin` direto do funil `completeLogin` (cobre código, Google e GitHub).

- [ ] **Step 1: testes que falham**

```ts
it('up adiciona last_login_at timestamptz nulo', ...);   // regex /ADD COLUMN last_login_at timestamptz/ e sem NOT NULL; down faz DROP COLUMN
it('markLogin só atualiza last_login_at', async () => { await service.markLogin('u1', at); expect(repo.updateLastLoginAt).toHaveBeenCalledWith('u1', at); expect(repo.update).not.toHaveBeenCalled(); });
it('completeLogin registra o login uma vez', async () => { await magic.completeLogin(user, false, 'google'); expect(authUsers.markLogin).toHaveBeenCalledWith(user.id); });
it('falha ao registrar o login não derruba o login', async () => { authUsers.markLogin.mockRejectedValue(new Error('db')); await expect(magic.completeLogin(user, false, 'x')).resolves.toHaveProperty('sessionToken'); });
```

- [ ] **Step 2:** `cd api && yarn jest src/infra/database/migrations/1792920000000-AddAuthUserLastLoginAt.spec.ts src/modules/auth/application/magic-link.service.login.spec.ts src/modules/auth/application/auth-user.service.spec.ts` — esperado FAIL.
- [ ] **Step 3:** migração `ALTER TABLE <schema>.auth_users ADD COLUMN last_login_at timestamptz` (esquema como em `1792910000000`); coluna na entidade; `updateLastLoginAt` hoje existe sem uso e grava `updatedAt`: corrigir para gravar `lastLoginAt` e declarar no `IAuthUserRepository`; `markLogin` delega a ele; `completeLogin` chama `markLogin` após `markEmailVerified` dentro de `try/catch` com `Logger.warn`; `toAuthUser` mapeia a coluna.
- [ ] **Step 4:** repetir Step 2 — PASS; `yarn typecheck && yarn typecheck:tests`.
- [ ] **Step 5:** `git commit -m "feat(auth): grava o último login no auth_users"`

---

### Tarefa 3: Escopo de plataforma e leitura somente-leitura

**Onda 1.**

**Files:**
- Modify: `api/src/infra/persistence/typeorm/tenant-context.storage.ts`
- Create: `api/src/infra/persistence/typeorm/tenant-context.storage.platform-admin.spec.ts`, `api/src/modules/platform-admin/infra/platform-read-session.ts`, `platform-read-session.spec.ts`, `platform-read-session.postgres.integration.spec.ts`

**Interfaces:**
- Produces: `SystemPurpose` ganha `'platform-admin'`; `runAsPlatformAdminOnTenant<T>(tenantId: string, work: () => T): T` (valida UUID, `storage.run({ tenantId }, work)`: descarta o escopo do request e **não** liga `system`); `type PlatformQuery = <R = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => Promise<R[]>`; `@Injectable() class PlatformReadSession { constructor(@InjectDataSource() dataSource: DataSource); run<T>(work: (q: PlatformQuery) => Promise<T>): Promise<T> }`.

Achado: o `TenantDatabaseInterceptor` envolve **todo** request em `runWithTenant(activeTenantId do admin)`, e `runWithTenant` lança `RESOURCE_NOT_FOUND` quando o tenant atual difere. Logo o admin não consegue chamar `runWithTenant(tenantAlvo)` de dentro do request; por isso `runAsPlatformAdminOnTenant`.

- [ ] **Step 1: testes que falham**

```ts
// storage
it('runAsPlatformAdminOnTenant troca o tenant do request pelo alvo, sem system', () => runWithTenant(A, () => runAsPlatformAdminOnTenant(B, () => expect(getDatabaseScope()).toEqual({ tenantId: B }))));
it('rejeita tenantId que não é UUID', () => expect(() => runAsPlatformAdminOnTenant('x', () => 1)).toThrow());
// platform-read-session.spec.ts (queryRunner falso)
it('abre transação e roda SET TRANSACTION READ ONLY antes de qualquer consulta', ...);   // ordem: connect, startTransaction, query('SET TRANSACTION READ ONLY'), work, commit, release
it('faz rollback e libera quando o trabalho lança', ...);
it('roda sob o escopo system platform-admin e sem tenant, mesmo dentro de runWithTenant', () => runWithTenant(A, () => session.run(async () => expect(getDatabaseScope()).toEqual({ system: 'platform-admin' }))));
// integration (Postgres, role sem BYPASSRLS como em tenant-rls.postgres.integration.spec.ts)
it('um INSERT por este caminho falha com "read-only transaction", com app.system_context=on', ...);
it('lê linhas de dois tenants (RLS aberto só para leitura)', ...);
```

- [ ] **Step 2:** `cd api && yarn jest src/infra/persistence/typeorm/tenant-context.storage.platform-admin.spec.ts src/modules/platform-admin/infra/platform-read-session.spec.ts` — esperado FAIL.
- [ ] **Step 3:** implementar. `PlatformReadSession.run`: `runAsSystem('platform-admin', ...)` → `dataSource.createQueryRunner()` → `connect` → `startTransaction` → `query('SET TRANSACTION READ ONLY')` → `work(q)` onde `q = (sql, params) => runner.query(sql, [...params])` → `commit`; em erro `rollback`; sempre `release`. A conexão é pega dentro do escopo system, então `rls-connection-scope.ts` liga `app.system_context`.
- [ ] **Step 4:** Step 2 PASS; integração: `MIGRATION_TEST_DATABASE_URL=... yarn jest src/modules/platform-admin/infra/platform-read-session.postgres.integration.spec.ts` PASS; `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(admin): escopo platform-admin e sessão de leitura somente-leitura"`

---

### Tarefa 4: Tabela e repositório de auditoria

**Onda 1.**

**Files:**
- Create: `api/src/infra/database/migrations/1792930000000-CreatePlatformAdminAuditEvents.ts` (+ spec), `api/src/modules/platform-admin/infra/platform-admin-audit.orm-entity.ts`, `platform-admin-audit.repository.ts`, `platform-admin-audit.repository.spec.ts`, `platform-admin-audit.repository.postgres.integration.spec.ts`

**Interfaces:**
- Produces: tabela `platform_admin_audit_events(id uuid pk, actor_user_id uuid not null, actor_email text not null, action varchar(40) not null, target_tenant_id uuid, target_user_id uuid, reason text, payload jsonb not null default '{}', success boolean not null, idempotency_key varchar(200), ip_hash varchar(64), created_at timestamptz not null default now())`, **sem FK e sem RLS**; índice único parcial `uq_platform_admin_audit_grant_key ON (idempotency_key) WHERE action = 'credit_grant' AND success`; índice `idx_platform_admin_audit_created (created_at DESC, id DESC)`.
- Produces: `type PlatformAuditAction = 'credit_grant' | 'user_viewed'`; `interface PlatformAuditInput { actorUserId: string; actorEmail: string; action: PlatformAuditAction; targetTenantId?: string | null; targetUserId?: string | null; reason?: string | null; payload?: Record<string, unknown>; success: boolean; idempotencyKey?: string | null; ipHash?: string | null }`; `class PlatformAdminAuditRepository { insert(input: PlatformAuditInput): Promise<PlatformAuditEvent>; findSuccessfulGrantByKey(key: string): Promise<PlatformAuditEvent | null>; listPage(options: CursorQuery): Promise<CursorPage<PlatformAuditEvent>> }`; `hashIp(ip: string | undefined): string | null` (sha256 hex). `PlatformAuditEvent` é o tipo do contrato, mais `actorUserId`/`idempotencyKey`.

`insert` usa `TypeOrmRepositoryHelper.manager()` e portanto **entra na transação aberta** (`TypeOrmTransactionContext`), requisito da 5.8.3. `listPage` usa `queryCursorPage` (`shared/http/keyset-pagination.ts`) sobre a entidade, mais recente primeiro.

- [ ] **Step 1: testes que falham**

```ts
it('migração cria a tabela sem RLS e com o índice único parcial', ...);   // regex nos SQL: UNIQUE INDEX ... WHERE action = 'credit_grant' AND success ; nenhum ENABLE ROW LEVEL SECURITY
it('insert usa o manager da transação ambiente', async () => { await txContext.run(fakeManager, () => repo.insert(input)); expect(fakeManager.getRepository).toHaveBeenCalled(); });
it('hashIp é estável e nulo sem IP', () => { expect(hashIp('1.2.3.4')).toMatch(/^[0-9a-f]{64}$/); expect(hashIp(undefined)).toBeNull(); });
// integração
it('a mesma chave com sucesso duas vezes viola o índice único (23505)', ...);
it('linhas de falha com a mesma chave são permitidas', ...);
it('rollback da transação externa remove a linha de sucesso', ...);
it('listPage devolve a mais recente primeiro e continua pelo cursor', ...);
```

- [ ] **Step 2:** `cd api && yarn jest src/infra/database/migrations/1792930000000-CreatePlatformAdminAuditEvents.spec.ts src/modules/platform-admin/infra/platform-admin-audit.repository.spec.ts` — esperado FAIL.
- [ ] **Step 3:** implementar migração, entidade (`@Entity('platform_admin_audit_events')`) e repositório conforme as assinaturas.
- [ ] **Step 4:** Step 2 PASS; integração com banco PASS; `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(admin): tabela e repositório de auditoria das ações do admin"`

---

### Tarefa 5: Receita de assinatura Stripe gravada em `payment_intents`

**Onda 1.**

**Files:**
- Modify: `api/src/modules/billing/domain/billing-provider.port.ts` (`ProviderEvent`), `api/src/infra/external/stripe/stripe-billing.adapter.ts` (`verifyEvent`) + `stripe-billing.adapter.spec.ts`, `api/src/modules/billing/application/stripe-payments.service.ts` + `stripe-payments.service.spec.ts`, `api/src/modules/billing/application/billing.service.ts` + `billing.service.webhook.spec.ts`

**Interfaces:**
- Produces: `ProviderEvent.invoice?: { id: string; amountCents: number; paidAt: Date } | null` (preenchido só em `invoice.paid` com assinatura e `amount_paid > 0`, `paidAt` de `status_transitions.paid_at`); `StripePaymentsService.recordSubscriptionInvoice(tenantId: string, planSlug: string, invoice: { id: string; amountCents: number; paidAt: Date }): Promise<void>` insere `{ kind:'plan', cycle:'monthly', provider:'stripe', providerRef: invoice.id, status:'paid', idempotencyKey:null, checkout:null, units:null, planSlug }` e ignora duplicata (`23505`).

Efeito colateral aceito: essas linhas aparecem no histórico de pagamentos do cliente (`PaymentHistoryService.listPaid`), o que é correto.

- [ ] **Step 1: testes que falham**

```ts
// adapter
it('invoice.paid com assinatura expõe id, valor e data', ...);
it('invoice.paid de valor zero ou sem assinatura não expõe invoice', ...);
// billing.service.webhook.spec.ts
it('invoice.paid grava a cobrança uma vez, com o plano atual do tenant', async () => { await service.webhook(body, sig); expect(payments.recordSubscriptionInvoice).toHaveBeenCalledWith('t1', 'solo', { id: 'in_1', amountCents: 4900, paidAt }); });
it('evento repetido (eventSeen) não grava de novo', ...);
it('invoice.payment_failed e subscription.updated não gravam', ...);
// stripe-payments.service.spec.ts
it('insere linha paid stripe/plan/monthly com providerRef = invoice.id', ...);
it('duplicata (23505) é ignorada', ...);
```

- [ ] **Step 2:** `cd api && yarn jest src/infra/external/stripe/stripe-billing.adapter.spec.ts src/modules/billing/application/billing.service.webhook.spec.ts src/modules/billing/application/stripe-payments.service.spec.ts` — esperado FAIL.
- [ ] **Step 3:** em `BillingService.webhook`, no ramo de assinatura, depois de `applySubscription`: `if (event.type === 'invoice.paid' && event.invoice) await this.payments?.recordSubscriptionInvoice(tenantId, (await this.repository.current(tenantId)).plan.slug, event.invoice)`. Dentro do `withLock` existente, antes de `recordEvent`.
- [ ] **Step 4:** Step 2 PASS; `yarn jest src/modules/billing` inteiro PASS; `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(billing): grava em payment_intents as cobranças de assinatura Stripe"`

---

### Tarefa 6: Web — proxy, cliente da API e flag na sessão

**Onda 1.**

**Files:**
- Modify: `web/app/api/proxy/[...path]/route.ts` (`routes[]`), `web/lib/api.ts` (`SessionPayload.isPlatformAdmin?: boolean`), `web/lib/auth.tsx` (`AuthContextType.isPlatformAdmin: boolean`)
- Create: `web/lib/platform-admin.ts`, `web/tests/platform-admin-proxy.test.ts`, `web/tests/platform-admin-client.test.ts`

**Interfaces:**
- Produces (em `web/lib/platform-admin.ts`): os tipos do Contrato HTTP; `platformAdmin = { overview(signal?): Promise<PlatformOverview>; users(params: { search?: string; limit?: number; cursor?: string }, signal?): Promise<Page<PlatformUserRow>>; user(id: string, signal?): Promise<PlatformUserDetail>; attention(signal?): Promise<PlatformAttention>; audit(params: PageParams, signal?): Promise<Page<PlatformAuditEvent>>; grantCredits(tenantId: string, body: { amount: number; reason: string; notifyUser: boolean }, idempotencyKey: string): Promise<CreditGrantResult> }`; `formatBrl(cents: number, locale: string): string`. Usa `request`, `unwrap`, `toPage` de `lib/api.ts`; `grantCredits` manda o cabeçalho `idempotency-key` (o proxy já o repassa).
- Produces: `useAuth().isPlatformAdmin`, e a flag sobrevive a `switchTenant` (o `apply` substitui a sessão inteira).

Rotas a acrescentar em `routes[]`: `^platform\/overview$` GET; `^platform\/users$` GET; `^platform\/users\/[^/]+$` GET; `^platform\/attention$` GET; `^platform\/audit$` GET; `^platform\/tenants\/[^/]+\/credit-grants$` POST.

- [ ] **Step 1: testes que falham**

```ts
// platform-admin-proxy.test.ts (mesmo padrão de proxy.test.ts)
it('repassa exatamente as seis rotas do admin com seus métodos', ...);
it.each([['platform/users','POST'],['platform/users/x','DELETE'],['platform/tenants/x/credit-grants','GET'],['platform/tenants/x/credit-grants/y','POST'],['platform/anything','GET']])('%s %s dá 404', ...);
it('repassa o idempotency-key da concessão', ...);
// platform-admin-client.test.ts
it('grantCredits envia POST com idempotency-key e tenantId codificado', ...);
it('users monta search e limit na query', ...);
it('formatBrl(1990, "pt") contém "19,90"', () => expect(formatBrl(1990, 'pt')).toContain('19,90'));
// auth: AuthProvider expõe isPlatformAdmin da sessão e o mantém após switchTenant
```

- [ ] **Step 2:** `cd web && yarn vitest run tests/platform-admin-proxy.test.ts tests/platform-admin-client.test.ts` — esperado FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** Step 2 PASS; `yarn vitest run tests/proxy.test.ts tests/auth.test.tsx` PASS; `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(web): rotas do proxy e cliente da API do admin"`

---

### Tarefa 7: Web — mensagens (pt/en)

**Onda 1.**

**Files:** Modify `web/messages/pt.json`, `web/messages/en.json`; Create `web/tests/admin-messages.test.ts`.

**Interfaces:**
- Produces: `ApiErrors.idempotency_key_reused`; `Sidebar.nav.admin`; namespace `Admin` com os grupos abaixo (as páginas das Tarefas 9, 10 e 16–19 só **leem** estas chaves; precisando de outra, acrescentar aqui).
  - `Admin.nav`, `Admin.common` (`loadFailed`, `loadMore`, `empty`, `openUser`, `notFound`, `yes`, `no`).
  - `Admin.overview`: `title`, `users`, `usersTotal`, `usersNew7d`, `usersNew30d`, `invoicesLive`, `invoicesTest`, `authorized`, `rejected`, `rejectionRate`, `today`, `last7d`, `last30d`, `revenue`, `revenueSubscription`, `revenueAvulso`, `revenueTotal`, `revenueNote` (`{date}`), `revenueNoteNone`, `adminGrants`, `adminGrantsNote` ("não contam como receita").
  - `Admin.users`: `title`, `searchPlaceholder`, `columns.{email,name,signedUpAt,plan,invoicesMonth,avulsoBalance,companies,lastActivity}`.
  - `Admin.detail`: `title`, `account`, `emailVerified`, `lastLogin`, `workspaces`, `role`, `own`, `plan`, `usage`, `balance`, `companies`, `certificateValidUntil`, `recentInvoices`, `credits`, `payments`, `apiKeys`, `mcpConnections`, `lastUsed`, `grantButton`.
  - `Admin.grant`: `title`, `amount`, `reason`, `confirm` (`{amount}`, `{email}`), `submit`, `success`, `successReplayed`, `notify`, `cancel`.
  - `Admin.attention`: `title`, `staleInvoices`, `expiringCertificates`, `failingWebhooks`, `failedPayments`, `emptySection`.
  - `Admin.audit`: `title`, `columns.{when,actor,action,target,reason,result}`, `actions.{credit_grant,user_viewed}`, `success`, `failure`.

- [ ] **Step 1: teste que falha** (`admin-messages.test.ts`): `Admin` e `Sidebar.nav.admin` existem nos dois idiomas com as mesmas chaves e nenhuma folha vazia; mesmos placeholders (`{amount}`, `{email}`, `{date}`) em pt e en; `ApiErrors.idempotency_key_reused` existe em ambos.
- [ ] **Step 2:** `cd web && yarn vitest run tests/admin-messages.test.ts` — esperado FAIL.
- [ ] **Step 3:** escrever os textos (pt-BR no estilo do painel, sem jargão; ex.: `adminGrantsNote`: "Notas dadas pelo admin. Não contam como receita.").
- [ ] **Step 4:** Step 2 PASS; `yarn vitest run tests/api-error-codes.test.ts tests/site-consistency.test.ts` PASS.
- [ ] **Step 5:** `git commit -m "feat(web): textos do admin da plataforma em pt e en"`

---

### Tarefa 8: `PlatformAdminGuard`, decorator e módulo núcleo

**Onda 2.** Depende de T1, T3, T4.

**Files:**
- Create: `api/src/modules/auth/platform-admin-only.decorator.ts`, `api/src/modules/platform-admin/platform-admin.guard.ts` (+ `.spec.ts`), `platform-admin.contract.ts`, `platform-admin-core.module.ts`
- Modify: `api/src/modules/auth/api-key.guard.ts` (+ `api-key.guard.spec.ts`), `api/src/modules/auth/tenant-context.guard.spec.ts` (só teste de regressão)

**Interfaces:**
- Consumes: `PlatformAdminPolicy.resolve` (T1), `PlatformReadSession` (T3), `PlatformAdminAuditRepository`, `hashIp` (T4).
- Produces: `PLATFORM_ADMIN_ONLY` e `PlatformAdminOnly(): MethodDecorator & ClassDecorator` (só metadado, em `modules/auth`); `type PlatformAdminActor = { authUserId: string; email: string; ipHash: string | null }`; `type RequestWithPlatformAdmin = RequestWithAuthContext & { platformAdmin?: PlatformAdminActor }`; `@Injectable() class PlatformAdminGuard implements CanActivate`; `PlatformAdminRoute(): ClassDecorator` = `applyDecorators(PlatformAdminOnly(), UseGuards(PlatformAdminGuard), ApiExcludeController())` (fora do OpenAPI público); `PlatformAdminCoreModule` (importa `AuthModule`; provê e exporta `PlatformAdminGuard`, `PlatformReadSession`, `PlatformAdminAuditRepository`, `AuthModule`); os tipos do Contrato HTTP.

Achado: o `ApiKeyGuard` global roda **antes** do guard do controller e hoje responde 403 `API_KEY_NOT_ALLOWED` a chave de API em rota sem `@ApiKeyEndpoint`. Para cumprir "404 para chave de API", ele passa a responder 404 `RESOURCE_NOT_FOUND` quando a rota tem `PLATFORM_ADMIN_ONLY`. MCP usa bearer próprio e não passa no `CookieAuthGuard` (401 em qualquer rota). A barreira real continua sendo o guard; `isPlatformRoute` do `TenantContextGuard` só deixa o `:tenantId` passar.

- [ ] **Step 1: testes que falham**

```ts
it('404 RESOURCE_NOT_FOUND para sessão que não é admin', ...);
it('404 para principal api_key mesmo com o dono na lista', ...);   // authMode 'api_key'
it('404 quando o contexto traz mcpConnectionId', ...);
it('404 sem authContext', ...);
it('libera admin e preenche request.platformAdmin { authUserId, email, ipHash }', ...);
it('pergunta à política a cada requisição (2 requests = 2 resolve)', ...);
it('registra Logger.warn com o usuário e a rota ao recusar', ...);
// api-key.guard.spec.ts
it('chave de API em rota PlatformAdminOnly recebe 404, não 403', ...);
it('chave de API em rota comum sem @ApiKeyEndpoint segue com 403 API_KEY_NOT_ALLOWED', ...);
// tenant-context.guard.spec.ts
it('deixa passar /v1/platform/tenants/:tenantId (a barreira é o PlatformAdminGuard)', ...);
```

- [ ] **Step 2:** `cd api && yarn jest src/modules/platform-admin/platform-admin.guard.spec.ts src/modules/auth/api-key.guard.spec.ts src/modules/auth/tenant-context.guard.spec.ts` — esperado FAIL.
- [ ] **Step 3:** implementar; o guard exige `authMode === 'cookie'`, `principalType === 'tenant_member'` e ausência de `mcpConnectionId`, depois `policy.resolve(authUserId)`; recusa lança `NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Resource not found' })`. `ipHash = hashIp(resolveClientIp(request))` (`shared/http/client-ip.ts`).
- [ ] **Step 4:** Step 2 PASS; `yarn jest src/modules/auth` PASS; `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(admin): guard 404 para não admin, chave de API e MCP"`

---

### Tarefa 9: Web — gate no servidor e menu "Admin"

**Onda 2.** Depende de T6, T7.

**Files:**
- Create: `web/lib/platform-admin-server.ts`, `web/app/(dashboard)/app/admin/layout.tsx` (servidor), `web/tests/admin-gate.test.tsx`
- Modify: `web/components/dashboard/sidebar.tsx`, `web/app/(dashboard)/app/layout.tsx` (títulos `pathToPage` para `/app/admin`, `/app/admin/users`, `/app/admin/attention`, `/app/admin/audit`)

**Interfaces:**
- Produces: `isPlatformAdminOnServer(): Promise<boolean>` — lê os cookies `gf_session_dev` e `__Host-gf_session` (mesmos nomes do proxy), chama `${API_BASE_URL}/v1/auth/session` e devolve `data.isPlatformAdmin === true`; qualquer falha (sem cookie, rede, 401, corpo estranho) devolve `false`. O layout chama `notFound()` quando `false`. Menu: item "Admin" (`/app/admin`, ícone `ShieldCheck`) só com `useAuth().isPlatformAdmin`.

- [ ] **Step 1: testes que falham**

```ts
it('true só quando a sessão diz isPlatformAdmin === true', ...);
it.each(['sem cookie (e não chama fetch)', '401', 'erro de rede', 'corpo sem a flag', 'isPlatformAdmin: "true"'])('%s => false', ...);
it('encaminha só os cookies de sessão', ...);
it('o layout de /app/admin chama notFound() para não admin e renderiza os filhos para admin', ...);
it('Sidebar mostra o link /app/admin só quando isPlatformAdmin', ...);   // padrão de dashboard-access.test.tsx
it('menu comum de membro não ganha nenhum link novo', ...);
```

- [ ] **Step 2:** `cd web && yarn vitest run tests/admin-gate.test.tsx` — esperado FAIL.
- [ ] **Step 3:** implementar. O guard de permissões por rota (`route-permissions.ts`) **não** muda: o gate é a flag, não uma permissão de tenant.
- [ ] **Step 4:** Step 2 PASS; `yarn vitest run tests/dashboard-access.test.tsx tests/route-permissions.test.ts` PASS; `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(web): gate de admin no servidor e item no menu"`

---

### Tarefa 10: Web — botão e modal "Dar notas avulsas"

**Onda 2.** Depende de T6, T7.

**Files:** Create `web/components/admin/grant-credits-button.tsx`, `web/tests/admin-grant-credits.test.tsx`.

**Interfaces:**
- Consumes: `platformAdmin.grantCredits`, `useApiErrorText`, chaves `Admin.grant.*`, `Modal`, `Field`, `Button`.
- Produces: `GrantCreditsButton({ tenantId, email, onGranted }: { tenantId: string; email: string; onGranted: () => void })`. Gera `crypto.randomUUID()` **a cada abertura** do modal e reaproveita a mesma chave em reenvios enquanto o modal fica aberto; confirmação "Dar {amount} notas para {email}?" antes do envio; esconde-se (retorna `null`) quando `useBillingEnabled()` é falso.

- [ ] **Step 1: testes que falham**

```ts
it('não renderiza no self-hosted (billingEnabled false)', ...);
it('valida quantidade 1–500 e motivo 5–500 antes de enviar', ...);
it('mostra a confirmação com quantidade e e-mail e só então chama a API', ...);
it('reenviar após erro de rede usa a mesma Idempotency-Key; reabrir o modal gera outra', ...);
it('409 IDEMPOTENCY_KEY_REUSED mostra o texto traduzido', ...);
it('notifyUser começa desmarcado e é enviado como false', ...);
it('replayed: true mostra a mensagem de repetição e chama onGranted', ...);
```

- [ ] **Step 2:** `cd web && yarn vitest run tests/admin-grant-credits.test.tsx` — esperado FAIL.
- [ ] **Step 3:** implementar o componente.
- [ ] **Step 4:** Step 2 PASS; `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(web): modal para dar notas avulsas"`

---

### Tarefa 11: API — visão geral

**Onda 3.** Depende de T3, T8.

**Files:**
- Create: `api/src/infra/database/migrations/1792940000000-AddInvoiceEnvStatusCreatedIndex.ts` (`CREATE INDEX IF NOT EXISTS idx_nfse_invoices_env_status_created ON nfse_invoices (environment, status, created_at)`; mantê-lo só se o `EXPLAIN` do teste de integração o usar), `api/src/modules/platform-admin/infra/read/platform-overview.read-repository.ts` (+ `.spec.ts`, `.postgres.integration.spec.ts`), `api/src/modules/platform-admin/http/platform-overview.controller.ts` (+ spec), `platform-overview.module.ts`

**Interfaces:**
- Consumes: `PlatformReadSession`, `PlatformAdminRoute`, `PlatformOverview` (contrato).
- Produces: `PlatformOverviewReadRepository.snapshot(now: Date): Promise<PlatformOverview>`; `rejectionRate(authorized: number, rejected: number): number | null` (`rejected / (authorized + rejected)`, `null` se o denominador é 0); `saoPauloDayStart(now: Date): Date`; `GET /v1/platform/overview` sob `@PlatformAdminRoute()`.

Regras: autorizadas por `authorized_at`, rejeitadas (`status='rejected'`) por `updated_at`; receita = `payment_intents` com `status='paid'` por `paid_at`, separada por `kind` (`plan` = assinatura, `avulso`); `stripeRecordedSince = MIN(paid_at)` das linhas `provider='stripe' AND kind='plan' AND cycle='monthly' AND idempotency_key IS NULL`; `adminGrants` = soma de `payload->>'amount'` em `platform_admin_audit_events` (`action='credit_grant' AND success`). Nada de `credit_transactions` na receita.

- [ ] **Step 1: testes que falham**

```ts
it('rejectionRate', () => { expect(rejectionRate(9, 1)).toBe(0.1); expect(rejectionRate(0, 0)).toBeNull(); });
it('saoPauloDayStart: 02:30Z ainda é o dia anterior em BRT', () => { expect(saoPauloDayStart(new Date('2026-11-23T02:30:00Z')).toISOString()).toBe('2026-11-22T03:00:00.000Z'); expect(saoPauloDayStart(new Date('2026-11-23T03:00:00Z')).toISOString()).toBe('2026-11-23T03:00:00.000Z'); });
it('o controller devolve { data: snapshot } e tem PLATFORM_ADMIN_ONLY', ...);
// integração (dados de dois tenants)
it('nota autorizada às 23:30 BRT de ontem não conta em "hoje" mas conta em 7d', ...);
it('teste e produção são contados em separado', ...);
it('receita soma só paid: ignora a linha de contrato Woovi authorized e as mismatch', ...);
it('bônus do admin (credit_transactions bonus) não muda a receita e entra em adminGrants', ...);
it('assinatura e avulso saem separados, e stripeRecordedSince é a menor paid_at da Stripe', ...);
```

- [ ] **Step 2:** `cd api && yarn jest src/modules/platform-admin/infra/read/platform-overview.read-repository.spec.ts src/modules/platform-admin/http/platform-overview.controller.spec.ts` — esperado FAIL.
- [ ] **Step 3:** implementar (SQL agregado em poucas consultas dentro de um único `session.run`); módulo `PlatformOverviewModule` importa `PlatformAdminCoreModule`.
- [ ] **Step 4:** Step 2 PASS; integração com banco PASS (conferir o plano do índice com `EXPLAIN` no próprio spec: asserção só de que a consulta de 30 dias roda em < 1 s com 50 mil notas semeadas); `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(admin): visão geral da plataforma na API"`

---

### Tarefa 12: API — lista de usuários

**Onda 3.** Depende de T3, T8.

**Files:** Create `api/src/modules/platform-admin/infra/read/platform-users.read-repository.ts` (+ `.spec.ts`, `.postgres.integration.spec.ts`), `.../http/platform-users.controller.ts` (+ spec), `platform-users-query.dto.ts` (+ spec), `platform-users.module.ts`.

**Interfaces:**
- Produces: `PlatformUsersReadRepository.list(query: { search?: string; limit: number; cursor?: string }): Promise<CursorPage<PlatformUserRow>>`; `escapeLike(term: string): string`; `searchDigits(term: string): string`; `PlatformUsersQuery extends CursorQuery { search?: string }` (trim, `@MaxLength(100)`); `GET /v1/platform/users`.

Regras: ordem `created_at DESC, id DESC` com cursor (`encodeCursor`/`readKeysetCursor`, escopo `['platform-users', search]`); `limit` efetivo = `min(limit ?? 50, 50)`; busca por e-mail e nome com `ILIKE '%'||escapeLike(term)||'%' ESCAPE '\'` e por CNPJ comparando `regexp_replace(tax_id,'\D','','g') LIKE digits||'%'` quando há ≥ 4 dígitos; colunas derivadas calculadas **só para os ids da página** (segunda consulta com `= ANY($1::uuid[])` e subconsultas `LATERAL ... LIMIT 1`); `lastActivityAt` = maior entre última nota, `api_keys.last_used_at`, `mcp_connections.last_used_at` e `auth_users.last_login_at`.

- [ ] **Step 1: testes que falham**

```ts
it('escapeLike escapa % _ e \\', () => expect(escapeLike('50%_a\\')).toBe('50\\%\\_a\\\\'));
it('searchDigits tira a máscara do CNPJ', () => expect(searchDigits('12.345.678/0001-95')).toBe('12345678000195'));
it('dto rejeita search com 101 caracteres e aparou espaços', ...);
it('limit 1000 vira 50 na consulta', ...);
it('cursor inválido responde 400 ERROR_INVALID_CURSOR', ...);
// integração
it('buscar "%" não devolve todo mundo', ...);
it('buscar o CNPJ com máscara acha a empresa; buscar por parte do e-mail e do nome acha o usuário', ...);
it('paginação por cursor não repete nem perde usuários com o mesmo created_at', ...);
it('lastActivityAt escolhe o maior entre nota, chave, MCP e login', ...);
```

- [ ] **Step 2:** `cd api && yarn jest src/modules/platform-admin/infra/read/platform-users.read-repository.spec.ts src/modules/platform-admin/http/platform-users-query.dto.spec.ts` — esperado FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** Step 2 PASS; integração PASS; `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(admin): lista de usuários com busca na API"`

---

### Tarefa 13: API — detalhe do usuário (com `user_viewed`)

**Onda 3.** Depende de T3, T4, T8.

**Files:** Create `api/src/modules/platform-admin/infra/read/platform-user-detail.read-repository.ts` (+ spec e `.postgres.integration.spec.ts`), `.../application/platform-user-detail.service.ts` (+ spec), `.../http/platform-user-detail.controller.ts` (+ spec), `platform-user-detail.module.ts`.

**Interfaces:**
- Consumes: `PlatformAdminAuditRepository.insert`, `PlatformAdminActor`.
- Produces: `PlatformUserDetailReadRepository.find(userId: string): Promise<PlatformUserDetail | null>`; `PlatformUserDetailService.view(actor: PlatformAdminActor, userId: string): Promise<PlatformUserDetail>`; `GET /v1/platform/users/:id` (`ParseUUIDPipe({ errorHttpStatusCode: 404 })`). Por workspace, as listas têm limite 20; seleção de colunas explícita (nunca `*`).

- [ ] **Step 1: testes que falham**

```ts
it('view grava user_viewed ANTES de devolver os dados', ...);   // ordem das chamadas: find, audit.insert, retorno
it('se a auditoria falha, o erro sobe e nada é devolvido (fail-closed)', ...);
it('usuário inexistente: 404 RESOURCE_NOT_FOUND e nenhum user_viewed', ...);
it('id que não é UUID responde 404', ...);
it('cada carregamento grava um registro (2 views = 2 inserts)', ...);
// integração
it('o JSON do detalhe não contém key_hash, checkout, encrypted_ nem a chave inteira (só keyPrefix)', ...);
it('convidado aparece com o papel em cada workspace e isOwn só no próprio', ...);
it('certificateValidUntil vem da validade do certificado ativo e é null sem certificado', ...);
```

- [ ] **Step 2:** `cd api && yarn jest src/modules/platform-admin/application/platform-user-detail.service.spec.ts src/modules/platform-admin/http/platform-user-detail.controller.spec.ts` — esperado FAIL.
- [ ] **Step 3:** implementar; `user_viewed` com `targetUserId`, `success: true`, `ipHash` do ator.
- [ ] **Step 4:** Step 2 PASS; integração PASS; `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(admin): detalhe do usuário com registro de visualização"`

---

### Tarefa 14: API — atenção e histórico

**Onda 3.** Depende de T3, T4, T8.

**Files:** Create `api/src/modules/platform-admin/infra/read/platform-attention.read-repository.ts` (+ spec, `.postgres.integration.spec.ts`), `.../http/platform-attention.controller.ts`, `platform-audit.controller.ts` (+ specs), `platform-attention.module.ts`, `platform-audit.module.ts`.

**Interfaces:**
- Produces: `PlatformAttentionReadRepository.snapshot(now: Date): Promise<PlatformAttention>`; constantes exportadas `STALE_INVOICE_MINUTES = 60`, `CERTIFICATE_DAYS = 15`, `WEBHOOK_WINDOW_HOURS = 24`; `GET /v1/platform/attention`; `GET /v1/platform/audit` (usa `PlatformAdminAuditRepository.listPage`, mapeia para `PlatformAuditEvent` do contrato).

Regras: notas em `manual_review`, `reconciliation_required` ou `retry_pending` com `updated_at` há mais de 60 min; certificados `status='active'`, `deleted_at IS NULL`, `valid_until < now + 15 dias` (já vencidos entram); `webhook_deliveries.status='failed'` nas últimas 24 h agrupados por tenant; pagamentos falhados = `payment_intents` `rejected`/`mismatch` nos últimos 30 dias (`source:'intent'`) mais `tenant_billing.stripe_status IN ('past_due','unpaid')` (`source:'subscription'`). `userId` = admin mais antigo do tenant (`tenant_memberships.role='admin'`), senão o `tenantId`.

- [ ] **Step 1: testes que falham**

```ts
it('constantes batem com a spec', () => expect([STALE_INVOICE_MINUTES, CERTIFICATE_DAYS, WEBHOOK_WINDOW_HOURS]).toEqual([60, 15, 24]));
it('audit controller mapeia as linhas e devolve a página com cursor', ...);
// integração
it('nota retry_pending há 61 min entra; há 59 min e processing não entram', ...);
it('certificado a 14 dias e o já vencido entram; a 16 dias não', ...);
it('webhook falho há 23 h entra; há 25 h não; contagem por tenant', ...);
it('payment rejected/mismatch e past_due entram; paid e expired não', ...);
it('cada item traz userId do admin mais antigo do tenant', ...);
```

- [ ] **Step 2:** `cd api && yarn jest src/modules/platform-admin/infra/read/platform-attention.read-repository.spec.ts src/modules/platform-admin/http/platform-audit.controller.spec.ts` — esperado FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** Step 2 PASS; integração PASS; `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(admin): lista de atenção e histórico do admin na API"`

---

### Tarefa 15: API — dar notas avulsas

**Onda 3.** Depende de T3, T4, T8.

**Files:**
- Modify: `api/src/modules/credits/application/credits.service.ts` (+ `credits.service.spec.ts`)
- Create: `api/src/modules/platform-admin/application/platform-credit-grant.service.ts` (+ spec), `.../http/platform-credit-grant.controller.ts` (+ spec), `platform-credit-grant.dto.ts` (+ spec), `platform-credit-grant.module.ts` (+ spec do self-hosted), `platform-credit-grant.postgres.integration.spec.ts`

**Interfaces:**
- Consumes: `runAsPlatformAdminOnTenant` (T3), `PlatformAdminAuditRepository.insert/findSuccessfulGrantByKey` (T4), `PlatformAdminActor` (T8), `TypeOrmTenantRepository.findById` (exportado em T1), `UnitOfWorkPort.execute`, `ApplicationEventBus.publishBestEffort`, `accountNotice(tenantId, { kind: 'credits-added', units })`.
- Produces: `CreditsService.grantBonus(tenantId: string, amount: number, description: string, metadata?: Record<string, unknown>)` (grava `metadata`); `CreditsService.invalidateBalance(tenantId: string): Promise<void>`; `PlatformCreditGrantService.grant(actor: PlatformAdminActor, tenantId: string, input: { amount: number; reason: string; notifyUser: boolean }, idempotencyKey: string): Promise<CreditGrantResult>`; `PlatformCreditGrantDto { amount; reason; notifyUser = false }`; `POST /v1/platform/tenants/:tenantId/credit-grants` (`@HttpCode(200)`, `Idempotency-Key` obrigatório); controller registrado só quando `!IS_SELF_HOSTED`; código novo `IDEMPOTENCY_KEY_REUSED` (409).

Fluxo de `grant`: valida a chave; tenant inexistente (`findById`) → 404 (e grava linha de falha); `runAsPlatformAdminOnTenant(tenantId, () => uow.execute(async () => { prior = findSuccessfulGrantByKey; se existe: mesmos `amount`, `reason` e `targetTenantId` → devolve o original com `replayed:true`, senão 409; `grantBonus(tenantId, amount, 'Notas cedidas pela Corvo', { origin: 'platform_admin', idempotencyKey })`; `audit.insert({ action:'credit_grant', success:true, ... payload:{ amount, balanceAfter } })` }))`. `23505` no insert da auditoria (corrida) → a transação inteira volta, recarrega pela chave e aplica a mesma comparação. Em qualquer falha: `audit.insert({ success:false, payload:{ error: code } })` **fora** da transação (se falhar, `Logger.error`). Sempre, ao final, `credits.invalidateBalance(tenantId)`. `notifyUser` publica `credits-added` só depois do commit e nunca em repetição. Achado: `CreditTransaction.toJSON()` inclui `metadata`, e `GET /credits/history` devolve isso ao cliente; por isso motivo e ator ficam **só** na auditoria.

- [ ] **Step 1: testes que falham**

```ts
// credits.service.spec.ts
it('grantBonus grava metadata', ...); it('invalidateBalance apaga a chave do cache', ...);
// platform-credit-grant.service.spec.ts (fakes de uow, audit, credits, bus)
it('audita na mesma transação: audit.insert roda dentro de uow.execute, depois de grantBonus', ...);
it('falha ao auditar desfaz o crédito (fail-closed), grava linha de falha fora da transação e propaga o erro', ...);
it('mesma chave, mesmo valor e motivo: devolve o original, replayed true, sem novo grantBonus', ...);
it.each([['outro valor'], ['outro motivo'], ['outro tenant']])('mesma chave com %s: 409 IDEMPOTENCY_KEY_REUSED', ...);
it('duas chamadas simultâneas com a mesma chave: 23505 vira o resultado da primeira e um só crédito persiste', ...);   // Review Focus 2
it('invalida o cache de saldo também quando a transação falha', ...);   // Review Focus 1
it('o lançamento não carrega motivo nem e-mail do admin; a descrição é genérica', ...);   // Review Focus 3
it('notifyUser publica credits-added só após o commit e não em repetição; padrão não publica', ...);
it('tenant inexistente: 404 RESOURCE_NOT_FOUND com linha de falha na auditoria', ...);
it('chave ausente ou com 201 caracteres: IDEMPOTENCY_KEY_INVALID', ...);
// dto
it.each([0, 501, 1.5, '10'])('amount %p é inválido', ...); it.each(['abcd', 'x'.repeat(501)])('reason inválido', ...);
// módulo
it('sem controller quando DEPLOYMENT_MODE=self_hosted', () => jest.isolateModules(...));
// integração (Postgres)
it('duas requisições paralelas com a mesma chave geram uma linha bonus e uma auditoria de sucesso', ...);
it('GET /credits/history do cliente não contém o motivo nem o e-mail do admin', ...);
it('a concessão não altera a receita do overview', ...);
it('rollback por falha na auditoria deixa saldo e cache iguais ao de antes', ...);
```

- [ ] **Step 2:** `cd api && yarn jest src/modules/credits/application/credits.service.spec.ts src/modules/platform-admin/application/platform-credit-grant.service.spec.ts src/modules/platform-admin/http/platform-credit-grant.dto.spec.ts` — esperado FAIL.
- [ ] **Step 3:** implementar conforme o fluxo; `PlatformCreditGrantModule` importa `PlatformAdminCoreModule`, `CreditsModule`, `ApplicationEventsModule`, `AuthModule`.
- [ ] **Step 4:** Step 2 PASS; integração PASS; `yarn jest src/modules/credits` PASS; `yarn typecheck`.
- [ ] **Step 5:** `git commit -m "feat(admin): concessão de notas avulsas com auditoria e idempotência"`

---

### Tarefa 16: Web — página de visão geral

**Onda 3.** Depende de T6, T7, T9.

**Files:** Create `web/app/(dashboard)/app/admin/page.tsx`, `web/tests/admin-overview.test.tsx`.

**Interfaces:** Consumes `platformAdmin.overview`, `formatBrl`, `useBillingEnabled`, `Card`, `PageHeader`, chaves `Admin.overview.*`.

- [ ] **Step 1: testes que falham:** mostra totais de usuários e as três janelas de produção (autorizadas, rejeitadas, taxa em %); teste em bloco separado; receita em R$ com assinatura/avulso/total e a nota com a data de `stripeRecordedSince` (ou `revenueNoteNone` se `null`); "notas dadas pelo admin" com a observação de que não é receita; com `billingEnabled=false` some a receita e o bloco de notas dadas; erro de API mostra `Admin.common.loadFailed`.
- [ ] **Step 2:** `cd web && yarn vitest run tests/admin-overview.test.tsx` — esperado FAIL.
- [ ] **Step 3:** implementar a página (cliente, `useEffect` com `AbortController` como `customers/page.tsx`).
- [ ] **Step 4:** Step 2 PASS; `yarn typecheck && yarn lint`.
- [ ] **Step 5:** `git commit -m "feat(web): página de visão geral do admin"`

---

### Tarefa 17: Web — página de usuários

**Onda 3.** Depende de T6, T7, T9.

**Files:** Create `web/app/(dashboard)/app/admin/users/page.tsx`, `web/tests/admin-users.test.tsx`.

**Interfaces:** Consumes `platformAdmin.users` (cursor via `Page`), `DataTable`, `useCursorPagination` ou o padrão manual de `customers/page.tsx`, chaves `Admin.users.*`.

- [ ] **Step 1: testes que falham:** tabela com as oito colunas e a linha leva a `/app/admin/users/{id}`; busca só dispara após 300 ms de pausa e manda `search` aparado; "carregar mais" usa o `nextCursor`; estado vazio; no self-hosted somem as colunas plano e saldo avulso.
- [ ] **Step 2:** `cd web && yarn vitest run tests/admin-users.test.tsx` — esperado FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** Step 2 PASS; `yarn typecheck && yarn lint`.
- [ ] **Step 5:** `git commit -m "feat(web): página de usuários do admin"`

---

### Tarefa 18: Web — detalhe do usuário

**Onda 3.** Depende de T6, T7, T9, T10.

**Files:** Create `web/app/(dashboard)/app/admin/users/[id]/page.tsx`, `web/tests/admin-user-detail.test.tsx`.

**Interfaces:** Consumes `platformAdmin.user`, `GrantCreditsButton` (T10), `formatDate`, `formatBrl`, `useInvoiceErrorText` para o código do último erro, chaves `Admin.detail.*`.

- [ ] **Step 1: testes que falham:** mostra conta (e-mail verificado, último login) e um bloco por workspace com papel, plano/uso, saldo, empresas (CNPJ, município, ambiente, validade do certificado), últimas notas com código do erro, créditos, pagamentos, chaves (só prefixo) e conexões MCP; o botão recebe `tenantId` e `email` do workspace próprio e, ao conceder, recarrega o detalhe; 404 da API mostra `Admin.common.notFound`; self-hosted esconde créditos, pagamentos, plano e o botão.
- [ ] **Step 2:** `cd web && yarn vitest run tests/admin-user-detail.test.tsx` — esperado FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** Step 2 PASS; `yarn typecheck && yarn lint`.
- [ ] **Step 5:** `git commit -m "feat(web): detalhe do usuário no admin"`

---

### Tarefa 19: Web — atenção e histórico

**Onda 3.** Depende de T6, T7, T9.

**Files:** Create `web/app/(dashboard)/app/admin/attention/page.tsx`, `web/app/(dashboard)/app/admin/audit/page.tsx`, `web/tests/admin-attention-audit.test.tsx`.

**Interfaces:** Consumes `platformAdmin.attention`, `platformAdmin.audit`, chaves `Admin.attention.*` e `Admin.audit.*`.

- [ ] **Step 1: testes que falham:** cada uma das quatro listas de atenção renderiza seus itens com link para `/app/admin/users/{userId}` e mostra `emptySection` quando vazia; no self-hosted a lista de pagamentos falhados some; o histórico mostra, mais recente primeiro, quem fez, a ação traduzida (`credit_grant`, `user_viewed`), o alvo, o motivo e o resultado (sucesso/falha) e carrega mais pelo cursor.
- [ ] **Step 2:** `cd web && yarn vitest run tests/admin-attention-audit.test.tsx` — esperado FAIL.
- [ ] **Step 3:** implementar as duas páginas.
- [ ] **Step 4:** Step 2 PASS; `yarn typecheck && yarn lint`.
- [ ] **Step 5:** `git commit -m "feat(web): páginas de atenção e histórico do admin"`

---

### Tarefa 20: Fiação e invariantes

**Onda 4.** Depende de todas.

**Files:**
- Create: `api/src/modules/platform-admin/platform-admin.module.ts`, `platform-admin.module.spec.ts`, `platform-admin.invariants.spec.ts`
- Modify: `api/src/app.module.ts` (importar `PlatformAdminModule`; só API, não o worker)

**Interfaces:** Consumes todos os módulos de feature (`PlatformOverviewModule`, `PlatformUsersModule`, `PlatformUserDetailModule`, `PlatformAttentionModule`, `PlatformAuditModule`, `PlatformCreditGrantModule`). Produces `PlatformAdminModule` que os importa.

- [ ] **Step 1: testes que falham**

```ts
// platform-admin.module.spec.ts
it('o AppModule importa PlatformAdminModule', ...);
it('todo controller do módulo tem PLATFORM_ADMIN_ONLY e PlatformAdminGuard em __guards__', ...);
it('no self-hosted só a concessão some: os demais controllers continuam', ...);
// platform-admin.invariants.spec.ts (varre os arquivos fonte)
it('nada em platform-admin/infra/read tem INSERT/UPDATE/DELETE/TRUNCATE/ALTER/DROP/CREATE', ...);
it('nada ali seleciona key_hash, encrypted_, checkout nem usa SELECT *', ...);
it('as classes de leitura só expõem list/find/snapshot', ...);
it('só o módulo de concessão usa runAsPlatformAdminOnTenant ou o CreditsService', ...);
```

- [ ] **Step 2:** `cd api && yarn jest src/modules/platform-admin/platform-admin.module.spec.ts src/modules/platform-admin/platform-admin.invariants.spec.ts` — esperado FAIL.
- [ ] **Step 3:** criar o módulo e registrá-lo no `AppModule`.
- [ ] **Step 4:** verificação final: `cd api && yarn jest && yarn typecheck && yarn typecheck:tests && yarn lint:check`; com banco: `MIGRATION_TEST_DATABASE_URL=... yarn jest --testPathPatterns postgres.integration platform-admin`; `cd web && yarn vitest run && yarn typecheck && yarn lint`. Esperado: tudo verde, nenhum `*.postgres.integration.spec.ts` pulado.
- [ ] **Step 5:** `git commit -m "feat(admin): registra o módulo do admin da plataforma e testes de invariantes"`

---

## Autorrevisão

- **Cobertura da spec:** 5.1 → T1 (política, sessão, e-mail verificado) · 5.2 → T8 · 5.3 → T3 e invariantes T20 · 5.4 → T9, T16–19 · 5.5 → T10, T15 · 5.6 → T4, T13, T15 · 5.7 → T2 · 5.8.1–8 → T1/T8, T3, T15, T1 (evidência), T4/T15, T5 + decisão acima, T12, T13 · docs e env → T1 · proxy → T6 · self-hosted → T10, T15, T16–19, T20.
- **Tipos:** `PlatformAdminActor`, `PlatformAdminPolicy.resolve`, `PlatformReadSession.run`, `PlatformAdminAuditRepository.{insert,findSuccessfulGrantByKey,listPage}`, `CreditGrantResult` e `platformAdmin.*` têm uma única definição e os mesmos nomes onde são consumidos.
- **Proporção:** só assinaturas, nomes de teste e asserções-chave; SQL e corpos ficam com o implementador.

## O que a spec tinha de errado ou impossível (decisões tomadas acima)

1. `markLogin` não roda em login algum (listener morto): T2 liga a `completeLogin`.
2. Renovações **e primeiras cobranças** Stripe não estão em `payment_intents` (só `webhook_events` sem valor): T5 passa a gravar; a spec só citava "renovações".
3. `runWithTenant(tenantAlvo)` dentro do request lança 404 por causa do `TenantDatabaseInterceptor`: T3 cria `runAsPlatformAdminOnTenant`.
4. `credit_transactions.metadata` é devolvido ao cliente em `GET /credits/history`: motivo e ator ficam só na auditoria.
5. O `ApiKeyGuard` global responde 403 antes do guard do controller, e sem cookie o `CookieAuthGuard` responde 401: T8 faz a chave de API receber 404; sem sessão segue 401.
6. `POST /auth/session/tenant` também devolve a sessão e perderia a flag no web: T1 inclui nas duas respostas.
7. `PlatformAdminReadRepository` vira três classes só de leitura (visão geral, usuários/detalhe, atenção), todas sobre `PlatformReadSession`.
