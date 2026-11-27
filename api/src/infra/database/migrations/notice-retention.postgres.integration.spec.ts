import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import { runRetentionRule } from '@/infra/retention/data-retention';
import { noticeRetentionRules } from '@/infra/retention/notice-retention';
import { IntegrationOperationOrmEntity } from '@/modules/integrations/infra/integration-operation.orm-entity';
import { TypeOrmIntegrationOperationRepository } from '@/modules/integrations/infra/typeorm-integration-operation.repository';
import { createTypeOrmOptions } from '../typeorm.options';
import { IndexNoticeRetention1793900000000 } from './1793900000000-IndexNoticeRetention';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Migration tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `notice_ret_${randomUUID().replaceAll('-', '')}`;
const now = new Date('2027-01-01T07:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(now.getTime() - days * DAY);

/** The notice cleanup against a real Postgres: what goes, what stays, dry run, and the index migration. */
describePostgres('notice retention', () => {
  let db: DataSource;
  let tenant: string;
  let config: string;
  let connection: string;
  const t = (name: string) => `"${schema}".${name}`;

  const run = (enabled: boolean) =>
    runAsSystem('data_retention', async () => {
      for (const rule of noticeRetentionRules(`"${schema}"`, now))
        await runRetentionRule(db, rule, enabled, () => undefined);
    });
  const one = async <T>(sql: string, params: unknown[]): Promise<T> =>
    (await db.query<T[]>(sql, params))[0] ?? (null as T);

  /** Seeds skip foreign keys (a connection needs a whole company); the cleanup never reads them. */
  const seed = async (sql: string, params: unknown[]): Promise<void> => {
    const runner = db.createQueryRunner();
    try {
      await runner.query(`SET session_replication_role = replica`);
      await runner.query(sql, params);
    } finally {
      await runner.query(`SET session_replication_role = DEFAULT`);
      await runner.release();
    }
  };

  const delivery = async (
    status: string,
    ageDays: number,
    opts: { payload?: boolean } = {},
  ): Promise<string> => {
    const id = randomUUID();
    await seed(
      `INSERT INTO ${t('webhook_deliveries')} (id, tenant_id, webhook_config_id, invoice_id, event_type, url, payload, status_code, response_body, status, retry_count, created_at)
       VALUES ($1,$2,$3,$4,'nfse.invoice.authorized','https://customer.test/hook',$5,200,'ok',$6,2,$7)`,
      [
        id,
        tenant,
        config,
        randomUUID(),
        opts.payload === false ? null : '{"id":"evt"}',
        status,
        ago(ageDays),
      ],
    );
    return id;
  };
  const deliveryRow = (id: string) =>
    one<{
      payload: unknown;
      response_body: string | null;
      status: string;
      status_code: number;
      retry_count: number;
      invoice_id: string;
      url: string;
    } | null>(`SELECT * FROM ${t('webhook_deliveries')} WHERE id = $1`, [id]);

  const operation = async (opts: {
    ageDays: number;
    invoiceId?: string | null;
    fiscal: string;
    block?: string | null;
    key?: string;
    refs?: Record<string, string>;
  }): Promise<string> => {
    const id = randomUUID();
    const snapshot = {
      operationKey: opts.key ?? `charge:${id}`,
      commercialState: 'paid',
      externalRefs: opts.refs ?? { pixEndToEndId: `E-${id}` },
      occurredAt: ago(opts.ageDays).toISOString(),
      paidAt: ago(opts.ageDays).toISOString(),
      currency: 'BRL',
      amountCents: 4990,
      discountCents: 0,
      customer: {
        name: 'Maria',
        email: 'maria@example.com',
        taxId: '52998224725',
        taxIdMasked: false,
      },
      items: [
        {
          externalProductId: 'prod-1',
          description: 'Consultoria',
          quantity: 2,
        },
      ],
      description: 'Consultoria',
      serviceOverride: { description: 'Servico' },
      sendEmailOverride: true,
      sellerIssuesInvoice: true,
    };
    await seed(
      `INSERT INTO ${t('integration_operations')} (id, tenant_id, connection_id, provider, environment, external_account_id, operation_key, commercial_state, fiscal_status, block_reason, snapshot, emission_request, emission_request_hash, idempotency_key, invoice_id, created_at, updated_at)
       VALUES ($1,$2,$3,'fake','live','acc',$4,'paid',$5,$6,$7,'{"customer":{"name":"Maria"}}','hash-1','idem-1',$8,$9,$9)`,
      [
        id,
        tenant,
        connection,
        snapshot.operationKey,
        opts.fiscal,
        opts.block ?? null,
        JSON.stringify(snapshot),
        opts.invoiceId === undefined ? randomUUID() : opts.invoiceId,
        ago(opts.ageDays),
      ],
    );
    return id;
  };
  const operationRow = (id: string) =>
    one<{
      snapshot: Record<string, unknown>;
      emission_request: unknown;
      emission_request_hash: string;
      idempotency_key: string;
      operation_key: string;
      invoice_id: string | null;
    }>(`SELECT * FROM ${t('integration_operations')} WHERE id = $1`, [id]);

  beforeAll(async () => {
    if (!url) throw new Error('Test database URL is required');
    db = new DataSource(
      createTypeOrmOptions({ url, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    tenant = randomUUID();
    config = randomUUID();
    connection = randomUUID();
    await db.query(`INSERT INTO ${t('tenants')} (id) VALUES ($1)`, [tenant]);
  }, 120000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('webhook deliveries: dry run changes nothing; enabled erases sent after 30 days and deletes failed after 90', async () => {
    const sent31 = await delivery('sent', 31);
    const sent29 = await delivery('sent', 29);
    const failed91 = await delivery('failed', 91);
    const failed89 = await delivery('failed', 89);
    const live = await Promise.all(
      ['pending', 'delayed', 'manual_retry'].map((status) =>
        delivery(status, 400),
      ),
    );

    await run(false);
    expect((await deliveryRow(sent31))?.payload).not.toBeNull();
    expect(await deliveryRow(failed91)).not.toBeNull();

    await run(true);
    const erased = await deliveryRow(sent31);
    expect(erased).toMatchObject({
      payload: null,
      response_body: null,
      status: 'sent',
      status_code: 200,
      retry_count: 2,
      url: 'https://customer.test/hook',
    });
    expect(erased?.invoice_id).toBeTruthy();
    expect((await deliveryRow(sent29))?.payload).not.toBeNull();
    expect((await deliveryRow(sent29))?.response_body).toBe('ok');
    expect(await deliveryRow(failed91)).toBeNull();
    expect(await deliveryRow(failed89)).not.toBeNull();
    for (const id of live) {
      const row = await deliveryRow(id);
      expect(row?.payload).not.toBeNull();
      expect(row?.response_body).toBe('ok');
    }
    // A second night finds nothing left to do for the erased row.
    const [sentRule] = noticeRetentionRules(`"${schema}"`, now);
    const again = await runAsSystem('data_retention', () =>
      runRetentionRule(db, sentRule, true, () => undefined),
    );
    expect(again.matched).toBe(0);
  });

  it('payment inbox: erases the payload of processed/ignored after 30 days, keeps the event id and hash', async () => {
    const add = async (status: string, ageDays: number) => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO ${t('webhook_events')} (id, provider, provider_event_id, event_type, payload, payload_sha256, status, available_at, received_at, processed_at)
         VALUES ($1,'woovi',$2,'charge.paid','{"a":1}',$3,$4,$5,$5,$6)`,
        [
          id,
          `ev-${id}`,
          'a'.repeat(64),
          status,
          ago(ageDays),
          ['processed', 'ignored'].includes(status) ? ago(ageDays) : null,
        ],
      );
      return id;
    };
    const row = (id: string) =>
      one<{
        payload: unknown;
        provider_event_id: string;
        payload_sha256: string;
        status: string;
      }>(`SELECT * FROM ${t('webhook_events')} WHERE id = $1`, [id]);
    const processed31 = await add('processed', 31);
    const ignored31 = await add('ignored', 31);
    const processed29 = await add('processed', 29);
    const others = await Promise.all(
      ['received', 'processing', 'failed', 'manual_review'].map((s) =>
        add(s, 200),
      ),
    );
    await run(false);
    expect((await row(processed31)).payload).not.toBeNull();
    await run(true);
    for (const id of [processed31, ignored31]) {
      const erased = await row(id);
      expect(erased.payload).toBeNull();
      expect(erased.provider_event_id).toBe(`ev-${id}`);
      expect(erased.payload_sha256).toBe('a'.repeat(64));
    }
    expect((await row(processed29)).payload).not.toBeNull();
    for (const id of others) expect((await row(id)).payload).not.toBeNull();
    // The event is still known: inserting it again is a duplicate (unique provider + event id).
    await expect(
      db.query(
        `INSERT INTO ${t('webhook_events')} (id, provider, provider_event_id, event_type, payload_sha256, status, available_at, received_at)
         VALUES ($1,'woovi',$2,'charge.paid',$3,'received',now(),now())`,
        [randomUUID(), `ev-${processed31}`, 'b'.repeat(64)],
      ),
    ).rejects.toThrow(/uq_webhook_events_provider_event/);
  });

  it('platform inbox: empties the body of processed/ignored after 30 days, keeps delivery_id and the unique key', async () => {
    const add = async (state: string, ageDays: number) => {
      const id = randomUUID();
      await seed(
        `INSERT INTO ${t('integration_events')} (id, tenant_id, connection_id, provider, environment, external_account_id, delivery_id, external_type, payload_enc, state, attempts, updated_at)
         VALUES ($1,$2,$3,'fake','live','acc',$4,'paid','enc:secret',$5,1,$6)`,
        [id, tenant, connection, `d-${id}`, state, ago(ageDays)],
      );
      return id;
    };
    const row = (id: string) =>
      one<{ payload_enc: string; delivery_id: string; state: string }>(
        `SELECT * FROM ${t('integration_events')} WHERE id = $1`,
        [id],
      );
    const processed31 = await add('processed', 31);
    const ignored31 = await add('ignored', 31);
    const processed29 = await add('processed', 29);
    const others = await Promise.all(
      [
        'received',
        'processing',
        'retry_pending',
        'needs_attention',
        'dead',
      ].map((s) => add(s, 200)),
    );
    await run(false);
    expect((await row(processed31)).payload_enc).toBe('enc:secret');
    await run(true);
    for (const id of [processed31, ignored31]) {
      const erased = await row(id);
      expect(erased.payload_enc).toBe('');
      expect(erased.delivery_id).toBe(`d-${id}`);
    }
    expect((await row(processed29)).payload_enc).toBe('enc:secret');
    for (const id of others)
      expect((await row(id)).payload_enc).toBe('enc:secret');
    await expect(
      seed(
        `INSERT INTO ${t('integration_events')} (tenant_id, connection_id, provider, environment, external_account_id, delivery_id, external_type, payload_enc)
         VALUES ($1,$2,'fake','live','acc',$3,'paid','new')`,
        [tenant, connection, `d-${processed31}`],
      ),
    ).rejects.toThrow(/uq_integration_events_delivery/);
  });

  it('sales: only finished ones after 90 days are erased; waiting, blocked and refund/cancel ones are not', async () => {
    const issued = await operation({
      ageDays: 100,
      fiscal: 'submitted',
      key: 'charge:issued',
      refs: { pixEndToEndId: 'E-ISSUED' },
    });
    const ignored = await operation({
      ageDays: 100,
      fiscal: 'blocked',
      block: 'ignored_by_user',
      invoiceId: null,
    });
    const recent = await operation({ ageDays: 80, fiscal: 'submitted' });
    const keep = await Promise.all([
      operation({
        ageDays: 400,
        fiscal: 'needs_attention',
        block: 'customer_tax_id_missing',
        invoiceId: null,
      }),
      operation({
        ageDays: 400,
        fiscal: 'submitted',
        block: 'refund_after_invoice',
      }),
      operation({
        ageDays: 400,
        fiscal: 'submitted',
        block: 'cancel_requested',
      }),
      operation({
        ageDays: 400,
        fiscal: 'needs_attention',
        block: 'cancel_failed',
      }),
      operation({ ageDays: 400, fiscal: 'none', invoiceId: null }),
      operation({
        ageDays: 400,
        fiscal: 'blocked',
        block: 'not_paid',
        invoiceId: null,
      }),
    ]);

    await run(false);
    expect((await operationRow(issued)).snapshot.customer).not.toBeNull();

    await run(true);
    for (const id of [issued, ignored]) {
      const row = await operationRow(id);
      expect(row.snapshot).toMatchObject({
        erased: true,
        customer: null,
        commercialState: 'paid',
        amountCents: 4990,
        currency: 'BRL',
        sellerIssuesInvoice: true,
        items: [
          { externalProductId: 'prod-1', description: null, quantity: 2 },
        ],
      });
      expect(row.snapshot).not.toHaveProperty('description');
      expect(row.snapshot).not.toHaveProperty('serviceOverride');
      expect(row.snapshot).not.toHaveProperty('sendEmailOverride');
      expect(JSON.stringify(row.snapshot)).not.toMatch(
        /Maria|52998224725|example\.com|Consultoria/,
      );
      expect(row.emission_request).toBeNull();
      expect(row.emission_request_hash).toBe('hash-1');
      expect(row.idempotency_key).toBe('idem-1');
      expect(row.snapshot.operationKey).toBe(row.operation_key);
    }
    expect((await operationRow(issued)).invoice_id).not.toBeNull();
    for (const id of [recent, ...keep]) {
      const row = await operationRow(id);
      expect(row.snapshot).not.toHaveProperty('erased');
      expect(row.snapshot.customer).not.toBeNull();
      expect(row.emission_request).not.toBeNull();
    }
  });

  it('a late refund still finds its erased sale by the platform reference and moves it to refunded', async () => {
    const id = await operation({
      ageDays: 120,
      fiscal: 'submitted',
      key: 'charge:late-refund',
      refs: { pixEndToEndId: 'E-LATE' },
    });
    await run(true);
    expect((await operationRow(id)).snapshot).toHaveProperty('erased', true);

    const repo = new TypeOrmIntegrationOperationRepository(
      db.getRepository(IntegrationOperationOrmEntity),
    );
    const sale = await repo.findByExternalRef({
      tenantId: tenant,
      connectionId: connection,
      ref: 'pixEndToEndId',
      value: 'E-LATE',
    });
    expect(sale?.id).toBe(id);
    expect(sale?.invoiceId).not.toBeNull();

    // What the event handler does next: the sale's own snapshot with the refunded state.
    const refunded = await repo.upsertFromNormalized({
      tenantId: tenant,
      connectionId: connection,
      provider: 'fake',
      environment: 'live',
      externalAccountId: 'acc',
      normalized: {
        ...sale!.snapshot,
        commercialState: 'refunded',
        occurredAt: new Date(now.getTime() + DAY),
      },
    });
    expect(refunded.id).toBe(id);
    expect(refunded.commercialState).toBe('refunded');
    expect(refunded.invoiceId).toBe(sale?.invoiceId);
    expect(refunded.operationKey).toBe('charge:late-refund');
  });

  it('deletes and erases in batches, more rows than one batch', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(await delivery('sent', 45));
    const [sentRule] = noticeRetentionRules(`"${schema}"`, now);
    const out = await runAsSystem('data_retention', () =>
      runRetentionRule(db, sentRule, true, () => undefined, {
        batchSize: 10,
        maxBatches: 100,
      }),
    );
    expect(out.deleted).toBe(25);
    for (const id of ids) expect((await deliveryRow(id))?.payload).toBeNull();
  });

  it('migration down drops the indexes and up creates them again', async () => {
    const count = async (): Promise<number> => {
      const rows: unknown[] = await db.query(
        `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname IN ('idx_webhook_deliveries_finished','idx_integration_events_finished')`,
        [schema],
      );
      return rows.length;
    };
    expect(await count()).toBe(2);
    const migration = new IndexNoticeRetention1793900000000();
    const runner = db.createQueryRunner();
    try {
      await migration.down(runner);
      expect(await count()).toBe(0);
      await migration.up(runner);
      expect(await count()).toBe(2);
    } finally {
      await runner.release();
    }
  });
});
