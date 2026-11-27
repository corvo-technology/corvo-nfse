import { NfeIntakeService } from './application/nfe-intake.service';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from './testing/postgres-harness';
import { createNfeStack, type NfeStack } from './testing/nfe-stack';

describePostgres('NF-e intake on PostgreSQL', () => {
  let h: PostgresHarness;
  let s: NfeStack;

  beforeAll(async () => {
    h = await createPostgresHarness('nfeintake');
    s = createNfeStack(h);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  const count = async (table: string): Promise<number> => {
    const rows: Array<{ n: string }> = await h.admin.query(
      `SELECT count(*)::text AS n FROM "${h.schema}".${table} WHERE tenant_id = $1`,
      [h.tenantId],
    );
    return Number(rows[0].n);
  };

  it('accepts: queued document, items, first history row and the emit message, all together', async () => {
    const before = await count('nfe_documents');
    const accepted = await s.intake.submit(
      h.tenantId,
      'test',
      s.input('FAKE-100'),
      'accept-1',
    );
    expect(accepted).toMatchObject({ status: 'queued', replayed: false });
    expect(await count('nfe_documents')).toBe(before + 1);
    expect(await s.row(accepted.id)).toMatchObject({
      status: 'queued',
      number: null,
      access_key: null,
      attempt: 0,
      idempotency_key: 'accept-1',
    });
    const history: Array<{ from_status: string | null; to_status: string }> =
      await h.admin.query(
        `SELECT from_status, to_status FROM "${h.schema}".nfe_document_history WHERE document_id = $1`,
        [accepted.id],
      );
    expect(history).toEqual([{ from_status: null, to_status: 'queued' }]);
    const items: Array<{ code: string }> = await h.admin.query(
      `SELECT code FROM "${h.schema}".nfe_document_items WHERE document_id = $1`,
      [accepted.id],
    );
    expect(items).toHaveLength(1);
    const [message] = await s.messages('nfe.emit', accepted.id);
    expect(message.dedupeKey).toBe(`emit:${accepted.id}:1`);
  });

  it('the outbox message carries ids only: no CPF/CNPJ, no XML, no certificate', async () => {
    const accepted = await s.intake.submit(
      h.tenantId,
      'test',
      s.input('FAKE-100'),
      'privacy-1',
    );
    const rows: Array<{ payload: unknown }> = await h.admin.query(
      `SELECT payload FROM "${h.schema}".outbox_messages WHERE aggregate_id = $1`,
      [accepted.id],
    );
    const text = JSON.stringify(rows);
    expect(Object.keys(rows[0].payload ?? {}).sort()).toEqual([
      'companyId',
      'documentId',
      'tenantId',
    ]);
    expect(text).not.toContain('12345678909');
    expect(text).not.toContain('123.456.789-09');
    expect(text).not.toContain('<NFe');
    expect(text).not.toContain('pfx');
  });

  it('remembers the recipient in the customer directory, after the commit', async () => {
    s.remembered.mockClear();
    await s.intake.submit(
      h.tenantId,
      'test',
      s.input('FAKE-100'),
      'customer-1',
    );
    expect(s.remembered).toHaveBeenCalledWith(
      { tenantId: h.tenantId, environment: 'test' },
      expect.objectContaining({ taxId: '12345678909', name: 'Maria da Silva' }),
    );
  });

  it('two simultaneous requests with the same key and body create one document', async () => {
    const before = await count('nfe_documents');
    const body = () => s.input('FAKE-100');
    const [a, b] = await Promise.all([
      s.intake.submit(h.tenantId, 'test', body(), 'twin-1'),
      s.intake.submit(h.tenantId, 'test', body(), 'twin-1'),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await count('nfe_documents')).toBe(before + 1);
    expect(await s.messages('nfe.emit', a.id)).toHaveLength(1);
  });

  it('two simultaneous requests with the same key and different bodies: one is created, one is a 409', async () => {
    const before = await count('nfe_documents');
    const results = await Promise.allSettled([
      s.intake.submit(h.tenantId, 'test', s.input('FAKE-100'), 'twin-2'),
      s.intake.submit(
        h.tenantId,
        'test',
        s.input('FAKE-100', 'test', { additionalInfo: 'outro corpo' }),
        'twin-2',
      ),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
    expect(await count('nfe_documents')).toBe(before + 1);
  });

  it('a later request with the same key and body is a replay of the same id', async () => {
    const first = await s.intake.submit(
      h.tenantId,
      'test',
      s.input('FAKE-100'),
      'replay-1',
    );
    const second = await s.intake.submit(
      h.tenantId,
      'test',
      s.input('FAKE-100'),
      'replay-1',
    );
    expect(second).toEqual({ ...first, replayed: true });
  });

  it('the header is required and has 1 to 200 characters', () => {
    expect(() => NfeIntakeService.assertIdempotencyKey(undefined)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }),
      }) as Error,
    );
    expect(() => NfeIntakeService.assertIdempotencyKey('')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_INVALID' }),
      }) as Error,
    );
    expect(() =>
      NfeIntakeService.assertIdempotencyKey('x'.repeat(201)),
    ).toThrow();
    expect(NfeIntakeService.assertIdempotencyKey('x'.repeat(200))).toHaveLength(
      200,
    );
  });

  it('a validation failure answers 422 and writes nothing', async () => {
    const documents = await count('nfe_documents');
    const messages = (await s.messages()).length;
    const input = s.input('FAKE-100');
    input.items[0] = { ...input.items[0], ncm: '12' };
    await expect(
      s.intake.submit(h.tenantId, 'test', input, 'invalid-1'),
    ).rejects.toMatchObject({
      response: { type: 'validation', code: 'NFE_VALIDATION_FAILED' },
    });
    expect(await count('nfe_documents')).toBe(documents);
    expect((await s.messages()).length).toBe(messages);
  });

  it('a live company is refused while production is closed, before anything is written', async () => {
    const documents = await count('nfe_documents');
    await expect(
      s.intake.submit(
        h.tenantId,
        'live',
        s.input('FAKE-100', 'live'),
        'live-1',
      ),
    ).rejects.toMatchObject({
      response: { type: 'configuration', code: 'NFE_PRODUCTION_DISABLED' },
    });
    expect(await count('nfe_documents')).toBe(documents);
    expect(await count('credit_transactions')).toBe(0);
  });

  it('a live company reserves the credit with the document', async () => {
    const live = createNfeStack(h, { production: true });
    const accepted = await live.intake.submit(
      h.tenantId,
      'live',
      live.input('FAKE-100', 'live'),
      'live-credit-1',
    );
    const rows: Array<{ amount: number; is_reservation: boolean }> =
      await h.admin.query(
        `SELECT amount, is_reservation FROM "${h.schema}".credit_transactions WHERE reserved_nfe_document_id = $1`,
        [accepted.id],
      );
    expect(rows).toEqual([{ amount: -1, is_reservation: true }]);
    // A replay reserves nothing more.
    await live.intake.submit(
      h.tenantId,
      'live',
      live.input('FAKE-100', 'live'),
      'live-credit-1',
    );
    expect(await count('credit_transactions')).toBe(1);
  });
});
