import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '@/modules/nfe/testing/postgres-harness';
import { createNfeStack, type NfeStack } from '@/modules/nfe/testing/nfe-stack';

describePostgres('NFC-e emission on PostgreSQL (simulated SEFAZ)', () => {
  let h: PostgresHarness;
  let s: NfeStack;

  beforeAll(async () => {
    h = await createPostgresHarness('nfceemit');
    s = createNfeStack(h);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(() => {
    s.redis.values.clear();
    s.redis.sets.clear();
    s.settings.nfceDefaultSeries = 1;
    s.hooks.beforeIssue = undefined;
  });

  const history = async (id: string): Promise<string[]> => {
    const rows: Array<{ to_status: string }> = await h.admin.query(
      `SELECT to_status FROM "${h.schema}".nfe_document_history WHERE document_id = $1 ORDER BY created_at, id`,
      [id],
    );
    return rows.map((r) => r.to_status);
  };

  it('accepts a NFC-e with no recipient, numbers it in its own series and authorizes it with the QR Code', async () => {
    s.settings.nfceDefaultSeries = 7;
    const accepted = await s.nfceIntake.submit(
      h.tenantId,
      'test',
      s.nfceInput(),
      'nfce-key-1',
    );
    expect(accepted).toMatchObject({ status: 'queued', replayed: false });
    expect(await s.row(accepted.id)).toMatchObject({
      model: 65,
      status: 'queued',
      recipient: null,
    });
    expect(await s.messages('nfe.emit', accepted.id)).toHaveLength(1);

    await s.emit.process(accepted.id, h.tenantId, 'test');
    const row = await s.row(accepted.id);
    expect(row).toMatchObject({
      model: 65,
      status: 'authorized',
      series: 7,
      number: 1,
      attempt: 1,
      authority: 'SP',
      c_stat: '100',
    });
    expect(String(row.access_key)).toHaveLength(44);
    // Model 65 sits at positions 21-22 of the key.
    expect(String(row.access_key).slice(20, 22)).toBe('65');
    expect(String(row.qr_code)).toMatch(
      /^https:\/\/www\.homologacao\.nfce\.fazenda\.sp\.gov\.br\/qrcode\?p=.+\|3\|2$/,
    );
    expect(String(row.qr_code)).toContain(String(row.access_key));
    expect(row.url_chave).toBe(
      'https://www.homologacao.nfce.fazenda.sp.gov.br/consulta',
    );
    expect(String(row.signed_xml)).toContain('<infNFeSupl>');
    expect(await history(accepted.id)).toEqual([
      'queued',
      'processing',
      'authorized',
    ]);
    expect(await s.messages('nfe.prepare_documents', accepted.id)).toHaveLength(
      1,
    );
    expect(s.deliveries.at(-1)).toMatchObject({
      eventType: 'nfce.document.authorized',
      data: {
        documentType: 'nfce',
        documentId: accepted.id,
        status: 'authorized',
      },
    });
  });

  it('keeps the NF-e of the same company on its own sequence and webhook name', async () => {
    const nfce = await s.issueNfce();
    const nfeId = await s.issue('FAKE-100');
    expect(await s.row(nfce)).toMatchObject({ model: 65, number: 1 });
    const nfe = await s.row(nfeId);
    expect(nfe).toMatchObject({ model: 55, status: 'authorized' });
    expect(nfe.qr_code).toBeNull();
    expect(nfe.url_chave).toBeNull();
    expect(s.deliveries.at(-1)).toMatchObject({
      eventType: 'nfe.document.authorized',
      data: { documentType: 'nfe', documentId: nfeId },
    });
    const second = await s.issueNfce();
    expect(await s.row(second)).toMatchObject({ model: 65, number: 2 });
  });

  it('replays the same Idempotency-Key and refuses the same key with another body', async () => {
    const body = s.nfceInput();
    const first = await s.nfceIntake.submit(
      h.tenantId,
      'test',
      body,
      'nfce-key-2',
    );
    const again = await s.nfceIntake.submit(
      h.tenantId,
      'test',
      body,
      'nfce-key-2',
    );
    expect(again).toMatchObject({ id: first.id, replayed: true });
    await expect(
      s.nfceIntake.submit(
        h.tenantId,
        'test',
        s.nfceInput('FAKE-100', 'test', { additionalInfo: 'outra' }),
        'nfce-key-2',
      ),
    ).rejects.toMatchObject({ response: expect.anything() });
  });

  it('an open breaker on nfce-sp-2 keeps the NFC-e waiting and does not touch nfe-sp-2', async () => {
    await s.breaker.recordFailure('test', 'nfce-sp-2');
    await s.breaker.recordFailure('test', 'nfce-sp-2');
    const calls = jest.fn();
    s.hooks.beforeIssue = calls;
    const id = await s.issueNfce();
    expect((await s.row(id)).status).toBe('retry_pending');
    expect(calls).not.toHaveBeenCalled();
    expect(await s.breaker.status('test', 'nfe-sp-2')).toMatchObject({
      available: true,
    });
    // The NF-e is not held by the NFC-e breaker.
    const nfeId = await s.issue('FAKE-100');
    expect((await s.row(nfeId)).status).toBe('authorized');
  });

  it('a rejected NFC-e is corrected and sent again: same number, new key, QR Code of the new key', async () => {
    const accepted = await s.nfceIntake.submit(
      h.tenantId,
      'test',
      s.nfceInput('FAKE-225'),
      'nfce-key-3',
    );
    await s.emit.process(accepted.id, h.tenantId, 'test');
    const first = await s.row(accepted.id);
    expect(first).toMatchObject({ status: 'rejected', last_error_code: '225' });

    await s.resubmitNfce(accepted.id, s.nfceInput('FAKE-100'));
    await s.emit.process(accepted.id, h.tenantId, 'test');
    const second = await s.row(accepted.id);
    expect(second).toMatchObject({
      status: 'authorized',
      number: first.number,
      attempt: 2,
    });
    expect(second.access_key).not.toBe(first.access_key);
    expect(String(second.qr_code)).toContain(String(second.access_key));
  });

  it('stores the nfeProc only (no DANFE, no e-mail yet) and says documents_ready as nfce', async () => {
    const accepted = await s.nfceIntake.submit(
      h.tenantId,
      'test',
      s.nfceInput('FAKE-100', 'test', {
        recipient: { taxId: '123.456.789-09', email: 'maria@example.com' },
      }),
      'nfce-docs-1',
    );
    await s.emit.process(accepted.id, h.tenantId, 'test');
    await s.dispatch('nfe.prepare_documents', accepted.id);
    const keys = [...s.objects.keys()].filter((k) => k.includes(accepted.id));
    expect(keys.some((k) => k.endsWith('nfe-proc.xml'))).toBe(true);
    expect(keys.some((k) => k.endsWith('danfe.pdf'))).toBe(false);
    expect(await s.messages('nfe.send_email', accepted.id)).toHaveLength(0);
    expect(s.deliveries.at(-1)).toMatchObject({
      eventType: 'nfce.document.documents_ready',
      data: { documentType: 'nfce', emailRequested: false },
    });
  });

  it('a live NFC-e reserves one credit as nfce, confirms it on authorization and gives it back when rejected', async () => {
    const live = createNfeStack(h, { production: true });
    const credits = async (id: string) => {
      const rows: Array<{
        amount: number;
        is_reservation: boolean;
        reserved_document_type: string;
      }> = await h.admin.query(
        `SELECT amount, is_reservation, reserved_document_type FROM "${h.schema}".credit_transactions WHERE reserved_nfe_document_id = $1 ORDER BY created_at, id`,
        [id],
      );
      return rows;
    };
    const key = (id: string) => ({
      id,
      tenantId: h.tenantId,
      environment: 'live' as const,
    });

    const accepted = await live.nfceIntake.submit(
      h.tenantId,
      'live',
      live.nfceInput('FAKE-100', 'live'),
      'nfce-live-1',
    );
    expect(await credits(accepted.id)).toEqual([
      { amount: -1, is_reservation: true, reserved_document_type: 'nfce' },
    ]);
    await live.transitions.apply(key(accepted.id), 'processing', {});
    await live.transitions.apply(key(accepted.id), 'authorized', {});
    expect(await credits(accepted.id)).toEqual([
      { amount: -1, is_reservation: false, reserved_document_type: 'nfce' },
    ]);

    const refused = await live.nfceIntake.submit(
      h.tenantId,
      'live',
      live.nfceInput('FAKE-225', 'live'),
      'nfce-live-2',
    );
    await live.transitions.apply(key(refused.id), 'processing', {});
    await live.transitions.apply(key(refused.id), 'rejected', {});
    expect(await credits(refused.id)).toEqual([
      { amount: -1, is_reservation: false, reserved_document_type: 'nfce' },
    ]);
    const refund: Array<{ amount: number }> = await h.admin.query(
      `SELECT r.amount FROM "${h.schema}".credit_transactions r JOIN "${h.schema}".credit_transactions o ON r.related_transaction_id = o.id WHERE o.reserved_nfe_document_id = $1`,
      [refused.id],
    );
    expect(refund.map((r) => r.amount)).toEqual([1]);
  });
});
