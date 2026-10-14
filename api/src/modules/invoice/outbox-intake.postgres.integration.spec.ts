import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmOutboxRepository } from './infra/typeorm-outbox.repository';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Invoice } from './domain/invoice';
import { InvoiceEvent } from './domain/invoice-event';
import { InvoiceLifecycleService } from './application/invoice-lifecycle.service';
import { OutboxService } from './application/outbox.service';
import { OutboxRelay } from './application/outbox-relay';
import { OutboxHandlerRegistry } from './application/outbox-handler.registry';
import { InvoiceEmitHandler } from './application/invoice-emit.handler';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import type { CachePort } from '@/infra/redis/cache.port';
const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('RLS integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `OutboxIntake_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID(),
  tenantB = randomUUID();
describePostgres('invoice intake with restricted PostgreSQL role', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let repo: TypeOrmOutboxRepository;
  const companyA = randomUUID();
  const companyLive = randomUUID();
  const transactions = new TypeOrmTransactionContext();
  const queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
  const cache = { delete: jest.fn() } as unknown as CachePort;
  const usage = {
    reserve: jest.fn().mockResolvedValue(null),
    settle: jest.fn(),
  };
  let outbox: OutboxService;
  let lifecycle: InvoiceLifecycleService;
  let relay: OutboxRelay;
  const registry = new OutboxHandlerRegistry();
  const config = new ConfigService({
    outbox: {
      relayIntervalMs: 1000,
      batchSize: 50,
      leaseMs: 60000,
      maxAttempts: 2,
      scheduleMaxDays: 365,
    },
  });
  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    admin = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();
    await admin.query(`INSERT INTO "${schema}".tenants (id) VALUES ($1),($2)`, [
      tenantA,
      tenantB,
    ]);
    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    const [owner]: Array<{ role: string }> = await admin.query(
      'SELECT current_user AS role',
    );
    if (!owner) throw new Error('Migration owner was not returned');
    // Exercise the reviewed provisioning artifact, including a repeated invocation.
    for (let index = 0; index < 2; index++)
      execFileSync(
        'psql',
        [
          url,
          '-w',
          '-v',
          `runtime_role=${role}`,
          '-v',
          `migration_role=${owner.role}`,
          '-v',
          `app_schema=${schema}`,
          '-f',
          resolve(process.cwd(), 'scripts/provision-runtime-role.sql'),
        ],
        { stdio: 'pipe' },
      );
    const runtimeUrl = new URL(url);
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    const options = createTypeOrmOptions({
      url: runtimeUrl.toString(),
      schema,
      ssl: false,
      logging: false,
    });
    runtime = new DataSource({
      ...options,
      extra: { ...options.extra, max: 4 },
    });
    await runtime.initialize();
    installRlsConnectionScope(runtime);
    repo = new TypeOrmOutboxRepository(runtime, transactions);
    for (const [id, environment] of [
      [companyA, 'test'],
      [companyLive, 'live'],
    ])
      await admin.query(
        `INSERT INTO "${schema}".nfse_companies (id, tenant_id, legal_name, tax_id, environment, tax_regime) VALUES ($1,$2,'Fixture','11222333000181',$3,'MEI')`,
        [id, tenantA, environment],
      );
    outbox = new OutboxService(repo);
    lifecycle = new InvoiceLifecycleService(
      runtime,
      cache,
      usage as unknown as BillingUsageService,
      transactions,
      outbox,
    );
    new InvoiceEmitHandler(
      queue as unknown as BullmqQueueService,
      registry,
    ).onModuleInit();
    relay = new OutboxRelay(repo, registry, config);
  }, 60000);
  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });
  beforeEach(async () => {
    queue.add.mockReset().mockResolvedValue({ id: 'job' });
    usage.reserve.mockClear();
    await admin.query(`TRUNCATE "${schema}".outbox_messages`);
  });
  const create = (
    scheduledFor?: Date,
    environment: 'test' | 'live' = 'test',
    idempotencyKey?: string,
  ) =>
    Invoice.create(
      {
        companyId: environment === 'live' ? companyLive : companyA,
        environment,
        customer: { taxId: '52998224725', name: 'Cliente' },
        service: {
          description: 'Servico',
          code: '060101',
          municipalityCode: '3550308',
        },
        amount: 50,
        competenceDate: new Date('2026-10-13'),
        scheduledFor,
      },
      tenantA,
      idempotencyKey,
    );
  const submit = async (scheduledFor?: Date) => {
    const invoice = create(scheduledFor);
    await lifecycle.submit(
      invoice,
      InvoiceEvent.create(invoice.id, null, 'queued'),
      null,
    );
    return invoice;
  };
  const messageStatus = (id: string) =>
    admin.query<Array<{ status: string; attempts: number }>>(
      `SELECT status, attempts FROM "${schema}".outbox_messages WHERE aggregate_id=$1`,
      [id],
    );
  it('atomically persists invoice/event/message and publishes once with stable job id', async () => {
    const invoice = await submit();
    expect(await messageStatus(invoice.id)).toEqual([
      { status: 'pending', attempts: 0 },
    ]);
    expect(
      await admin.query(
        `SELECT to_status FROM "${schema}".nfse_invoice_events WHERE invoice_id=$1`,
        [invoice.id],
      ),
    ).toEqual([{ to_status: 'queued' }]);
    await relay.tick();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'nfse-emission',
      'process',
      { invoiceId: invoice.id, companyId: companyA, tenantId: tenantA },
      expect.objectContaining({ idempotencyKey: `emission-${invoice.id}` }),
    );
    expect(await messageStatus(invoice.id)).toEqual([
      { status: 'completed', attempts: 1 },
    ]);
    await relay.tick();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
  it('keeps scheduled invoice queued until the exact due instant', async () => {
    const due = new Date(Date.now() + 3600000);
    const invoice = await submit(due);
    await relay.tick(new Date(due.getTime() - 1));
    expect(queue.add).not.toHaveBeenCalled();
    expect(
      await admin.query(
        `SELECT status, scheduled_for FROM "${schema}".nfse_invoices WHERE id=$1`,
        [invoice.id],
      ),
    ).toEqual([{ status: 'queued', scheduled_for: due }]);
    await relay.tick(due);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(await messageStatus(invoice.id)).toEqual([
      { status: 'completed', attempts: 1 },
    ]);
  });
  it('retries only after backoff, then succeeds without changing invoice', async () => {
    const invoice = await submit();
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    const now = new Date();
    await relay.tick(now);
    expect(await messageStatus(invoice.id)).toEqual([
      { status: 'pending', attempts: 1 },
    ]);
    const [row] = await admin.query<Array<{ available_at: Date }>>(
      `SELECT available_at FROM "${schema}".outbox_messages WHERE aggregate_id=$1`,
      [invoice.id],
    );
    if (!row) throw new Error('Expected retry message');
    await relay.tick(new Date(row.available_at.getTime() - 1));
    expect(queue.add).toHaveBeenCalledTimes(1);
    await relay.tick(row.available_at);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(await messageStatus(invoice.id)).toEqual([
      { status: 'completed', attempts: 2 },
    ]);
    expect(
      await admin.query(
        `SELECT status FROM "${schema}".nfse_invoices WHERE id=$1`,
        [invoice.id],
      ),
    ).toEqual([{ status: 'queued' }]);
  });
  it('exhausted retries become dead with diagnostics and leave invoice queued', async () => {
    const invoice = await submit();
    queue.add.mockRejectedValue(new Error('redis down'));
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      const now = new Date();
      await relay.tick(now);
      await relay.tick(new Date(Date.now() + 3000));
      expect(await messageStatus(invoice.id)).toEqual([
        { status: 'dead', attempts: 2 },
      ]);
      expect(logger).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: invoice.id,
          tenantId: tenantA,
          attempts: 2,
        }),
        'Outbox message is dead',
      );
      await relay.tick(new Date(now.getTime() + 60000));
      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(
        await admin.query(
          `SELECT status FROM "${schema}".nfse_invoices WHERE id=$1`,
          [invoice.id],
        ),
      ).toEqual([{ status: 'queued' }]);
    } finally {
      logger.mockRestore();
    }
  });
  it('deduplicates a second enqueue', async () => {
    const invoice = await submit();
    expect(
      await runWithTenant(tenantA, () =>
        outbox.enqueue({
          tenantId: tenantA,
          environment: 'test',
          type: 'invoice.emit',
          aggregateId: invoice.id,
          payload: {},
          dedupeKey: `emission:${invoice.id}`,
        }),
      ),
    ).toBe(false);
    expect(await messageStatus(invoice.id)).toHaveLength(1);
  });
  it('two concurrent real relay instances publish one claimed message', async () => {
    const invoice = await submit();
    await Promise.all([
      relay.tick(),
      new OutboxRelay(repo, registry, config).tick(),
    ]);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(await messageStatus(invoice.id)).toEqual([
      { status: 'completed', attempts: 1 },
    ]);
  });
  it('concurrent idempotent lifecycle intake commits one invoice/event/message', async () => {
    const key = randomUUID();
    const first = create(undefined, 'test', key);
    const second = create(undefined, 'test', key);
    const results = await Promise.allSettled(
      [first, second].map((invoice) =>
        lifecycle.submit(
          invoice,
          InvoiceEvent.create(invoice.id, null, 'queued'),
          null,
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toEqual(
      expect.objectContaining({
        reason: expect.objectContaining({ code: '23505' }),
      }),
    );
    expect(
      await admin.query(
        `SELECT id FROM "${schema}".nfse_invoices WHERE idempotency_key=$1`,
        [key],
      ),
    ).toHaveLength(1);
    expect(
      await admin.query(
        `SELECT id FROM "${schema}".nfse_invoice_events WHERE invoice_id IN ($1,$2)`,
        [first.id, second.id],
      ),
    ).toHaveLength(1);
    expect(
      await admin.query(
        `SELECT id FROM "${schema}".outbox_messages WHERE aggregate_id IN ($1,$2)`,
        [first.id, second.id],
      ),
    ).toHaveLength(1);
  });
  it('failed real outbox insert rolls back live invoice/event/credit reservation', async () => {
    const invoice = create(undefined, 'live');
    // Trigger a database failure after credit, invoice and event have been inserted.
    await admin.query(
      `CREATE FUNCTION "${schema}".reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbox down'; END $$`,
    );
    await admin.query(
      `CREATE TRIGGER reject_outbox BEFORE INSERT ON "${schema}".outbox_messages FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_outbox()`,
    );
    try {
      await expect(
        lifecycle.submit(
          invoice,
          InvoiceEvent.create(invoice.id, null, 'queued'),
          null,
        ),
      ).rejects.toThrow('outbox down');
      expect(usage.reserve).toHaveBeenCalledWith(tenantA);
      for (const [table, column] of [
        ['nfse_invoices', 'id'],
        ['nfse_invoice_events', 'invoice_id'],
        ['credit_transactions', 'reserved_invoice_id'],
        ['outbox_messages', 'aggregate_id'],
      ])
        expect(
          await admin.query(
            `SELECT id FROM "${schema}"."${table}" WHERE "${column}"=$1`,
            [invoice.id],
          ),
        ).toEqual([]);
      expect(queue.add).not.toHaveBeenCalled();
    } finally {
      await admin.query(
        `DROP TRIGGER reject_outbox ON "${schema}".outbox_messages`,
      );
      await admin.query(`DROP FUNCTION "${schema}".reject_outbox()`);
    }
  });
});
