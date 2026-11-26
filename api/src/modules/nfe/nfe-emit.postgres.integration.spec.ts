import { makeTestA1 } from '../../../test/fixtures/nfe/test-a1';
import { toNfeHttpError } from './http/nfe-error-http';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from './testing/postgres-harness';
import { createNfeStack, type NfeStack } from './testing/nfe-stack';

describePostgres('NF-e emission on PostgreSQL (simulated SEFAZ)', () => {
  let h: PostgresHarness;
  let s: NfeStack;

  beforeAll(async () => {
    h = await createPostgresHarness('nfeemit');
    s = createNfeStack(h);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(() => {
    // Two "service down" answers open the breaker of the authority: each test starts closed.
    s.redis.values.clear();
    s.redis.sets.clear();
  });

  const history = async (id: string): Promise<string[]> => {
    const rows: Array<{ to_status: string }> = await h.admin.query(
      `SELECT to_status FROM "${h.schema}".nfe_document_history WHERE document_id = $1 ORDER BY created_at, id`,
      [id],
    );
    return rows.map((r) => r.to_status);
  };

  it('FAKE-100: authorized, numbered, keyed and recorded in the history', async () => {
    const id = await s.issue('FAKE-100');
    const row = await s.row(id);
    expect(row).toMatchObject({
      status: 'authorized',
      attempt: 1,
      series: 1,
      c_stat: '100',
      authority: 'SP',
    });
    expect(String(row.access_key)).toHaveLength(44);
    expect(String(row.protocol)).toMatch(/^135/);
    expect(row.signed_xml).toContain('<Signature');
    expect(row.prot_nfe_xml).toContain('<protNFe');
    expect(await history(id)).toEqual(['queued', 'processing', 'authorized']);
    expect(await s.messages('nfe.prepare_documents', id)).toHaveLength(1);
    expect(s.deliveries.at(-1)).toMatchObject({
      eventType: 'nfe.document.authorized',
      data: { documentType: 'nfe', documentId: id, status: 'authorized' },
    });
  });

  it('runs the same message twice and authorizes once', async () => {
    const id = await s.issue('FAKE-100');
    const before = s.deliveries.length;
    await s.emit.process(id, h.tenantId, 'test');
    expect(s.deliveries).toHaveLength(before);
    expect(await history(id)).toEqual(['queued', 'processing', 'authorized']);
  });

  it('FAKE-302: denied, with the signed XML kept', async () => {
    const id = await s.issue('FAKE-302');
    const row = await s.row(id);
    expect(row).toMatchObject({ status: 'denied', c_stat: '302' });
    expect(row.signed_xml).toBeTruthy();
    expect(s.deliveries.at(-1)?.eventType).toBe('nfe.document.denied');
  });

  it('FAKE-225: rejected as a validation error, with the hint of the code', async () => {
    const id = await s.issue('FAKE-225');
    const row = await s.row(id);
    expect(row).toMatchObject({
      status: 'rejected',
      last_error_type: 'validation',
      last_error_code: '225',
    });
    const doc = await s.documents.findById(id, h.tenantId, 'test');
    expect(toNfeHttpError(doc!.toSnapshot())?.error).toMatchObject({
      type: 'validation',
      code: '225',
      hint: expect.stringContaining('schema'),
    });
  });

  it('FAKE-TIMEOUT: reconciliation_required with a nfe.reconcile message and the same key', async () => {
    const id = await s.issue('FAKE-TIMEOUT');
    const row = await s.row(id);
    expect(row).toMatchObject({
      status: 'reconciliation_required',
      last_error_type: 'communication',
      reconcile_attempts: 1,
    });
    const reconcile = await s.messages('nfe.reconcile', id);
    expect(reconcile).toHaveLength(1);
    expect(reconcile[0].payload).toEqual({
      documentId: id,
      tenantId: h.tenantId,
      companyId: h.companyId,
    });
    const doc = await s.documents.findById(id, h.tenantId, 'test');
    expect(toNfeHttpError(doc!.toSnapshot())?.error.type).toBe('communication');
  });

  it('FAKE-204: the duplicate is adopted through the consultation', async () => {
    const id = await s.issue('FAKE-204');
    const row = await s.row(id);
    expect(row).toMatchObject({ status: 'authorized', c_stat: '100' });
    expect(row.protocol).toBeTruthy();
  });

  it('FAKE-108: retry_pending, to go out again with the same key', async () => {
    const id = await s.issue('FAKE-108');
    expect(await s.breaker.status('test', 'nfe-sp-2')).toMatchObject({
      available: true,
    });
    const row = await s.row(id);
    expect(row).toMatchObject({ status: 'retry_pending', attempt: 1 });
    const retries = await s.messages('nfe.emit', id);
    expect(retries).toHaveLength(2);
    expect(retries[1].dedupeKey).toMatch(new RegExp(`^emit:${id}:1:retry:`));
  });

  it('an open breaker keeps the document waiting without calling the SEFAZ', async () => {
    await s.breaker.recordFailure('test', 'nfe-sp-2');
    await s.breaker.recordFailure('test', 'nfe-sp-2');
    const calls = jest.fn();
    s.hooks.beforeIssue = calls;
    try {
      const id = await s.issue('FAKE-100');
      expect((await s.row(id)).status).toBe('retry_pending');
    } finally {
      s.hooks.beforeIssue = undefined;
    }
    expect(calls).not.toHaveBeenCalled();
    // Once it closes, the retry sends the same XML and authorizes.
    s.redis.values.clear();
    const [doc] = (await s.documents.list(h.tenantId, 'test', { limit: 1 }))
      .data;
    await s.emit.process(doc.id, h.tenantId, 'test');
    expect((await s.row(doc.id)).status).toBe('authorized');
  });

  it('a retry sends the very same signed XML: no new number, key or attempt', async () => {
    const id = await s.issue('FAKE-108');
    const first = await s.row(id);
    await s.emit.process(id, h.tenantId, 'test');
    const second = await s.row(id);
    expect(second).toMatchObject({
      status: 'retry_pending',
      attempt: 1,
      number: first.number,
      access_key: first.access_key,
      signed_xml: first.signed_xml,
    });
  });

  it('write-ahead: when the send starts, key and signed XML are already committed', async () => {
    let seen: Record<string, unknown> | undefined;
    s.hooks.beforeIssue = async (doc) => {
      // Another connection: only what was committed is visible.
      const rows: Array<Record<string, unknown>> = await h.admin.query(
        `SELECT status, access_key, signed_xml, number FROM "${h.schema}".nfe_documents WHERE access_key = $1`,
        [doc.accessKey],
      );
      seen = rows[0];
    };
    try {
      await s.issue('FAKE-100');
    } finally {
      s.hooks.beforeIssue = undefined;
    }
    expect(seen).toMatchObject({ status: 'processing' });
    expect(String(seen?.access_key)).toHaveLength(44);
    expect(seen?.signed_xml).toContain('<NFe');
    expect(seen?.number).toBeGreaterThan(0);
  });

  it('numbers are consecutive per company and series', async () => {
    const a = await s.row(await s.issue('FAKE-100'));
    const b = await s.row(await s.issue('FAKE-100'));
    expect(Number(b.number)).toBe(Number(a.number) + 1);
  });

  it('a rejected document keeps its number, and a new attempt draws a new key', async () => {
    const id = await s.issue('FAKE-225');
    const rejected = await s.row(id);
    await s.resubmit.resubmit(id, h.tenantId, 'test', s.input('FAKE-100'));
    await s.emit.process(id, h.tenantId, 'test');
    const row = await s.row(id);
    expect(row).toMatchObject({
      status: 'authorized',
      number: rejected.number,
      attempt: 2,
    });
    expect(row.access_key).not.toBe(rejected.access_key);
    const rows: Array<{ access_key: string | null; attempt: number }> =
      await h.admin.query(
        `SELECT access_key, attempt FROM "${h.schema}".nfe_document_history WHERE document_id = $1 AND to_status = 'rejected'`,
        [id],
      );
    // The key of the rejected attempt stays in the history.
    expect(rows).toEqual([{ access_key: rejected.access_key, attempt: 1 }]);
  });

  describe('credits of a live company', () => {
    let live: NfeStack;
    const { pfx, password } = makeTestA1({ cnpj: '11222333000181' });

    beforeAll(() => {
      live = createNfeStack(h, {
        production: true,
        certificate: { pfx, password },
      });
    });

    const credits = async (id: string): Promise<Array<[number, boolean]>> => {
      const rows: Array<{ amount: number; is_reservation: boolean }> =
        await h.admin.query(
          `SELECT amount, type, is_reservation FROM "${h.schema}".credit_transactions
            WHERE reserved_nfe_document_id = $1 OR related_transaction_id IN (SELECT id FROM "${h.schema}".credit_transactions WHERE reserved_nfe_document_id = $1)
            ORDER BY created_at, id`,
          [id],
        );
      return rows.map((r) => [r.amount, r.is_reservation]);
    };

    it('reserves on acceptance and confirms on authorization, signing with the real certificate', async () => {
      const id = await live.issue('FAKE-100', 'live');
      const row = await live.row(id);
      expect(row).toMatchObject({ status: 'authorized', environment: 'live' });
      expect(row.signed_xml).toContain('<SignatureValue>');
      expect(row.signed_xml).not.toContain(
        Buffer.alloc(256).toString('base64'),
      );
      expect(await credits(id)).toEqual([[-1, false]]);
    });

    it('gives the credit back when the SEFAZ rejects or denies', async () => {
      const rejected = await live.issue('FAKE-225', 'live');
      expect(await credits(rejected)).toEqual([
        [-1, false],
        [1, false],
      ]);
      const denied = await live.issue('FAKE-302', 'live');
      expect(await credits(denied)).toEqual([
        [-1, false],
        [1, false],
      ]);
    });

    it('keeps the reservation while the answer is lost, then settles on reconciliation', async () => {
      const id = await live.issue('FAKE-TIMEOUT', 'live');
      expect(await credits(id)).toEqual([[-1, true]]);
      await live.consult.sync(id, h.tenantId, 'live', 'automatic');
      expect((await live.row(id)).status).toBe('authorized');
      expect(await credits(id)).toEqual([[-1, false]]);
    });

    it('discarding a rejected NF-e does not refund twice', async () => {
      const id = await live.issue('FAKE-225', 'live');
      await live.resubmit.discard(id, h.tenantId, 'live');
      expect((await live.row(id)).status).toBe('discarded');
      expect(await credits(id)).toEqual([
        [-1, false],
        [1, false],
      ]);
    });

    it('a resubmitted rejection reserves again and the authorization confirms it', async () => {
      const id = await live.issue('FAKE-225', 'live');
      await live.resubmit.resubmit(
        id,
        h.tenantId,
        'live',
        live.input('FAKE-100', 'live'),
      );
      await live.emit.process(id, h.tenantId, 'live');
      expect(await credits(id)).toEqual([
        [-1, false],
        [1, false],
        [-1, false],
      ]);
    });
  });
});
