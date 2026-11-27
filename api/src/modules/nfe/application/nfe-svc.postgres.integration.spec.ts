import { dhEmiFor } from '@/infra/external/nfe/sefaz/uf';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '../testing/postgres-harness';
import { createNfeStack, type NfeStack } from '../testing/nfe-stack';

const X_JUST = 'SEFAZ de origem indisponivel';
const tpEmisOf = (key: unknown) => String(key).charAt(34);

describePostgres('NF-e through the SVC on PostgreSQL (simulated SEFAZ)', () => {
  let h: PostgresHarness;
  let s: NfeStack;

  beforeAll(async () => {
    h = await createPostgresHarness('nfesvc');
    s = createNfeStack(h);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    s.redis.values.clear();
    s.redis.sets.clear();
    s.hooks.beforeIssue = undefined;
    await s.contingencyStates.exit('SP', 2, new Date());
  });

  const enterSvc = async () => {
    const now = new Date();
    await s.contingencyStates.enter(
      'SP',
      2,
      { dhCont: dhEmiFor('SP', now), xJust: X_JUST },
      now,
    );
  };

  const history = async (id: string) => {
    const rows: Array<{ access_key: string | null; attempt: number }> =
      await h.admin.query(
        `SELECT access_key, attempt FROM "${h.schema}".nfe_document_history WHERE document_id = $1 ORDER BY created_at, id`,
        [id],
      );
    return rows;
  };

  it('a note that was never transmitted goes out through the SVC-AN with a new key', async () => {
    await enterSvc();
    const id = await s.issue('FAKE-100');
    const row = await s.row(id);
    expect(row).toMatchObject({
      status: 'authorized',
      tp_emis: 6,
      authority: 'SVCAN',
    });
    expect(tpEmisOf(row.access_key)).toBe('6');
    expect(row.transmitted_at).toBeTruthy();
    expect(row.contingency_reason).toBe(X_JUST);
    expect(row.contingency_at).toBeTruthy();
    expect(row.signed_xml).toContain('<tpEmis>6</tpEmis>');
    expect(row.signed_xml).toContain(
      '<xJust>SEFAZ de origem indisponivel</xJust>',
    );
    expect(row.signed_xml).toMatch(
      /<dhCont>\d{4}-\d{2}-\d{2}T[^<]+-03:00<\/dhCont>/,
    );
  });

  it('goes the normal way while the UF is not in the SVC, and after it leaves', async () => {
    const normal = await s.row(await s.issue('FAKE-100'));
    expect(tpEmisOf(normal.access_key)).toBe('1');
    expect(normal.tp_emis).toBe(1);
    expect(normal.authority).toBe('SP');
    expect(normal.transmitted_at).toBeTruthy();
    await enterSvc();
    await s.issue('FAKE-100');
    await s.contingencyStates.exit('SP', 2, new Date());
    const after = await s.row(await s.issue('FAKE-100'));
    expect(tpEmisOf(after.access_key)).toBe('1');
  });

  it('never changes the key of a note that may have reached its SEFAZ (retry_pending, already transmitted)', async () => {
    const id = await s.issue('FAKE-108');
    const first = await s.row(id);
    expect(first).toMatchObject({ status: 'retry_pending' });
    expect(first.transmitted_at).toBeTruthy();
    await enterSvc();
    await s.emit.process(id, h.tenantId, 'test');
    const second = await s.row(id);
    expect(second).toMatchObject({
      attempt: 1,
      access_key: first.access_key,
      signed_xml: first.signed_xml,
      tp_emis: 1,
    });
    expect(tpEmisOf(second.access_key)).toBe('1');
  });

  it('moves a retry_pending that was never transmitted to the SVC: same number, new key, old key in the history', async () => {
    // The breaker is open before the send: nothing reaches the SEFAZ and nothing is marked.
    await s.breaker.recordFailure('test', 'nfe-sp-2');
    await s.breaker.recordFailure('test', 'nfe-sp-2');
    const id = await s.issue('FAKE-100');
    const waiting = await s.row(id);
    expect(waiting).toMatchObject({ status: 'retry_pending', attempt: 1 });
    expect(waiting.transmitted_at).toBeNull();

    s.redis.values.clear();
    await enterSvc();
    await s.emit.process(id, h.tenantId, 'test');
    const row = await s.row(id);
    expect(row).toMatchObject({
      status: 'authorized',
      attempt: 2,
      number: waiting.number,
      series: waiting.series,
      tp_emis: 6,
      authority: 'SVCAN',
    });
    expect(row.access_key).not.toBe(waiting.access_key);
    expect(tpEmisOf(row.access_key)).toBe('6');
    const keys = (await history(id)).map((r) => r.access_key);
    expect(keys).toContain(waiting.access_key);
  });

  it('uses the SVC breaker, not the origin one, for a note of the SVC', async () => {
    await enterSvc();
    // The origin breaker is open, the SVC one is not: the SVC note still goes out.
    await s.breaker.recordFailure('test', 'nfe-sp-2');
    await s.breaker.recordFailure('test', 'nfe-sp-2');
    const id = await s.issue('FAKE-100');
    expect((await s.row(id)).status).toBe('authorized');
    // The SVC breaker open keeps it waiting, with nothing marked as transmitted.
    s.redis.values.clear();
    await s.breaker.recordFailure('test', 'nfe-svcan-2');
    await s.breaker.recordFailure('test', 'nfe-svcan-2');
    const waiting = await s.issue('FAKE-100');
    const row = await s.row(waiting);
    expect(row).toMatchObject({ status: 'retry_pending', tp_emis: 6 });
    expect(row.transmitted_at).toBeNull();
  });

  it('a reconciliation_required note never goes to the SVC: it is asked about by its own key', async () => {
    const id = await s.issue('FAKE-TIMEOUT');
    const before = await s.row(id);
    expect(before.status).toBe('reconciliation_required');
    await enterSvc();
    await s.emit.process(id, h.tenantId, 'test');
    await s.dispatch('nfe.reconcile', id);
    const after = await s.row(id);
    expect(after.access_key).toBe(before.access_key);
    expect(after.attempt).toBe(1);
    expect(tpEmisOf(after.access_key)).toBe('1');
  });

  it('a worker that dies after marking transmitted_at leaves the note to the reconciliation, with the same key', async () => {
    s.hooks.beforeIssue = () => {
      throw new Error('worker killed');
    };
    const accepted = await s.intake.submit(
      h.tenantId,
      'test',
      s.input('FAKE-100'),
      `k-${Math.random()}`,
    );
    await expect(
      s.emit.process(accepted.id, h.tenantId, 'test'),
    ).rejects.toThrow('worker killed');
    s.hooks.beforeIssue = undefined;
    const stuck = await s.row(accepted.id);
    expect(stuck.status).toBe('processing');
    expect(stuck.transmitted_at).toBeTruthy();

    await enterSvc();
    await s.emit.process(accepted.id, h.tenantId, 'test');
    const row = await s.row(accepted.id);
    expect(row).toMatchObject({
      status: 'reconciliation_required',
      access_key: stuck.access_key,
      attempt: 1,
    });
    expect(tpEmisOf(row.access_key)).toBe('1');
  });

  it('a rejected note that is sent again while the UF is in the SVC gets a new SVC key; the old one stays in the history', async () => {
    const id = await s.issue('FAKE-225');
    const rejected = await s.row(id);
    expect(rejected.status).toBe('rejected');
    await enterSvc();
    await s.resubmit.resubmit(id, h.tenantId, 'test', s.input('FAKE-100'));
    await s.emit.process(id, h.tenantId, 'test');
    const row = await s.row(id);
    expect(row).toMatchObject({
      status: 'authorized',
      number: rejected.number,
      attempt: 2,
      tp_emis: 6,
    });
    expect((await history(id)).map((r) => r.access_key)).toContain(
      rejected.access_key,
    );
  });
});
