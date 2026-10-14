# Outbox na entrada + SCHEDULE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o `queues.add('nfse-emission')` do `POST /v1/invoices` por um transactional outbox (invoice + mensagem na mesma transação, relay publica no BullMQ) e adicionar `options.type = SCHEDULE` com `competenceDate` futura.

**Architecture:** Nova tabela `outbox_messages` (RLS por tenant) e um módulo `modules/outbox` genérico (repositório, service, registry de handlers, relay com `FOR UPDATE SKIP LOCKED`). O handler `invoice.emit` vive em `modules/invoice` e publica no `nfse-emission` com o mesmo `jobId` de hoje. O pipeline posterior (workflow, processors) não muda; o `DocsRecoveryScheduler` perde só a recuperação de `queued`.

**Tech Stack:** NestJS 11, TypeORM 0.3 (PostgreSQL, schema `corvo`, RLS), BullMQ 5, `@nestjs/schedule`, luxon, Jest, zod.

**Spec:** `docs/superpowers/specs/2026-10-13-outbox-intake-schedule-design.md`

## Global Constraints

- Trabalhar em `api/`; comandos a partir de `/Users/pedrohenrique/Documents/corvo-nfse/api`.
- Caminhos com prefixo `api/`, `docs/` ou `deploy/` são relativos à **raiz do repositório**; todos os demais (`src/`, `test/`, `scripts/`, `nest-cli.json`) são relativos a `api/`. Comandos `yarn` rodam em `api/`.
- Migrations TypeORM no schema `corvo` (usar `runner.connection.driver.escape(options.schema ?? 'corvo')` como as migrations existentes). Último timestamp existente: `1791760000000`.
- Toda tabela tenant-owned entra em `TENANT_RLS_TABLES`, com `ENABLE` + `FORCE ROW LEVEL SECURITY` e a policy `tenant_isolation_policy` idêntica às demais.
- Contrato público só ganha `options.type` (entrada) e `scheduledFor` (saída); nenhum campo ou status existente muda.
- `jobId` publicado continua `emission-{invoiceId}`; opções do job idênticas às de `enqueueEmission` (attempts 5, backoffMs 5000, removeOnComplete false, removeOnFail 1000).
- Liberação de agendamento: 00:00 de `competenceDate` em `America/Sao_Paulo`. Horizonte máximo: `OUTBOX_SCHEDULE_MAX_DAYS` (padrão 365).
- Sem backfill de dados (não há produção). Sem feature flag para a outbox.
- Testes de Postgres só rodam com `MIGRATION_TEST_DATABASE_URL` apontando para banco local terminado em `_test`; sem a variável são `describe.skip`.
- Commits pequenos por tarefa; mensagem convencional (`commitlint`). Trabalhar em branch `feat/outbox-intake` (não commitar na `main`).

## Review Focus

- Dois relays concorrentes publicando a mesma mensagem → só um publica (teste de concorrência no Postgres, Task 2).
- Handler lança/Redis fora → mensagem volta a `pending` com backoff e, ao esgotar tentativas, vira `dead` sem perder a invoice (Task 3).
- Replay idempotente e corrida `23505` não criam segunda mensagem nem chamam `queues.add` (Task 5).
- `SCHEDULE` com data hoje/passada vira imediata; com data além do horizonte retorna 422 `schedule_horizon_exceeded` (Task 4).
- Invoice agendada em `queued` nunca é reenfileirada pelo scheduler antes de `scheduledFor` (Task 6).
- Cliente em outro fuso: `competenceDate` `2026-10-14` libera às 03:00Z (00:00 BRT), não à meia-noite UTC (Task 4).

---

### Task 1: Configuração do outbox

**Files:**
- Modify: `src/infra/config/env.schema.ts` (junto de `QUEUE_DEFAULT_BACKOFF_MS`, ~linha 230)
- Modify: `src/infra/config/configuration.ts` (bloco `queue`, ~linha 90)
- Modify: `src/infra/config/configuration.types.ts` (junto de `QueueConfig`; incluir no `AppConfiguration`, ~linha 186)
- Modify: `src/infra/config/configuration.ts` re-exports (linha 11: exportar `OutboxConfig`)
- Test: `src/infra/config/outbox-env.spec.ts`

**Interfaces:**
- Produces: `OutboxConfig { relayIntervalMs: number; batchSize: number; leaseMs: number; maxAttempts: number; scheduleMaxDays: number }`; `ConfigService.get<OutboxConfig>('outbox')`.

- [x] **Step 1: Write the failing test** — `src/infra/config/outbox-env.spec.ts`

```ts
import { parseEnvConfig } from './env.schema';

describe('outbox environment configuration', () => {
  it('applies defaults', () => {
    const env = parseEnvConfig({ NODE_ENV: 'test' });
    expect(env.OUTBOX_RELAY_INTERVAL_MS).toBe(2000);
    expect(env.OUTBOX_BATCH_SIZE).toBe(50);
    expect(env.OUTBOX_LEASE_MS).toBe(120000);
    expect(env.OUTBOX_MAX_ATTEMPTS).toBe(10);
    expect(env.OUTBOX_SCHEDULE_MAX_DAYS).toBe(365);
  });

  it('coerces overrides and rejects non-positive values', () => {
    expect(
      parseEnvConfig({ NODE_ENV: 'test', OUTBOX_BATCH_SIZE: '5' })
        .OUTBOX_BATCH_SIZE,
    ).toBe(5);
    expect(() =>
      parseEnvConfig({ NODE_ENV: 'test', OUTBOX_MAX_ATTEMPTS: '0' }),
    ).toThrow();
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `yarn jest src/infra/config/outbox-env.spec.ts`
Expected: FAIL (`OUTBOX_RELAY_INTERVAL_MS` is `undefined`). Se `parseEnvConfig` exigir variáveis obrigatórias, copie o mínimo de `email-env.spec.ts`/`env.schema.ts` para o objeto de entrada.

- [x] **Step 3: Implement**

`env.schema.ts`, dentro do `z.object` logo após `QUEUE_DEFAULT_BACKOFF_MS`:

```ts
    OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
    OUTBOX_LEASE_MS: z.coerce.number().int().positive().default(120000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    OUTBOX_SCHEDULE_MAX_DAYS: z.coerce.number().int().positive().default(365),
```

`configuration.types.ts` (ao lado de `QueueConfig`):

```ts
export interface OutboxConfig {
  relayIntervalMs: number;
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  scheduleMaxDays: number;
}
```

e no `AppConfiguration`: `outbox: OutboxConfig;` (abaixo de `queue: QueueConfig;`). `configuration.ts`, abaixo do bloco `queue`:

```ts
    outbox: {
      relayIntervalMs: env.OUTBOX_RELAY_INTERVAL_MS,
      batchSize: env.OUTBOX_BATCH_SIZE,
      leaseMs: env.OUTBOX_LEASE_MS,
      maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
      scheduleMaxDays: env.OUTBOX_SCHEDULE_MAX_DAYS,
    },
```

Em `configuration.ts` linha 11: `export type { QueueConfig, RedisConfig, OutboxConfig } from './configuration.types';`. Adicione as cinco variáveis (com os padrões) a `.env.example`.

- [x] **Step 4: Run to verify it passes**

Run: `yarn jest src/infra/config && yarn typecheck`
Expected: PASS; typecheck limpo.

- [x] **Step 5: Commit**

```bash
git add src/infra/config .env.example
git commit -m "feat(config): add outbox and schedule settings"
```

---

### Task 2: Tabela, entidade e repositório da outbox

**Files:**
- Modify: `src/infra/database/rls-tables.ts`
- Modify: `src/infra/database/migrations/1791750000000-EnableTenantRls.ts` (usar `BASELINE_RLS_TABLES`)
- Modify: `src/infra/database/tenant-rls.postgres.integration.spec.ts` (16 → 17)
- Modify: `src/infra/persistence/typeorm/tenant-context.storage.ts` (`SystemPurpose` + `'outbox-relay'`)
- Create: `src/infra/database/migrations/1791770000000-CreateOutboxMessages.ts`
- Create: `src/modules/outbox/domain/outbox-message.ts`
- Create: `src/modules/outbox/domain/outbox.repository.ts`
- Create: `src/modules/outbox/infra/outbox-message.orm-entity.ts`
- Create: `src/modules/outbox/infra/typeorm-outbox.repository.ts`
- Test: `src/modules/outbox/infra/typeorm-outbox.repository.postgres.integration.spec.ts`

**Interfaces:**
- Produces (`outbox-message.ts`):
  ```ts
  export type OutboxStatus = 'pending' | 'claimed' | 'completed' | 'dead';
  export interface OutboxMessage { id: string; tenantId: string; environment: ExecutionEnvironment; type: string; aggregateId: string; payload: Record<string, unknown>; dedupeKey: string; status: OutboxStatus; availableAt: Date; leaseUntil: Date | null; attempts: number; lastError: string | null }
  export interface NewOutboxMessage { tenantId: string; environment: ExecutionEnvironment; type: string; aggregateId: string; payload: Record<string, unknown>; dedupeKey: string; availableAt?: Date }
  ```
- Produces (`outbox.repository.ts`):
  ```ts
  export interface IOutboxRepository {
    insert(message: NewOutboxMessage): Promise<boolean>;            // false = dedupe hit
    claimBatch(now: Date, limit: number, leaseUntil: Date): Promise<OutboxMessage[]>; // system scope
    complete(id: string, tenantId: string, at: Date): Promise<void>;
    release(id: string, tenantId: string, error: string, nextAvailableAt: Date, at: Date): Promise<void>;
    markDead(id: string, tenantId: string, error: string, at: Date): Promise<void>;
  }
  export const OUTBOX_REPOSITORY = 'OUTBOX_REPOSITORY';
  ```
- Produces: `TypeOrmOutboxRepository`, `OutboxMessageOrmEntity`.

- [ ] **Step 1: Split the RLS table list** — `rls-tables.ts`:

```ts
/** Tables covered by the original RLS migration (1791750000000). Never change. */
export const BASELINE_RLS_TABLES = [
  'tenants',
  'tenant_billing',
  'tenant_settings',
  'tenant_memberships',
  'tenant_invitations',
  'api_keys',
  'nfse_companies',
  'nfse_invoices',
  'credit_transactions',
  'billing_usage_periods',
  'webhook_configs',
  'webhook_deliveries',
  'mcp_connections',
  'nfse_certificates',
  'nfse_dps_sequences',
  'nfse_invoice_events',
] as const;

/** Application tables whose tenant isolation must be enforced by PostgreSQL. */
export const TENANT_RLS_TABLES = [...BASELINE_RLS_TABLES, 'outbox_messages'] as const;
```

Em `1791750000000-EnableTenantRls.ts` troque o import e os dois usos de `TENANT_RLS_TABLES` por `BASELINE_RLS_TABLES`. Em `tenant-rls.postgres.integration.spec.ts` altere o título `'enables and forces RLS on all 16 tenant tables'` e `expect(rows).toHaveLength(16)` para `17`. Em `tenant-context.storage.ts` acrescente `| 'outbox-relay'` ao `SystemPurpose`.

- [ ] **Step 2: Write the failing integration test** — `typeorm-outbox.repository.postgres.integration.spec.ts`

Use o mesmo harness de `src/infra/database/tenant-rls.postgres.integration.spec.ts` (schema temporário, `admin.runMigrations()`, role de runtime sem BYPASSRLS via `scripts/provision-runtime-role.sql`, `installRlsConnectionScope(runtime)`). Copie o bloco `beforeAll`/`afterAll` dele (criação de `admin`, schema, tenants, role, `runtime`) e instancie:

```ts
const transactions = new TypeOrmTransactionContext();
const repo = new TypeOrmOutboxRepository(runtime, transactions);
```

Casos (cada um dentro de `runWithTenant(tenantA, …)` ou `runAsSystem('outbox-relay', …)` conforme o método):

```ts
const base = (dedupeKey: string, availableAt?: Date): NewOutboxMessage => ({
  tenantId: tenantA,
  environment: 'test',
  type: 'invoice.emit',
  aggregateId: randomUUID(),
  payload: { invoiceId: 'x' },
  dedupeKey,
  availableAt,
});

it('inserts once per (tenant, dedupeKey)', async () => {
  await runWithTenant(tenantA, async () => {
    expect(await repo.insert(base('emission:1'))).toBe(true);
    expect(await repo.insert(base('emission:1'))).toBe(false);
  });
});

it('claims only due messages and leaves future ones', async () => {
  const future = new Date(Date.now() + 3_600_000);
  await runWithTenant(tenantA, async () => {
    await repo.insert(base('due-1'));
    await repo.insert(base('future-1', future));
  });
  const now = new Date();
  const claimed = await runAsSystem('outbox-relay', () =>
    repo.claimBatch(now, 10, new Date(now.getTime() + 60_000)),
  );
  expect(claimed.map((m) => m.dedupeKey)).toContain('due-1');
  expect(claimed.map((m) => m.dedupeKey)).not.toContain('future-1');
  expect(claimed.every((m) => m.status === 'claimed' && m.attempts === 1)).toBe(true);
});

it('two concurrent claimers never receive the same message', async () => {
  await runWithTenant(tenantA, async () => {
    for (let i = 0; i < 20; i++) await repo.insert(base(`race-${i}`));
  });
  const now = new Date();
  const lease = new Date(now.getTime() + 60_000);
  const [a, b] = await Promise.all([
    runAsSystem('outbox-relay', () => repo.claimBatch(now, 20, lease)),
    runAsSystem('outbox-relay', () => repo.claimBatch(now, 20, lease)),
  ]);
  const ids = [...a, ...b].map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it('reclaims a message whose lease expired', async () => {
  await runWithTenant(tenantA, () => repo.insert(base('lease-1')));
  const t0 = new Date();
  const [first] = (
    await runAsSystem('outbox-relay', () =>
      repo.claimBatch(t0, 100, new Date(t0.getTime() + 1_000)),
    )
  ).filter((m) => m.dedupeKey === 'lease-1');
  const later = new Date(t0.getTime() + 5_000);
  const again = (
    await runAsSystem('outbox-relay', () =>
      repo.claimBatch(later, 100, new Date(later.getTime() + 1_000)),
    )
  ).find((m) => m.id === first.id);
  expect(again?.attempts).toBe(2);
});

it('complete, release and markDead update state under the tenant scope', async () => {
  await runWithTenant(tenantA, () => repo.insert(base('state-1')));
  const now = new Date();
  const [msg] = (
    await runAsSystem('outbox-relay', () =>
      repo.claimBatch(now, 100, new Date(now.getTime() + 60_000)),
    )
  ).filter((m) => m.dedupeKey === 'state-1');
  await runWithTenant(tenantA, () =>
    repo.release(msg.id, tenantA, 'boom', new Date(now.getTime() + 10_000), now),
  );
  const [row] = await admin.query(
    `SELECT status, last_error FROM "${schema}".outbox_messages WHERE id=$1`,
    [msg.id],
  );
  expect(row).toEqual({ status: 'pending', last_error: 'boom' });
  await runWithTenant(tenantA, () => repo.markDead(msg.id, tenantA, 'dead', now));
  const [dead] = await admin.query(
    `SELECT status FROM "${schema}".outbox_messages WHERE id=$1`,
    [msg.id],
  );
  expect(dead.status).toBe('dead');
});

it('RLS hides tenant A messages from tenant B', async () => {
  const rows = await runWithTenant(tenantB, () =>
    runtime.query(`SELECT id FROM "${schema}".outbox_messages`),
  );
  expect(rows).toEqual([]);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `MIGRATION_TEST_DATABASE_URL=postgres://…/corvo_test yarn jest src/modules/outbox`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 4: Write the migration** — `1791770000000-CreateOutboxMessages.ts`

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutboxMessages1791770000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`CREATE TABLE ${schema}.outbox_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
      environment varchar(10) NOT NULL,
      type varchar(60) NOT NULL,
      aggregate_id uuid NOT NULL,
      payload jsonb NOT NULL,
      dedupe_key varchar(200) NOT NULL,
      status varchar(10) NOT NULL DEFAULT 'pending',
      available_at timestamptz NOT NULL DEFAULT now(),
      lease_until timestamptz,
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      CONSTRAINT ck_outbox_messages_environment CHECK (environment IN ('test','live')),
      CONSTRAINT ck_outbox_messages_status CHECK (status IN ('pending','claimed','completed','dead'))
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_outbox_tenant_dedupe ON ${schema}.outbox_messages (tenant_id, dedupe_key)`,
    );
    await runner.query(
      `CREATE INDEX idx_outbox_pending_available ON ${schema}.outbox_messages (available_at) WHERE status = 'pending'`,
    );
    await runner.query(
      `CREATE INDEX idx_outbox_claimed_lease ON ${schema}.outbox_messages (lease_until) WHERE status = 'claimed'`,
    );
    await runner.query(
      `CREATE INDEX idx_outbox_tenant_aggregate ON ${schema}.outbox_messages (tenant_id, aggregate_id)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner = "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(`ALTER TABLE ${schema}.outbox_messages ENABLE ROW LEVEL SECURITY`);
    await runner.query(`ALTER TABLE ${schema}.outbox_messages FORCE ROW LEVEL SECURITY`);
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${schema}.outbox_messages USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );

    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ADD COLUMN scheduled_for timestamptz`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(`ALTER TABLE ${schema}.nfse_invoices DROP COLUMN scheduled_for`);
    await runner.query(`DROP TABLE ${schema}.outbox_messages`);
  }
}
```

- [ ] **Step 5: Write domain types, entity and repository**

`outbox-message.ts` e `outbox.repository.ts` conforme **Interfaces** (importar `ExecutionEnvironment` de `@/shared/domain/execution-environment`).

`outbox-message.orm-entity.ts`:

```ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('outbox_messages')
@Index('uq_outbox_tenant_dedupe', ['tenantId', 'dedupeKey'], { unique: true })
export class OutboxMessageOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ type: 'varchar', length: 10 }) environment!: string;
  @Column({ type: 'varchar', length: 60 }) type!: string;
  @Column({ name: 'aggregate_id', type: 'uuid' }) aggregateId!: string;
  @Column({ type: 'jsonb' }) payload!: Record<string, unknown>;
  @Column({ name: 'dedupe_key', type: 'varchar', length: 200 }) dedupeKey!: string;
  @Column({ type: 'varchar', length: 10, default: 'pending' }) status!: string;
  @Column({ name: 'available_at', type: 'timestamptz' }) availableAt!: Date;
  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true }) leaseUntil!: Date | null;
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError!: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt!: Date | null;
}
```

`typeorm-outbox.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { IOutboxRepository } from '../domain/outbox.repository';
import type { NewOutboxMessage, OutboxMessage, OutboxStatus } from '../domain/outbox-message';
import { OutboxMessageOrmEntity } from './outbox-message.orm-entity';

interface OutboxRow {
  id: string; tenant_id: string; environment: string; type: string; aggregate_id: string;
  payload: Record<string, unknown>; dedupe_key: string; status: string;
  available_at: Date; lease_until: Date | null; attempts: number; last_error: string | null;
}

@Injectable()
export class TypeOrmOutboxRepository implements IOutboxRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionContext,
  ) {}

  private manager(): EntityManager {
    return this.transactions.getManager() ?? this.dataSource.manager;
  }

  private table(): string {
    return this.dataSource.getMetadata(OutboxMessageOrmEntity).tablePath;
  }

  /** UPDATE ... RETURNING resolves to [rows, affected]; INSERT ... RETURNING to rows. */
  private rowsOf(raw: unknown): OutboxRow[] {
    const list = raw as unknown[];
    return (Array.isArray(list[0]) ? list[0] : list) as OutboxRow[];
  }

  async insert(message: NewOutboxMessage): Promise<boolean> {
    const raw = await this.manager().query(
      `INSERT INTO ${this.table()} (tenant_id, environment, type, aggregate_id, payload, dedupe_key, available_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [
        message.tenantId,
        message.environment,
        message.type,
        message.aggregateId,
        JSON.stringify(message.payload),
        message.dedupeKey,
        message.availableAt ?? new Date(),
      ],
    );
    return this.rowsOf(raw).length > 0;
  }

  async claimBatch(now: Date, limit: number, leaseUntil: Date): Promise<OutboxMessage[]> {
    const raw = await this.dataSource.query(
      `WITH due AS (
         SELECT id FROM ${this.table()}
         WHERE (status = 'pending' AND available_at <= $1)
            OR (status = 'claimed' AND lease_until < $1)
         ORDER BY available_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE ${this.table()} m
       SET status = 'claimed', lease_until = $3, attempts = m.attempts + 1, updated_at = $1
       FROM due WHERE m.id = due.id
       RETURNING m.*`,
      [now, limit, leaseUntil],
    );
    return this.rowsOf(raw).map((row) => this.toDomain(row));
  }

  async complete(id: string, tenantId: string, at: Date): Promise<void> {
    await this.manager().query(
      `UPDATE ${this.table()} SET status = 'completed', completed_at = $3, lease_until = NULL, updated_at = $3
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, at],
    );
  }

  async release(id: string, tenantId: string, error: string, nextAvailableAt: Date, at: Date): Promise<void> {
    await this.manager().query(
      `UPDATE ${this.table()} SET status = 'pending', last_error = $3, available_at = $4, lease_until = NULL, updated_at = $5
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, error, nextAvailableAt, at],
    );
  }

  async markDead(id: string, tenantId: string, error: string, at: Date): Promise<void> {
    await this.manager().query(
      `UPDATE ${this.table()} SET status = 'dead', last_error = $3, lease_until = NULL, updated_at = $4
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, error, at],
    );
  }

  private toDomain(row: OutboxRow): OutboxMessage {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      environment: row.environment as ExecutionEnvironment,
      type: row.type,
      aggregateId: row.aggregate_id,
      payload: row.payload,
      dedupeKey: row.dedupe_key,
      status: row.status as OutboxStatus,
      availableAt: row.available_at,
      leaseUntil: row.lease_until,
      attempts: row.attempts,
      lastError: row.last_error,
    };
  }
}
```

(`claimBatch` usa `this.dataSource.query` de propósito: não participa de transação ambiente e roda em auto-commit, soltando o lock `SKIP LOCKED` ao fim do statement.)

- [ ] **Step 6: Run to verify it passes**

Run: `MIGRATION_TEST_DATABASE_URL=… yarn jest src/modules/outbox src/infra/database`
Expected: PASS (inclui o teste RLS agora com 17 tabelas). Sem a variável: suites ficam `skipped`; neste caso rode também `yarn typecheck`.

- [ ] **Step 7: Commit**

```bash
git add src/infra src/modules/outbox
git commit -m "feat(outbox): add outbox_messages table, entity and repository"
```

---

### Task 3: OutboxService, registry e relay

**Files:**
- Create: `src/modules/outbox/domain/outbox-handler.ts`
- Create: `src/modules/outbox/application/outbox-handler.registry.ts`
- Create: `src/modules/outbox/application/outbox.service.ts`
- Create: `src/modules/outbox/application/outbox-backoff.ts`
- Create: `src/modules/outbox/application/outbox-relay.ts`
- Create: `src/modules/outbox/outbox.module.ts`
- Create: `src/modules/outbox/observability/outbox.metrics.ts`
- Test: `src/modules/outbox/application/outbox-relay.spec.ts`, `outbox-backoff.spec.ts`

**Interfaces:**
- Consumes: `IOutboxRepository`, `OUTBOX_REPOSITORY`, `OutboxMessage`, `NewOutboxMessage` (Task 2); `OutboxConfig` (Task 1).
- Produces:
  ```ts
  export interface OutboxHandler { readonly type: string; handle(message: OutboxMessage): Promise<void> }
  export class OutboxHandlerRegistry { register(handler: OutboxHandler): void; get(type: string): OutboxHandler | undefined }
  export class OutboxService { enqueue(message: NewOutboxMessage): Promise<boolean> }
  export function outboxBackoffMs(attempts: number): number   // min(2000 * 2^(attempts-1), 300000)
  export class OutboxRelay { tick(now?: Date): Promise<number> }  // returns processed count
  export class OutboxModule  // exports OutboxService, OutboxHandlerRegistry; provides OutboxRelay
  ```

- [ ] **Step 1: Write failing tests**

`outbox-backoff.spec.ts`:

```ts
import { outboxBackoffMs } from './outbox-backoff';

describe('outboxBackoffMs', () => {
  it.each([[1, 2000], [2, 4000], [3, 8000], [20, 300000]])(
    'attempt %i waits %i ms',
    (attempts, expected) => expect(outboxBackoffMs(attempts)).toBe(expected),
  );
});
```

`outbox-relay.spec.ts`:

```ts
import { OutboxRelay } from './outbox-relay';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import type { IOutboxRepository } from '../domain/outbox.repository';
import type { OutboxMessage } from '../domain/outbox-message';

const tenantId = '11111111-1111-4111-8111-111111111111';
const message = (over: Partial<OutboxMessage> = {}): OutboxMessage => ({
  id: 'm1', tenantId, environment: 'test', type: 'invoice.emit',
  aggregateId: 'a1', payload: {}, dedupeKey: 'emission:a1', status: 'claimed',
  availableAt: new Date(), leaseUntil: new Date(), attempts: 1, lastError: null,
  ...over,
});
const config = {
  get: () => ({ relayIntervalMs: 1000, batchSize: 10, leaseMs: 60000, maxAttempts: 3, scheduleMaxDays: 365 }),
};

function setup(claimed: OutboxMessage[], handle: jest.Mock) {
  const repo: jest.Mocked<IOutboxRepository> = {
    insert: jest.fn(), claimBatch: jest.fn().mockResolvedValue(claimed),
    complete: jest.fn(), release: jest.fn(), markDead: jest.fn(),
  };
  const registry = new OutboxHandlerRegistry();
  registry.register({ type: 'invoice.emit', handle });
  return { repo, relay: new OutboxRelay(repo, registry, config as never) };
}

describe('OutboxRelay', () => {
  it('completes a message after its handler succeeds', async () => {
    const handle = jest.fn().mockResolvedValue(undefined);
    const { repo, relay } = setup([message()], handle);
    await relay.tick(new Date('2026-10-13T12:00:00Z'));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalledWith('m1', tenantId, expect.any(Date));
    expect(repo.release).not.toHaveBeenCalled();
  });

  it('releases with backoff when the handler throws', async () => {
    const handle = jest.fn().mockRejectedValue(new Error('redis down'));
    const { repo, relay } = setup([message({ attempts: 1 })], handle);
    const now = new Date('2026-10-13T12:00:00Z');
    await relay.tick(now);
    expect(repo.release).toHaveBeenCalledWith('m1', tenantId, 'redis down', new Date(now.getTime() + 2000), expect.any(Date));
    expect(repo.complete).not.toHaveBeenCalled();
  });

  it('marks the message dead once maxAttempts is reached', async () => {
    const handle = jest.fn().mockRejectedValue(new Error('still down'));
    const { repo, relay } = setup([message({ attempts: 3 })], handle);
    await relay.tick(new Date());
    expect(repo.markDead).toHaveBeenCalledWith('m1', tenantId, 'still down', expect.any(Date));
    expect(repo.release).not.toHaveBeenCalled();
  });

  it('releases a message of unknown type instead of dropping it', async () => {
    const { repo, relay } = setup([message({ type: 'unknown.type' })], jest.fn());
    await relay.tick(new Date());
    expect(repo.release).toHaveBeenCalled();
  });

  it('a failing message does not stop the rest of the batch', async () => {
    const handle = jest.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const { repo, relay } = setup([message({ id: 'a' }), message({ id: 'b' })], handle);
    await relay.tick(new Date());
    expect(repo.release).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalledWith('b', tenantId, expect.any(Date));
  });

  it('ignores overlapping ticks', async () => {
    let finish!: () => void;
    const handle = jest.fn(() => new Promise<void>((r) => (finish = r)));
    const { relay } = setup([message()], handle);
    const first = relay.tick(new Date());
    expect(await relay.tick(new Date())).toBe(0);
    finish();
    await first;
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn jest src/modules/outbox/application`
Expected: FAIL (arquivos inexistentes).

- [ ] **Step 3: Implement**

`outbox-handler.ts`:

```ts
import type { OutboxMessage } from './outbox-message';

export interface OutboxHandler {
  readonly type: string;
  /** Must be idempotent: a message can be delivered again after a crash. */
  handle(message: OutboxMessage): Promise<void>;
}
```

`outbox-handler.registry.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { OutboxHandler } from '../domain/outbox-handler';

@Injectable()
export class OutboxHandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler>();

  register(handler: OutboxHandler): void {
    if (this.handlers.has(handler.type))
      throw new Error(`Outbox handler already registered for ${handler.type}`);
    this.handlers.set(handler.type, handler);
  }

  get(type: string): OutboxHandler | undefined {
    return this.handlers.get(type);
  }
}
```

`outbox-backoff.ts`:

```ts
export function outboxBackoffMs(attempts: number): number {
  return Math.min(2000 * 2 ** Math.max(attempts - 1, 0), 300_000);
}
```

`outbox.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_REPOSITORY, type IOutboxRepository } from '../domain/outbox.repository';
import type { NewOutboxMessage } from '../domain/outbox-message';

/** Call inside the caller's transaction (TypeOrmTransactionContext) so state and message commit together. */
@Injectable()
export class OutboxService {
  constructor(@Inject(OUTBOX_REPOSITORY) private readonly repo: IOutboxRepository) {}

  enqueue(message: NewOutboxMessage): Promise<boolean> {
    return this.repo.insert(message);
  }
}
```

`outbox.metrics.ts` (padrão de `security.metrics.ts`):

```ts
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('greenflow.outbox');
const published = meter.createCounter('outbox_published_total');
const failures = meter.createCounter('outbox_publish_failures_total');
const dead = meter.createCounter('outbox_dead_total');
const claimToPublish = meter.createHistogram('outbox_claim_to_publish_duration', { unit: 's' });

export const recordOutboxPublished = (type: string) => published.add(1, { type });
export const recordOutboxFailure = (type: string) => failures.add(1, { type });
export const recordOutboxDead = (type: string) => dead.add(1, { type });
export const recordOutboxLatency = (type: string, seconds: number) =>
  claimToPublish.record(seconds, { type });
```

`outbox-relay.ts`:

```ts
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runAsSystem, runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { captureRuntimeException } from '@/infra/observability/sentry-reporter';
import type { OutboxConfig } from '@/infra/config/configuration';
import { OUTBOX_REPOSITORY, type IOutboxRepository } from '../domain/outbox.repository';
import type { OutboxMessage } from '../domain/outbox-message';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import { outboxBackoffMs } from './outbox-backoff';
import { recordOutboxDead, recordOutboxFailure, recordOutboxLatency, recordOutboxPublished } from '../observability/outbox.metrics';

@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private running = false;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly repo: IOutboxRepository,
    private readonly registry: OutboxHandlerRegistry,
    private readonly config: ConfigService,
  ) {}

  private settings(): OutboxConfig {
    return this.config.get<OutboxConfig>('outbox')!;
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) =>
        this.logger.error({ err: error }, 'Outbox relay tick failed'),
      );
    }, this.settings().relayIntervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const { batchSize, leaseMs } = this.settings();
      const claimed = await runAsSystem('outbox-relay', () =>
        this.repo.claimBatch(now, batchSize, new Date(now.getTime() + leaseMs)),
      );
      for (const message of claimed) await this.dispatch(message, now);
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  private async dispatch(message: OutboxMessage, claimedAt: Date): Promise<void> {
    const { maxAttempts } = this.settings();
    try {
      const handler = this.registry.get(message.type);
      if (!handler) throw new Error(`No outbox handler for type ${message.type}`);
      await runWithTenant(message.tenantId, () => handler.handle(message));
      await runWithTenant(message.tenantId, () =>
        this.repo.complete(message.id, message.tenantId, new Date()),
      );
      recordOutboxPublished(message.type);
      recordOutboxLatency(message.type, (Date.now() - claimedAt.getTime()) / 1000);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      recordOutboxFailure(message.type);
      if (message.attempts >= maxAttempts) {
        recordOutboxDead(message.type);
        this.logger.error(
          { outboxId: message.id, type: message.type, tenantId: message.tenantId, attempts: message.attempts },
          'Outbox message is dead',
        );
        captureRuntimeException(error, 'worker', `outbox.dead:${message.type}`);
        await runWithTenant(message.tenantId, () =>
          this.repo.markDead(message.id, message.tenantId, reason, new Date()),
        );
        return;
      }
      await runWithTenant(message.tenantId, () =>
        this.repo.release(
          message.id,
          message.tenantId,
          reason,
          new Date(claimedAt.getTime() + outboxBackoffMs(message.attempts)),
          new Date(),
        ),
      );
    }
  }
}
```

(Se `captureRuntimeException` rejeitar `'worker'` como `SentryRuntime`, use o literal aceito em `sentry-reporter.ts:3`.)

`outbox.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OUTBOX_REPOSITORY } from './domain/outbox.repository';
import { TypeOrmOutboxRepository } from './infra/typeorm-outbox.repository';
import { OutboxHandlerRegistry } from './application/outbox-handler.registry';
import { OutboxService } from './application/outbox.service';
import { OutboxRelay } from './application/outbox-relay';

@Module({
  providers: [
    { provide: OUTBOX_REPOSITORY, useClass: TypeOrmOutboxRepository },
    OutboxHandlerRegistry,
    OutboxService,
  ],
  exports: [OutboxService, OutboxHandlerRegistry, OUTBOX_REPOSITORY],
})
export class OutboxModule {}

/** Only the worker process runs the relay. */
@Module({
  imports: [OutboxModule],
  providers: [OutboxRelay],
})
export class OutboxRelayModule {}
```

- [ ] **Step 4: Run to verify they pass**

Run: `yarn jest src/modules/outbox/application && yarn typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/outbox
git commit -m "feat(outbox): add service, handler registry and relay"
```

---

### Task 4: Domínio — `scheduledFor`, regra SCHEDULE e DTO

**Files:**
- Modify: `src/modules/invoice/http/invoice.dto.ts` (`InvoiceOptionsDto`)
- Modify: `src/shared/fiscal/fiscal-validation-error.ts` (novo `FiscalIssueCode`)
- Modify: `src/modules/invoice/domain/invoice-domain.service.ts`
- Modify: `src/modules/invoice/domain/invoice.ts`
- Modify: `src/modules/invoice/infra/invoice.orm-entity.ts`, `src/modules/invoice/infra/invoice.mapper.ts`
- Modify: `src/modules/invoice/http/invoice-response.dto.ts`
- Test: `src/modules/invoice/domain/invoice-domain.service.spec.ts`, `src/modules/invoice/domain/invoice.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // invoice.dto.ts
  export type InvoiceEmissionType = 'IMMEDIATE' | 'SCHEDULE';
  InvoiceOptionsDto.type?: InvoiceEmissionType
  // invoice-domain.service.ts
  export const SCHEDULE_MAX_DAYS = 'SCHEDULE_MAX_DAYS';          // DI token (number)
  NormalizedInvoiceInput.scheduledFor?: Date                     // only when SCHEDULE and in the future
  // invoice.ts
  InvoiceProps.scheduledFor?: Date | null
  CreateInvoiceInput.scheduledFor?: Date
  Invoice#scheduledFor: Date | null
  ```

- [ ] **Step 1: Write failing tests** — acrescentar em `invoice-domain.service.spec.ts` (usa `validDto()` e `service` existentes no arquivo; veja como os testes vizinhos montam o dto):

```ts
describe('SCHEDULE', () => {
  const inDays = (n: number) =>
    new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  it('still rejects a future competenceDate for IMMEDIATE', () => {
    expect(() =>
      service.normalizeAndValidate(validDto({ competenceDate: inDays(3) }) as any, 'test', defaults),
    ).toThrow(FiscalValidationError);
  });

  it('accepts a future competenceDate for SCHEDULE and releases at 00:00 America/Sao_Paulo', () => {
    const result = service.normalizeAndValidate(
      validDto({ competenceDate: '2099-10-14', options: { type: 'SCHEDULE' } }) as any,
      'test',
      defaults,
    );
    expect(result.scheduledFor?.toISOString()).toBe('2099-10-14T03:00:00.000Z');
  });

  it('treats SCHEDULE with today or a past date as immediate', () => {
    const result = service.normalizeAndValidate(
      validDto({ competenceDate: inDays(-2), options: { type: 'SCHEDULE' } }) as any,
      'test',
      defaults,
    );
    expect(result.scheduledFor).toBeUndefined();
  });

  it('rejects SCHEDULE beyond the horizon with schedule_horizon_exceeded', () => {
    try {
      new InvoiceDomainService(30).normalizeAndValidate(
        validDto({ competenceDate: inDays(31), options: { type: 'SCHEDULE' } }) as any,
        'test',
        defaults,
      );
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(FiscalValidationError);
      expect((error as FiscalValidationError).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'competenceDate', code: 'schedule_horizon_exceeded' }),
        ]),
      );
    }
  });
});
```

Em `invoice.spec.ts`: um teste `Invoice.create({ …, scheduledFor })` verificando `invoice.scheduledFor` e que `Invoice.create` sem ela retorna `null`, e que `toSnapshot().scheduledFor` espelha.

- [ ] **Step 2: Run to verify they fail**

Run: `yarn jest src/modules/invoice/domain`
Expected: FAIL.

- [ ] **Step 3: Implement**

`invoice.dto.ts`:

```ts
export type InvoiceEmissionType = 'IMMEDIATE' | 'SCHEDULE';

export class InvoiceOptionsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EmailOptionsDto)
  email?: EmailOptionsDto;

  @IsOptional()
  @IsIn(['IMMEDIATE', 'SCHEDULE'])
  @ApiPropertyOptional({
    enum: ['IMMEDIATE', 'SCHEDULE'],
    description:
      'SCHEDULE accepts a future competenceDate; the invoice is released at 00:00 America/Sao_Paulo of that day.',
  })
  type?: InvoiceEmissionType;
}
```

`src/shared/fiscal/fiscal-validation-error.ts`: acrescente `| 'schedule_horizon_exceeded'` à união `FiscalIssueCode` (sem isso o `push` não compila).

`invoice-domain.service.ts`: acrescente import `DateTime` de `luxon`, `Inject, Optional` de `@nestjs/common`, exporte o token e o construtor, o campo no tipo e a lógica:

```ts
export const SCHEDULE_MAX_DAYS = 'SCHEDULE_MAX_DAYS';
const SCHEDULE_ZONE = 'America/Sao_Paulo';

// in NormalizedInvoiceInput:
  scheduledFor?: Date;

@Injectable()
export class InvoiceDomainService {
  constructor(
    @Optional() @Inject(SCHEDULE_MAX_DAYS) private readonly scheduleMaxDays: number = 365,
  ) {}
```

Substitua o ramo `else if (competenceDate > new Date())` por:

```ts
      } else if (competenceDate > new Date()) {
        if (dto.options?.type !== 'SCHEDULE') {
          issues.push({
            field: 'competenceDate',
            code: 'future_date',
            message: 'competenceDate cannot be in the future',
          });
        } else {
          const release = DateTime.fromISO(
            competenceDate.toISOString().slice(0, 10),
            { zone: SCHEDULE_ZONE },
          ).startOf('day');
          if (release.toMillis() > Date.now() + this.scheduleMaxDays * 86_400_000) {
            issues.push({
              field: 'competenceDate',
              code: 'schedule_horizon_exceeded',
              message: `competenceDate cannot be more than ${this.scheduleMaxDays} days ahead`,
            });
          } else if (release.toMillis() > Date.now()) {
            scheduledFor = release.toJSDate();
          }
        }
      }
```

declare `let scheduledFor: Date | undefined;` antes do bloco de competenceDate e inclua `scheduledFor` no objeto retornado. (SCHEDULE com data hoje/passada cai no `if (competenceDate > new Date())` falso e fica imediato.)

`invoice.ts`: `scheduledFor?: Date | null;` em `InvoiceProps`; `scheduledFor?: Date;` em `CreateInvoiceInput`; em `Invoice.create` acrescente `scheduledFor: input.scheduledFor ?? null,`; getter:

```ts
  get scheduledFor(): Date | null {
    return this.props.scheduledFor ?? null;
  }
```

`invoice.orm-entity.ts` (após `competenceDate`):

```ts
  @Column({ name: 'scheduled_for', type: 'timestamptz', nullable: true })
  scheduledFor?: Date | null;
```

`invoice.mapper.ts`: `scheduledFor: orm.scheduledFor ?? null,` em `toDomain` e `orm.scheduledFor = snapshot.scheduledFor ?? null;` em `toPersistence`. `invoice-response.dto.ts` (após `competenceDate`): `@ApiPropertyOptional({ nullable: true }) scheduledFor?: Date | null;`.

- [ ] **Step 4: Run to verify they pass**

Run: `yarn jest src/modules/invoice && yarn typecheck`
Expected: PASS (corrija qualquer fixture de `InvoiceProps` que quebre tipagem — o campo é opcional, então não deve haver).

- [ ] **Step 5: Commit**

```bash
git add src/modules/invoice
git commit -m "feat(invoice): add SCHEDULE emission type and scheduledFor"
```

---

### Task 5: Intake grava a outbox; handler `invoice.emit`

**Files:**
- Create: `src/modules/invoice/application/invoice-emit.handler.ts`
- Modify: `src/modules/invoice/application/invoice-lifecycle.service.ts` (`submit`)
- Modify: `src/modules/invoice/application/invoice.service.ts` (`emit`, remover `enqueueEmission`)
- Modify: `src/modules/invoice/invoice.module.ts`
- Modify: `src/worker-app.module.ts`
- Test: `src/modules/invoice/application/invoice-emit.handler.spec.ts`; ajustar `invoice.service*.spec.ts`

**Interfaces:**
- Consumes: `OutboxService.enqueue`, `OutboxHandlerRegistry.register`, `OutboxHandler`, `OutboxMessage`, `NewOutboxMessage`; `Invoice#scheduledFor` (Task 4).
- Produces:
  ```ts
  export const INVOICE_EMIT = 'invoice.emit';
  export class InvoiceEmitHandler implements OutboxHandler, OnModuleInit { type = INVOICE_EMIT; handle(m: OutboxMessage): Promise<void> }
  ```
  Payload da mensagem: `{ invoiceId, companyId, tenantId }`; `dedupeKey = emission:{invoiceId}`.

- [ ] **Step 1: Write the failing handler test** — `invoice-emit.handler.spec.ts`

```ts
import { InvoiceEmitHandler, INVOICE_EMIT } from './invoice-emit.handler';
import { OutboxHandlerRegistry } from '@/modules/outbox/application/outbox-handler.registry';

describe('InvoiceEmitHandler', () => {
  const queue = { add: jest.fn().mockResolvedValue({ id: 'emission-i1' }) };

  it('publishes nfse-emission with the same jobId and options as before', async () => {
    const handler = new InvoiceEmitHandler(queue as never, new OutboxHandlerRegistry());
    await handler.handle({
      id: 'm1', tenantId: 't1', environment: 'test', type: INVOICE_EMIT,
      aggregateId: 'i1', dedupeKey: 'emission:i1', status: 'claimed',
      availableAt: new Date(), leaseUntil: null, attempts: 1, lastError: null,
      payload: { invoiceId: 'i1', companyId: 'c1', tenantId: 't1' },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'nfse-emission',
      'process',
      { invoiceId: 'i1', companyId: 'c1', tenantId: 't1' },
      { idempotencyKey: 'emission-i1', attempts: 5, backoffMs: 5000, removeOnComplete: false, removeOnFail: 1000 },
    );
  });

  it('registers itself on module init', () => {
    const registry = new OutboxHandlerRegistry();
    const handler = new InvoiceEmitHandler(queue as never, registry);
    handler.onModuleInit();
    expect(registry.get(INVOICE_EMIT)).toBe(handler);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn jest src/modules/invoice/application/invoice-emit.handler.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the handler**

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import type { OutboxHandler } from '@/modules/outbox/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/outbox/domain/outbox-message';
import { OutboxHandlerRegistry } from '@/modules/outbox/application/outbox-handler.registry';

export const INVOICE_EMIT = 'invoice.emit';

@Injectable()
export class InvoiceEmitHandler implements OutboxHandler, OnModuleInit {
  readonly type = INVOICE_EMIT;

  constructor(
    private readonly queue: BullmqQueueService,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { invoiceId, companyId, tenantId } = message.payload as {
      invoiceId: string; companyId: string; tenantId: string;
    };
    await this.queue.add(
      'nfse-emission',
      'process',
      { invoiceId, companyId, tenantId },
      {
        idempotencyKey: `emission-${invoiceId}`,
        attempts: 5,
        backoffMs: 5000,
        removeOnComplete: false,
        removeOnFail: 1000,
      },
    );
  }
}
```

- [ ] **Step 4: Write the lifecycle/intake tests (failing)**

Em `src/modules/invoice/application/invoice.service.defaults.spec.ts` (tem o arranjo pronto: `dto`, `auth`, `company`, `repository`, `lifecycle`, `queues`, `service`), acrescente dentro do `describe` existente — e remova do `new InvoiceService(...)` nada além do que a Task exige (o construtor não muda):

```ts
it('does not enqueue nfse-emission directly on emit (the outbox owns the entry)', async () => {
  await service.emit(dto, 'tenant-1', auth);
  expect(lifecycle.submit).toHaveBeenCalledTimes(1);
  expect(queues.add).not.toHaveBeenCalled();
});

it('an idempotent replay returns the stored invoice without submitting or enqueueing', async () => {
  const first = await service.emit(dto, 'tenant-1', auth, 'replay-key');
  lifecycle.submit.mockClear();
  repository.findByIdempotencyKey.mockResolvedValue(first);
  const repeated = await service.emit(dto, 'tenant-1', auth, 'replay-key');
  expect(repeated.id).toBe(first.id);
  expect(lifecycle.submit).not.toHaveBeenCalled();
  expect(queues.add).not.toHaveBeenCalled();
});

it('on a 23505 race returns the winner without enqueueing', async () => {
  const winner = await service.emit(dto, 'tenant-1', auth, 'race-key');
  lifecycle.submit.mockReset();
  lifecycle.submit.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
  repository.findByIdempotencyKey.mockReset();
  repository.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
  const result = await service.emit(dto, 'tenant-1', auth, 'race-key');
  expect(result).toBe(winner);
  expect(queues.add).not.toHaveBeenCalled();
});

it('on a 23505 race with a different payload throws IdempotencyConflictError', async () => {
  const winner = await service.emit(dto, 'tenant-1', auth, 'race-key-2');
  lifecycle.submit.mockReset();
  lifecycle.submit.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
  repository.findByIdempotencyKey.mockReset();
  repository.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
  await expect(
    service.emit({ ...dto, amount: 999 }, 'tenant-1', auth, 'race-key-2'),
  ).rejects.toBeInstanceOf(IdempotencyConflictError);
});
```
(importe `IdempotencyConflictError` de `../domain/errors`.)

e em um novo `invoice-lifecycle.service.spec.ts` (o `DataSource.transaction` fake executa o callback com um `manager` fake; `TypeOrmTransactionContext` é o real):

```ts
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { Invoice } from '../domain/invoice';
import { InvoiceEvent } from '../domain/invoice-event';
import { InvoiceEventOrmEntity } from '../infra/invoice-event.orm-entity';
import { InvoiceOrmEntity } from '../infra/invoice.orm-entity';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';

function build(outbox: { enqueue: jest.Mock }, order: string[] = []) {
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: (entity: unknown) => ({
      existsBy: jest.fn().mockResolvedValue(false),
      insert: jest.fn(async () => {
        order.push(entity === InvoiceOrmEntity ? 'invoice' : entity === InvoiceEventOrmEntity ? 'event' : 'other');
      }),
    }),
  };
  const database = {
    transaction: jest.fn(async (work: (m: unknown) => Promise<void>) => work(manager)),
  };
  const service = new InvoiceLifecycleService(
    database as never,
    { delete: jest.fn() } as never,
    { reserve: jest.fn(), settle: jest.fn() } as never,
    new TypeOrmTransactionContext(),
    outbox as never,
  );
  return { service, database };
}

const newInvoice = (scheduledFor?: Date) =>
  Invoice.create(
    {
      companyId,
      environment: 'test',
      customer: { taxId: '52998224725', name: 'Cliente' },
      service: { description: 'Servico', code: '060101', municipalityCode: '3550308' },
      amount: 50,
      competenceDate: new Date('2026-10-13'),
      scheduledFor,
    },
    tenantId,
  );

describe('InvoiceLifecycleService.submit + outbox', () => {
  it('enqueues invoice.emit after the invoice and event inserts, in the same transaction', async () => {
    const order: string[] = [];
    const outbox = { enqueue: jest.fn(async () => { order.push('outbox'); return true; }) };
    const { service, database } = build(outbox, order);
    const invoice = newInvoice();
    await service.submit(invoice, InvoiceEvent.create(invoice.id, null, 'queued'), null);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['invoice', 'event', 'outbox']);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        type: 'invoice.emit',
        aggregateId: invoice.id,
        dedupeKey: `emission:${invoice.id}`,
        payload: { invoiceId: invoice.id, companyId, tenantId },
      }),
    );
  });

  it('uses scheduledFor as availableAt for a scheduled invoice and "now" otherwise', async () => {
    const outbox = { enqueue: jest.fn().mockResolvedValue(true) };
    const { service } = build(outbox);
    const when = new Date('2099-10-14T03:00:00.000Z');
    const scheduled = newInvoice(when);
    await service.submit(scheduled, InvoiceEvent.create(scheduled.id, null, 'queued'), null);
    expect(outbox.enqueue.mock.calls[0][0].availableAt).toEqual(when);
    const immediate = newInvoice();
    await service.submit(immediate, InvoiceEvent.create(immediate.id, null, 'queued'), null);
    expect(outbox.enqueue.mock.calls[1][0].availableAt).toBeUndefined();
  });

  it('propagates an outbox failure so the surrounding transaction rolls back', async () => {
    const outbox = { enqueue: jest.fn().mockRejectedValue(new Error('db')) };
    const { service } = build(outbox);
    const invoice = newInvoice();
    await expect(
      service.submit(invoice, InvoiceEvent.create(invoice.id, null, 'queued'), null),
    ).rejects.toThrow('db');
  });
});
```

(O rollback real do banco é verificado no teste de Postgres da Task 7. `environment: 'test'` evita o ramo de carteira de créditos.)

- [ ] **Step 5: Run to verify they fail**

Run: `yarn jest src/modules/invoice/application`
Expected: FAIL.

- [ ] **Step 6: Implement lifecycle + service + wiring**

`invoice-lifecycle.service.ts`: injete `OutboxService` no construtor (`private readonly outbox: OutboxService`), importe `INVOICE_EMIT` de `./invoice-emit.handler` e, em `submit`, **depois** dos dois `insert` (invoice e evento) e ainda dentro do `this.context.run`:

```ts
          await this.outbox.enqueue({
            tenantId: invoice.tenantId,
            environment: invoice.environment,
            type: INVOICE_EMIT,
            aggregateId: invoice.id,
            payload: {
              invoiceId: invoice.id,
              companyId: invoice.companyId,
              tenantId: invoice.tenantId,
            },
            dedupeKey: `emission:${invoice.id}`,
            availableAt: invoice.scheduledFor ?? undefined,
          });
```

`invoice.service.ts`: em `emit()` remova as três chamadas `await this.enqueueEmission(...)` (replay idempotente, vencedor da corrida `23505`, e a final) e apague o método privado `enqueueEmission`. Passe `scheduledFor: normalized.scheduledFor` em `Invoice.create({...})`. `queueService` continua usado por `requestEmail`.

`invoice.module.ts`: `imports: [..., OutboxModule]`; `providers: [..., InvoiceEmitHandler, { provide: SCHEDULE_MAX_DAYS, useFactory: (config: ConfigService) => config.get<OutboxConfig>('outbox')?.scheduleMaxDays ?? 365, inject: [ConfigService] }]`. `worker-app.module.ts`: `imports: [..., OutboxRelayModule]` (importar de `@/modules/outbox/outbox.module`). O handler é registrado nos dois processos; só o worker roda o relay.

- [ ] **Step 7: Run to verify they pass; fix collateral specs**

Run: `yarn jest src/modules/invoice src/modules/outbox && yarn typecheck && yarn typecheck:tests`
Expected: PASS. Specs antigos que asseveravam `queueService.add` de `nfse-emission` no `emit()` devem ser atualizados para as asserções acima; construtores de `InvoiceLifecycleService` em specs ganham o argumento `outbox`.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat(invoice): enqueue emission through the outbox"
```

---

### Task 6: `DocsRecoveryScheduler` deixa de recuperar `queued`

**Files:**
- Modify: `src/modules/invoice/jobs/docs-recovery.scheduler.ts`
- Modify: `src/infra/persistence/typeorm/tenant-work-discovery.ts` (kind `invoice-recovery`)
- Test: `src/modules/invoice/jobs/docs-recovery.scheduler.spec.ts`

**Interfaces:**
- Consumes: nada novo. Produces: scheduler que só trata `processing`, `reconciliation_required` e `authorized` sem documentos.

- [ ] **Step 1: Write the failing tests** — acrescentar ao spec existente (ajuste o mock do `getRepository` para devolver um array configurável em `getMany` e capture o argumento de `where`):

```ts
it('does not query or re-enqueue queued invoices', async () => {
  const where = jest.fn().mockReturnThis();
  (scheduler as any).database = {
    getRepository: () => ({
      createQueryBuilder: () => ({
        where, andWhere: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(), getMany: async () => [],
      }),
    }),
  };
  await scheduler.handle();
  expect(where).toHaveBeenCalledWith('i.status IN (:...statuses)', {
    statuses: ['processing', 'reconciliation_required'],
  });
});

it('re-enqueues reconciliation for stuck processing and reconciliation_required invoices', async () => {
  (scheduler as any).database = {
    getRepository: () => ({
      createQueryBuilder: () => ({
        where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: async () => [
          { id: 'i1', tenantId: 'tenant-a', companyId: 'c1', status: 'processing' },
        ],
      }),
    }),
  };
  await scheduler.handle();
  expect(addMock).toHaveBeenCalledWith(
    'nfse-reconciliation', 'recover',
    { invoiceId: 'i1', tenantId: 'tenant-a', companyId: 'c1' },
    expect.objectContaining({ attempts: 5 }),
  );
});
```

Também adicione ao spec de `tenant-work-discovery` (se existir) ou a um teste simples do `discover` que o kind `invoice-recovery` não inclui `'queued'` — se não houver spec para isso, cubra apenas pelo teste do scheduler e pela leitura do SQL no passo 3.

- [ ] **Step 2: Run to verify it fails**

Run: `yarn jest src/modules/invoice/jobs/docs-recovery.scheduler.spec.ts`
Expected: FAIL (o `where` ainda inclui `queued`; hoje enfileira `nfse-emission` para queued).

- [ ] **Step 3: Implement**

`docs-recovery.scheduler.ts`: troque a lista de statuses para `['processing', 'reconciliation_required']` e o nome da fila fixo:

```ts
      const fiscal = await this.database
        .getRepository(InvoiceOrmEntity)
        .createQueryBuilder('i')
        .where('i.status IN (:...statuses)', {
          statuses: ['processing', 'reconciliation_required'],
        })
        .andWhere('i.updated_at < :cutoff AND i.tenant_id = :tenantId', { cutoff, tenantId })
        .take(50)
        .getMany();
      for (const i of fiscal)
        await this.queueService.add(
          'nfse-reconciliation',
          'recover',
          { invoiceId: i.id, tenantId: i.tenantId, companyId: i.companyId },
          { attempts: 5, backoffMs: 30000, removeOnComplete: true, removeOnFail: 1000 },
        );
```

Comentário curto acima: `// queued invoices are owned by the outbox (also protects SCHEDULE invoices from early emission).` Em `tenant-work-discovery.ts`, no ramo `invoice-recovery`, troque `"work.status IN ('queued','processing','reconciliation_required','authorized')"` por `"work.status IN ('processing','reconciliation_required','authorized')"`.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn jest src/modules/invoice src/infra/persistence && yarn typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "fix(invoice): leave queued recovery to the outbox"
```

---

### Task 7: Integração ponta a ponta, docs e verificação final

**Files:**
- Create: `src/modules/outbox/outbox-intake.postgres.integration.spec.ts`
- Modify: `api/FRONTEND_API.md`, `api/llms.txt` (na raiz do repositório: `FRONTEND_API.md` e `llms.txt` ficam em `api/`)
- Modify: Swagger já coberto por `@ApiPropertyOptional` (Task 4); confirmar em `src/infra/openapi`

**Interfaces:** Consumes todos os anteriores.

- [ ] **Step 1: Write the integration test** (harness da Task 2). Cenários, com `InvoiceLifecycleService` real (mesmo `runtime` DataSource, `TypeOrmTransactionContext` compartilhado, `BillingUsageService` e `CachePort` mockados) + `OutboxRelay` real com um `InvoiceEmitHandler` cuja `BullmqQueueService` é um fake que registra chamadas:

```ts
// Arrange (beforeAll, after the harness creates `admin`, `runtime`, `schema`, tenantA):
//   - INSERT INTO "${schema}".nfse_companies (id, tenant_id, legal_name, tax_id, environment)
//       VALUES (companyA, tenantA, 'Fixture', '11222333000181', 'test')
//     (se o plano fiscal-engine-core já foi aplicado, a coluna tax_regime não existe mais; senão inclua tax_regime = 'MEI')
const queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
const registry = new OutboxHandlerRegistry();
new InvoiceEmitHandler(queue as never, registry).onModuleInit();
const transactions = new TypeOrmTransactionContext();
const outboxRepo = new TypeOrmOutboxRepository(runtime, transactions);
const outbox = new OutboxService(outboxRepo);
const lifecycle = new InvoiceLifecycleService(
  runtime,
  { delete: jest.fn() } as never,
  { reserve: jest.fn(), settle: jest.fn() } as never,
  transactions,
  outbox,
);
const relay = new OutboxRelay(outboxRepo, registry, {
  get: () => ({ relayIntervalMs: 1000, batchSize: 50, leaseMs: 60000, maxAttempts: 5, scheduleMaxDays: 365 }),
} as never);

const submit = async (scheduledFor?: Date) => {
  const invoice = Invoice.create(
    {
      companyId: companyA, environment: 'test',
      customer: { taxId: '52998224725', name: 'Cliente' },
      service: { description: 'Servico', code: '060101', municipalityCode: '3550308' },
      amount: 50, competenceDate: new Date('2026-10-13'), scheduledFor,
    },
    tenantA,
  );
  await lifecycle.submit(invoice, InvoiceEvent.create(invoice.id, null, 'queued'), null);
  return invoice;
};
const messageStatus = (id: string) =>
  admin.query(`SELECT status, attempts FROM "${schema}".outbox_messages WHERE aggregate_id=$1`, [id]);

beforeEach(() => queue.add.mockClear());

it('IMMEDIATE: one transaction persists invoice + message; relay publishes once with the right jobId', async () => {
  const invoice = await submit();
  expect(await messageStatus(invoice.id)).toEqual([{ status: 'pending', attempts: 0 }]);
  await relay.tick(new Date());
  expect(queue.add).toHaveBeenCalledTimes(1);
  expect(queue.add).toHaveBeenCalledWith(
    'nfse-emission', 'process',
    { invoiceId: invoice.id, companyId: companyA, tenantId: tenantA },
    expect.objectContaining({ idempotencyKey: `emission-${invoice.id}` }),
  );
  expect((await messageStatus(invoice.id))[0].status).toBe('completed');
  await relay.tick(new Date());
  expect(queue.add).toHaveBeenCalledTimes(1);
});

it('SCHEDULE: the message is not published before scheduledFor and is published after', async () => {
  const now = new Date();
  const invoice = await submit(new Date(now.getTime() + 3_600_000));
  await relay.tick(now);
  expect(queue.add).not.toHaveBeenCalled();
  await relay.tick(new Date(now.getTime() + 2 * 3_600_000));
  expect(queue.add).toHaveBeenCalledTimes(1);
  expect((await messageStatus(invoice.id))[0].status).toBe('completed');
});

it('a failed publish is retried with backoff and the invoice row is untouched', async () => {
  const invoice = await submit();
  queue.add.mockRejectedValueOnce(new Error('redis down'));
  const t0 = new Date();
  await relay.tick(t0);
  expect(await messageStatus(invoice.id)).toEqual([{ status: 'pending', attempts: 1 }]);
  const [row] = await admin.query(`SELECT status FROM "${schema}".nfse_invoices WHERE id=$1`, [invoice.id]);
  expect(row.status).toBe('queued');
  await relay.tick(new Date(t0.getTime() + 3_000));
  expect(queue.add).toHaveBeenCalledTimes(2);
  expect((await messageStatus(invoice.id))[0].status).toBe('completed');
});

it('a second enqueue for the same invoice does not create a second message', async () => {
  const invoice = await submit();
  const again = await runWithTenant(tenantA, () =>
    outbox.enqueue({ tenantId: tenantA, environment: 'test', type: 'invoice.emit', aggregateId: invoice.id,
      payload: {}, dedupeKey: `emission:${invoice.id}` }),
  );
  expect(again).toBe(false);
  const [count] = await admin.query(`SELECT count(*)::int AS n FROM "${schema}".outbox_messages WHERE aggregate_id=$1`, [invoice.id]);
  expect(count.n).toBe(1);
});

it('a failing outbox insert rolls the invoice back (no orphan invoice)', async () => {
  const broken = new InvoiceLifecycleService(runtime, { delete: jest.fn() } as never,
    { reserve: jest.fn(), settle: jest.fn() } as never, transactions,
    { enqueue: jest.fn().mockRejectedValue(new Error('outbox down')) } as never);
  const invoice = Invoice.create({ companyId: companyA, environment: 'test',
    customer: { taxId: '52998224725', name: 'Cliente' },
    service: { description: 'S', code: '060101', municipalityCode: '3550308' },
    amount: 50, competenceDate: new Date('2026-10-13') }, tenantA);
  await expect(broken.submit(invoice, InvoiceEvent.create(invoice.id, null, 'queued'), null)).rejects.toThrow('outbox down');
  const rows = await admin.query(`SELECT id FROM "${schema}".nfse_invoices WHERE id=$1`, [invoice.id]);
  expect(rows).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails / then passes** after ajustes mínimos de harness

Run: `MIGRATION_TEST_DATABASE_URL=… yarn jest src/modules/outbox/outbox-intake.postgres.integration.spec.ts`
Expected: PASS.

- [ ] **Step 3: Documentation** — `FRONTEND_API.md` e `llms.txt`: documentar `options.type` (`IMMEDIATE` padrão | `SCHEDULE`), `scheduledFor` na resposta, o erro `422 schedule_horizon_exceeded` e que invoices agendadas ficam `queued` até a data.

- [ ] **Step 4: Full verification**

Run, nesta ordem:
```bash
yarn lint:check
yarn typecheck && yarn typecheck:tests
yarn test --runInBand
MIGRATION_TEST_DATABASE_URL=postgres://…_test yarn jest postgres.integration
yarn test:fiscal:integration
```
Expected: tudo verde. Falhas fora do escopo devem ser relatadas, não mascaradas.

- [ ] **Step 5: Commit**

```bash
git add src FRONTEND_API.md llms.txt
git commit -m "test(outbox): intake integration and API docs"
```
