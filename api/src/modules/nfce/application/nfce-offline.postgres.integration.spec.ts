import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '@/modules/nfe/testing/postgres-harness';
import { createNfeStack, type NfeStack } from '@/modules/nfe/testing/nfe-stack';

const HOUR = 3_600_000;

describePostgres('off-line NFC-e on PostgreSQL (simulated SEFAZ)', () => {
  let h: PostgresHarness;
  let s: NfeStack;

  beforeAll(async () => {
    h = await createPostgresHarness('nfceoffline');
    s = createNfeStack(h);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(() => {
    s.redis.values.clear();
    s.redis.sets.clear();
    s.hooks.beforeIssue = undefined;
    s.hooks.afterIssue = undefined;
    s.hooks.consult = undefined;
    s.noticeSpy.mockClear();
    s.situation.value = {
      breakerOpen: false,
      authorityReachable: null,
      network: 'ok',
    };
  });

  const history = async (id: string): Promise<string[]> => {
    const rows: Array<{ to_status: string }> = await h.admin.query(
      `SELECT to_status FROM "${h.schema}".nfe_document_history WHERE document_id = $1 ORDER BY created_at, id`,
      [id],
    );
    return rows.map((r) => r.to_status);
  };
  const authorizedEvents = (id: string) =>
    s.deliveries.filter(
      (d) =>
        d.eventType === 'nfce.document.authorized' && d.data.documentId === id,
    );

  it('issues complete and untransmitted: number, key with tpEmis 9, signed XML, QR Code, an emit message and the 20 h alert', async () => {
    const now = new Date('2026-11-26T13:00:00Z');
    const id = await s.issueNfceOffline('FAKE-100', 'test', 'off-pg-1', now);
    const row = await s.row(id);
    expect(row).toMatchObject({
      model: 65,
      status: 'contingency_pending',
      tp_emis: 9,
      attempt: 1,
      transmitted_at: null,
      contingency_reason: 'SEFAZ indisponivel',
      authority: 'SP',
    });
    expect(row.number).toBeGreaterThan(0);
    expect(String(row.access_key)[34]).toBe('9');
    expect(String(row.signed_xml)).toContain('<tpEmis>9</tpEmis>');
    expect(String(row.signed_xml)).toContain('<Signature');
    expect(String(row.qr_code)).toContain(`?p=${String(row.access_key)}|3|2|`);
    expect(await history(id)).toEqual(['contingency_pending']);

    expect(await s.messages('nfe.emit', id)).toHaveLength(1);
    const [alert] = await s.messages('nfce.contingency_alert', id);
    expect(alert.availableAt.getTime()).toBe(now.getTime() + 20 * HOUR);
    expect(alert.dedupeKey).toBe(`contingency-alert:${id}`);
  });

  it('the XML and the DANFCE are served before the SEFAZ answers, and replaced by the authorized ones afterwards', async () => {
    const id = await s.issueNfceOffline('FAKE-100');
    const before = await s.files.read(id, h.tenantId, 'test', 'xml');
    expect(before.body.toString('utf8')).toContain('<tpEmis>9</tpEmis>');
    expect(before.body.toString('utf8')).not.toContain('<protNFe');
    const cupom = await s.files.read(id, h.tenantId, 'test', 'pdf');
    expect(cupom.body.subarray(0, 5).toString()).toBe('%PDF-');

    await s.dispatch('nfe.emit', id);
    await s.dispatch('nfe.prepare_documents', id);
    const after = await s.files.read(id, h.tenantId, 'test', 'xml');
    expect(after.body.toString('utf8')).toContain('<protNFe');
    expect((await s.row(id)).documents_ready_at).not.toBeNull();
  });

  it('transmits the very same signed XML: authorized, same key, transmitted_at written, one authorized webhook', async () => {
    const id = await s.issueNfceOffline('FAKE-100');
    const issued = await s.row(id);
    await s.dispatch('nfe.emit', id);
    const sent = await s.row(id);
    expect(sent).toMatchObject({
      status: 'authorized',
      access_key: issued.access_key,
      signed_xml: issued.signed_xml,
      attempt: 1,
      c_stat: '100',
    });
    expect(sent.transmitted_at).not.toBeNull();
    expect(await history(id)).toEqual([
      'contingency_pending',
      'processing',
      'authorized',
    ]);
    expect(authorizedEvents(id)).toHaveLength(1);
    expect(await s.messages('nfe.prepare_documents', id)).toHaveLength(1);
  });

  it('cStat 150 (authorized after the deadline) is an authorization', async () => {
    const id = await s.issueNfceOffline('FAKE-100');
    const key = String((await s.row(id)).access_key);
    const issue = jest.spyOn(s.fakeNfce.issuer, 'issue').mockResolvedValueOnce({
      kind: 'ok',
      value: {
        accessKey: key,
        protocol: '135260000000150',
        authorizedAt: new Date(),
        cStat: '150',
        xMotivo: 'Autorizado fora de prazo',
        protNFeXml: '<protNFe/>',
      },
    });
    try {
      await s.dispatch('nfe.emit', id);
    } finally {
      issue.mockRestore();
    }
    expect(await s.row(id)).toMatchObject({
      status: 'authorized',
      c_stat: '150',
    });
  });

  it('a paused authority keeps it contingency_pending: nothing is sent and no attempt is spent', async () => {
    const id = await s.issueNfceOffline('FAKE-100');
    await s.breaker.recordFailure('test', 'nfce-sp-2');
    await s.breaker.recordFailure('test', 'nfce-sp-2');
    const calls = jest.fn();
    s.hooks.beforeIssue = calls;
    await s.dispatch('nfe.emit', id);
    expect(calls).not.toHaveBeenCalled();
    expect(await s.row(id)).toMatchObject({
      status: 'contingency_pending',
      attempt: 1,
      transmitted_at: null,
    });
    // The wait is a new message for the same attempt, due later.
    const waits = (await s.messages('nfe.emit', id)).filter((m) =>
      m.dedupeKey.includes(':retry:'),
    );
    expect(waits).toHaveLength(1);
    expect(await history(id)).toEqual([
      'contingency_pending',
      'processing',
      'contingency_pending',
    ]);
  });

  it('the answer is lost and the SEFAZ had it: the look by key adopts it, authorized once', async () => {
    const id = await s.issueNfceOffline('FAKE-TIMEOUT');
    await s.dispatch('nfe.emit', id);
    expect(await s.row(id)).toMatchObject({
      status: 'reconciliation_required',
    });
    expect((await s.row(id)).transmitted_at).not.toBeNull();
    const [look] = await s.messages('nfe.reconcile', id);
    await s.reconcile.handle(look);
    expect(await s.row(id)).toMatchObject({ status: 'authorized' });
    expect(authorizedEvents(id)).toHaveLength(1);
  });

  it('the same note sent again answers 204: the consultation by key adopts the protocol, authorized once', async () => {
    const id = await s.issueNfceOffline('FAKE-204');
    await s.dispatch('nfe.emit', id);
    expect(await s.row(id)).toMatchObject({ status: 'authorized' });
    expect((await s.row(id)).protocol).toBeTruthy();
    expect(authorizedEvents(id)).toHaveLength(1);
  });

  it('a rejection ends rejected with its reason, and the webhook says so', async () => {
    const id = await s.issueNfceOffline('FAKE-225');
    await s.dispatch('nfe.emit', id);
    expect(await s.row(id)).toMatchObject({
      status: 'rejected',
      c_stat: '225',
      tp_emis: 9,
    });
    expect(s.deliveries.at(-1)).toMatchObject({
      eventType: 'nfce.document.rejected',
      data: { documentId: id },
    });
  });

  describe('the 20 h alert', () => {
    it('does nothing at 19 h 59 min, warns once at 20 h and never again', async () => {
      const issuedAt = new Date('2026-11-26T13:00:00Z');
      const id = await s.issueNfceOffline(
        'FAKE-100',
        'test',
        'alert-1',
        issuedAt,
      );
      const warnings = () =>
        s.deliveries.filter(
          (d) =>
            d.eventType === 'nfce.contingency.deadline_near' &&
            d.data.documentId === id,
        );

      await expect(
        s.alertHandler.process(
          id,
          h.tenantId,
          'test',
          new Date(issuedAt.getTime() + 20 * HOUR - 60_000),
        ),
      ).rejects.toThrow();
      expect(warnings()).toHaveLength(0);
      expect((await s.row(id)).contingency_alerted_at).toBeNull();

      const at20 = new Date(issuedAt.getTime() + 20 * HOUR);
      await s.alertHandler.process(id, h.tenantId, 'test', at20);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0].data).toMatchObject({
        accessKey: (await s.row(id)).access_key,
        contingencyAt: issuedAt.toISOString(),
        deadlineAt: new Date(issuedAt.getTime() + 24 * HOUR).toISOString(),
      });
      expect((await s.row(id)).contingency_alerted_at).not.toBeNull();

      await s.alertHandler.process(
        id,
        h.tenantId,
        'test',
        new Date(at20.getTime() + 60_000),
      );
      expect(warnings()).toHaveLength(1);
      // E-mails are for live notes only.
      expect(s.noticeSpy).not.toHaveBeenCalled();
    });

    it('a note already transmitted gets no warning', async () => {
      const issuedAt = new Date('2026-11-26T13:00:00Z');
      const id = await s.issueNfceOffline(
        'FAKE-100',
        'test',
        'alert-2',
        issuedAt,
      );
      await s.dispatch('nfe.emit', id);
      await s.alertHandler.process(
        id,
        h.tenantId,
        'test',
        new Date(issuedAt.getTime() + 21 * HOUR),
      );
      expect(
        s.deliveries.filter(
          (d) =>
            d.eventType === 'nfce.contingency.deadline_near' &&
            d.data.documentId === id,
        ),
      ).toHaveLength(0);
    });
  });
});
