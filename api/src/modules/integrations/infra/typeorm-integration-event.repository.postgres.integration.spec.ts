import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { TypeOrmIntegrationEventRepository } from './typeorm-integration-event.repository';
import { IntegrationEventOrmEntity } from './integration-event.orm-entity';
import type { NewIntegrationEvent } from '../domain/integration-event.repository';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Integrations tests require a local _test database');
const describePostgres = url ? describe : describe.skip;
jest.setTimeout(60_000);
const schema = `integ_claim_${randomUUID().replaceAll('-', '')}`;
const tenant = randomUUID();
const company = randomUUID();
const connectionId = randomUUID();

describePostgres('integration event claims on real PostgreSQL', () => {
  let db: DataSource;
  let repo: TypeOrmIntegrationEventRepository;
  const t = (name: string) => `"${schema}"."${name}"`;

  const event = (deliveryId: string): NewIntegrationEvent => ({
    tenantId: tenant,
    connectionId,
    provider: 'woovi',
    environment: 'test',
    externalAccountId: 'acc',
    deliveryId,
    externalType: 'paid',
    payloadEnc: 'enc',
    state: 'received',
  });

  beforeAll(async () => {
    db = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    await db.query(`INSERT INTO ${t('tenants')} (id) VALUES ($1)`, [tenant]);
    await db.query(
      `INSERT INTO ${t('nfse_companies')} (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'F','11222333000181','test')`,
      [company, tenant],
    );
    await db.query(
      `INSERT INTO ${t('integration_connections')} (id,tenant_id,company_id,public_id,provider,environment,external_account_id,state,credentials_enc) VALUES ($1,$2,$3,'pub','woovi','test','acc','active','enc')`,
      [connectionId, tenant, company],
    );
    repo = new TypeOrmIntegrationEventRepository(
      db.getRepository(IntegrationEventOrmEntity),
    );
  });
  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.destroy();
  });
  beforeEach(() => db.query(`DELETE FROM ${t('integration_events')}`));

  it('insertReceived reports created once and duplicate afterwards', async () => {
    await expect(repo.insertReceived(event('d1'))).resolves.toMatchObject({
      created: true,
    });
    await expect(repo.insertReceived(event('d1'))).resolves.toMatchObject({
      created: false,
    });
    const [{ count }] = await db.query(
      `SELECT count(*)::int AS count FROM ${t('integration_events')}`,
    );
    expect(count).toBe(1);
  });

  it('two concurrent inserts of the same delivery produce one row', async () => {
    const results = await Promise.all([
      repo.insertReceived(event('race')),
      repo.insertReceived(event('race')),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it('two concurrent claimBatch calls never return the same event', async () => {
    for (let i = 0; i < 10; i++) await repo.insertReceived(event(`c${i}`));
    const [a, b] = await Promise.all([
      repo.claimBatch(6, 60_000, new Date()),
      repo.claimBatch(6, 60_000, new Date()),
    ]);
    const ids = [...a, ...b].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(10);
    expect([...a, ...b].every((e) => e.attempts === 1 && e.claimToken)).toBe(
      true,
    );
  });

  it('an event with an expired lease is claimed again with a new token', async () => {
    await repo.insertReceived(event('lease'));
    const [first] = await repo.claimBatch(5, 1000, new Date());
    expect(await repo.claimBatch(5, 1000, new Date())).toHaveLength(0);
    const later = new Date(Date.now() + 5000);
    const [second] = await repo.claimBatch(5, 1000, later);
    expect(second.id).toBe(first.id);
    expect(second.claimToken).not.toBe(first.claimToken);
    expect(second.attempts).toBe(2);
  });

  it('markResult with a stale claimToken returns false and leaves the row untouched', async () => {
    await repo.insertReceived(event('stale'));
    const [first] = await repo.claimBatch(5, 1000, new Date());
    const [second] = await repo.claimBatch(
      5,
      1000,
      new Date(Date.now() + 5000),
    );
    await expect(repo.markResult(first, { state: 'processed' })).resolves.toBe(
      false,
    );
    const rows: Array<{ state: string }> = await db.query(
      `SELECT state FROM ${t('integration_events')} WHERE id=$1`,
      [first.id],
    );
    expect(rows[0].state).toBe('processing');
    await expect(repo.markResult(second, { state: 'processed' })).resolves.toBe(
      true,
    );
    const [done] = await db.query(
      `SELECT state, claim_token FROM ${t('integration_events')} WHERE id=$1`,
      [first.id],
    );
    expect(done).toMatchObject({ state: 'processed', claim_token: null });
  });

  it('resolveAttention turns waiting notices of that operation into processed and touches nothing else', async () => {
    const operationA = randomUUID();
    const operationB = randomUUID();
    for (const [delivery, op] of [
      ['a1', operationA],
      ['a2', operationA],
      ['b1', operationB],
    ] as const) {
      await repo.insertReceived(event(delivery));
      await db.query(
        `UPDATE ${t('integration_events')} SET state='needs_attention', last_error='customer_tax_id_missing' WHERE delivery_id=$1`,
        [delivery],
      );
      await db.query(
        `INSERT INTO ${t('integration_operations')} (id, tenant_id, connection_id, provider, environment, external_account_id, operation_key, commercial_state, snapshot) VALUES ($1,$2,$3,'woovi','test','acc',$4,'paid','{}') ON CONFLICT DO NOTHING`,
        [op, tenant, connectionId, `k-${op}`],
      );
      await db.query(
        `UPDATE ${t('integration_events')} SET operation_id=$1 WHERE delivery_id=$2`,
        [op, delivery],
      );
    }
    await db.query(
      `UPDATE ${t('integration_events')} SET state='processed', last_error=NULL WHERE delivery_id='a2'`,
    );
    await repo.resolveAttention(operationA, tenant);
    const rows: Array<{
      delivery_id: string;
      state: string;
      last_error: string | null;
    }> = await db.query(
      `SELECT delivery_id, state, last_error FROM ${t('integration_events')} ORDER BY delivery_id`,
    );
    expect(rows).toEqual([
      { delivery_id: 'a1', state: 'processed', last_error: null },
      { delivery_id: 'a2', state: 'processed', last_error: null },
      {
        delivery_id: 'b1',
        state: 'needs_attention',
        last_error: 'customer_tax_id_missing',
      },
    ]);
  });

  it('does not claim events that are not yet due', async () => {
    await repo.insertReceived(event('future'));
    await db.query(
      `UPDATE ${t('integration_events')} SET next_attempt_at = now() + interval '1 hour'`,
    );
    expect(await repo.claimBatch(5, 1000, new Date())).toHaveLength(0);
  });

  it('retry_pending events become due at nextAttemptAt', async () => {
    await repo.insertReceived(event('retry'));
    const [claimed] = await repo.claimBatch(5, 1000, new Date());
    const due = new Date(Date.now() + 60_000);
    await repo.markResult(claimed, {
      state: 'retry_pending',
      nextAttemptAt: due,
      lastError: 'later',
    });
    expect(await repo.claimBatch(5, 1000, new Date())).toHaveLength(0);
    expect(
      await repo.claimBatch(5, 1000, new Date(due.getTime() + 1)),
    ).toHaveLength(1);
  });
});
