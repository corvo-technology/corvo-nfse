import { randomUUID } from 'node:crypto';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '../testing/postgres-harness';

describePostgres('AddNfeInutilizationIdempotency (up and down)', () => {
  let h: PostgresHarness;

  beforeAll(async () => {
    h = await createPostgresHarness('nfeinutmig');
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  const columns = async (): Promise<string[]> => {
    const rows: Array<{ column_name: string }> = await h.admin.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'nfe_inutilizations'`,
      [h.schema],
    );
    return rows.map((r) => r.column_name);
  };

  const insert = (key: string | null) =>
    h.admin.query(
      `INSERT INTO "${h.schema}".nfe_inutilizations
         (tenant_id, company_id, environment, series, start_number, end_number, justification, idempotency_key, request_hash)
       VALUES ($1,$2,'test',1,$3,$3,'Numeração pulada por erro',$4,'h')`,
      [h.tenantId, h.companyId, Math.floor(Math.random() * 1e6) + 1, key],
    );

  it('up: the columns exist and one key is unique per tenant and environment (many rows without a key are fine)', async () => {
    expect(await columns()).toEqual(
      expect.arrayContaining(['idempotency_key', 'request_hash']),
    );
    const key = `k-${randomUUID()}`;
    await insert(key);
    await expect(insert(key)).rejects.toThrow(
      /uq_nfe_inutilizations_idempotency/,
    );
    await insert(null);
    await insert(null);
  });

  it('down removes them and up puts them back', async () => {
    await h.admin.undoLastMigration({ transaction: 'each' });
    expect(await columns()).not.toContain('idempotency_key');
    expect(await columns()).not.toContain('request_hash');
    await h.admin.runMigrations();
    expect(await columns()).toContain('idempotency_key');
  });
});
