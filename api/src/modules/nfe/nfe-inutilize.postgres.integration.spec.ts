import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from './testing/postgres-harness';
import { createNfeStack, type NfeStack } from './testing/nfe-stack';

const JUSTIFICATION = 'Numeração pulada por falha do sistema emissor';

describePostgres('NF-e inutilization on PostgreSQL (simulated SEFAZ)', () => {
  let h: PostgresHarness;
  let s: NfeStack;

  beforeAll(async () => {
    h = await createPostgresHarness('nfeinut');
    s = createNfeStack(h);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(() => {
    s.redis.values.clear();
    s.redis.sets.clear();
    s.hooks.beforeEvent = undefined;
  });

  /** A company whose numbering is its own: each test uses a series nobody else touches. */
  let nextSeries = 100;
  const range = (start: number, end: number, series: number) => ({
    companyId: h.companyId,
    series,
    start,
    end,
    justification: JUSTIFICATION,
  });
  const rowOf = async (id: string) => {
    const rows: Array<Record<string, unknown>> = await h.admin.query(
      `SELECT * FROM "${h.schema}".nfe_inutilizations WHERE id = $1`,
      [id],
    );
    return rows[0];
  };
  const current = async (series: number): Promise<number> => {
    const rows: Array<{ current_number: number }> = await h.admin.query(
      `SELECT current_number FROM "${h.schema}".nfe_number_sequences WHERE company_id = $1 AND series = $2`,
      [h.companyId, series],
    );
    return rows[0]?.current_number ?? 0;
  };
  /** Documents that took numbers 1..n in a series (the series is a setting of the company). */
  const issueInSeries = async (series: number, scenario = 'FAKE-100') => {
    s.settings.defaultSeries = series;
    return s.issue(scenario);
  };

  it('accepts a free range: pending, signed, with nfe.inutilize queued; the handler homologates it', async () => {
    const series = nextSeries++;
    const { inutilization, replayed } = await s.inutilizeService.create(
      h.tenantId,
      'test',
      range(1, 3, series),
    );
    expect(replayed).toBe(false);
    expect(inutilization).toMatchObject({
      status: 'pending',
      start: 1,
      end: 3,
    });
    const row = await rowOf(inutilization.id);
    expect(String(row.request_xml)).toContain('<Signature');
    expect(String(row.request_xml)).toContain('<xServ>INUTILIZAR</xServ>');
    expect(await s.messages('nfe.inutilize', inutilization.id)).toHaveLength(1);

    await s.dispatch('nfe.inutilize', inutilization.id);
    expect(await rowOf(inutilization.id)).toMatchObject({
      status: 'homologada',
      c_stat: '102',
    });
    expect((await rowOf(inutilization.id)).proc_xml).toContain('ProcInutNFe');
    const completed = s.deliveries.filter(
      (d) =>
        d.eventType === 'nfe.inutilization.completed' &&
        d.data.inutilizationId === inutilization.id,
    );
    expect(completed).toHaveLength(1);
    expect(completed[0].data).toMatchObject({ start: 1, end: 3, series });
    // Sent again by a redelivery: nothing happens twice.
    await s.dispatch('nfe.inutilize', inutilization.id);
    expect(
      s.deliveries.filter(
        (d) =>
          d.eventType === 'nfe.inutilization.completed' &&
          d.data.inutilizationId === inutilization.id,
      ),
    ).toHaveLength(1);
  });

  it('refuses a range that holds a document that is not discarded: 409 INUTILIZATION_RANGE_IN_USE', async () => {
    const series = nextSeries++;
    const id = await issueInSeries(series);
    const number = Number((await s.row(id)).number);
    await expect(
      s.inutilizeService.create(
        h.tenantId,
        'test',
        range(number, number + 1, series),
      ),
    ).rejects.toMatchObject({
      response: { code: 'INUTILIZATION_RANGE_IN_USE' },
    });
  });

  it('accepts the range of a discarded document (a rejected one that was given up)', async () => {
    const series = nextSeries++;
    const id = await issueInSeries(series, 'FAKE-225');
    await s.resubmit.discard(id, h.tenantId, 'test');
    const number = Number((await s.row(id)).number);
    const { inutilization } = await s.inutilizeService.create(
      h.tenantId,
      'test',
      range(number, number, series),
    );
    expect(inutilization.status).toBe('pending');
  });

  it('inutilizing 10-12 with the current number 5 raises the sequence: the next NF-e is 13', async () => {
    const series = nextSeries++;
    // Five NF-e first.
    for (let n = 1; n <= 5; n += 1) await issueInSeries(series);
    expect(await current(series)).toBe(5);
    await s.inutilizeService.create(h.tenantId, 'test', range(10, 12, series));
    expect(await current(series)).toBe(12);
    const next = await issueInSeries(series);
    expect(Number((await s.row(next)).number)).toBe(13);
  });

  it('a range that overlaps a pending or approved one is refused: 409 INUTILIZATION_RANGE_OVERLAP', async () => {
    const series = nextSeries++;
    await s.inutilizeService.create(h.tenantId, 'test', range(1, 5, series));
    await expect(
      s.inutilizeService.create(h.tenantId, 'test', range(5, 8, series)),
    ).rejects.toMatchObject({
      response: { code: 'INUTILIZATION_RANGE_OVERLAP' },
    });
    // Another series is another numbering.
    await expect(
      s.inutilizeService.create(h.tenantId, 'test', range(1, 5, nextSeries++)),
    ).resolves.toBeDefined();
  });

  it('a rejected request frees the range for a new one', async () => {
    const series = nextSeries++;
    const first = await s.inutilizeService.create(h.tenantId, 'test', {
      ...range(1, 2, series),
      justification: `${JUSTIFICATION} FAKE-EVT-REJ`,
    });
    await s.dispatch('nfe.inutilize', first.inutilization.id);
    expect(await rowOf(first.inutilization.id)).toMatchObject({
      status: 'rejected',
      c_stat: '573',
    });
    expect(
      s.deliveries.filter(
        (d) =>
          d.eventType === 'nfe.inutilization.rejected' &&
          d.data.inutilizationId === first.inutilization.id,
      ),
    ).toHaveLength(1);
    await expect(
      s.inutilizeService.create(h.tenantId, 'test', range(1, 2, series)),
    ).resolves.toBeDefined();
  });

  it('a timeout sends the SAME request again; the SEFAZ answering 563 (already has it) is taken as done', async () => {
    const series = nextSeries++;
    const { inutilization } = await s.inutilizeService.create(
      h.tenantId,
      'test',
      {
        ...range(1, 2, series),
        justification: `${JUSTIFICATION} FAKE-EVT-TIMEOUT`,
      },
    );
    const sent: Array<string | undefined> = [];
    s.hooks.beforeEvent = (_kind, request) => {
      sent.push(request.signedXml);
      return undefined;
    };
    await s.dispatch('nfe.inutilize', inutilization.id);
    // The SEFAZ has it but the answer was lost: still pending, a second try queued.
    expect((await rowOf(inutilization.id)).status).toBe('pending');
    const messages = await s.messages('nfe.inutilize', inutilization.id);
    expect(messages.map((m) => m.payload.attempt)).toEqual([0, 1]);

    await s.dispatch('nfe.inutilize', inutilization.id);
    expect(await rowOf(inutilization.id)).toMatchObject({
      status: 'homologada',
      c_stat: '563',
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe(sent[1]);
    expect(sent[0]).toBe((await rowOf(inutilization.id)).request_xml);
  });

  it('a repeated Idempotency-Key answers with the same inutilization; another body is a conflict', async () => {
    const series = nextSeries++;
    const first = await s.inutilizeService.create(
      h.tenantId,
      'test',
      range(1, 2, series),
      'inut-key-1',
    );
    const again = await s.inutilizeService.create(
      h.tenantId,
      'test',
      range(1, 2, series),
      'inut-key-1',
    );
    expect(again.replayed).toBe(true);
    expect(again.inutilization.id).toBe(first.inutilization.id);
    await expect(
      s.inutilizeService.create(
        h.tenantId,
        'test',
        range(1, 3, series),
        'inut-key-1',
      ),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('refuses a justification outside 15 to 255 characters and an inverted or out-of-bounds range', async () => {
    const series = nextSeries++;
    await expect(
      s.inutilizeService.create(h.tenantId, 'test', {
        ...range(1, 2, series),
        justification: 'curta',
      }),
    ).rejects.toMatchObject({ response: { code: 'JUSTIFICATION_LENGTH' } });
    await expect(
      s.inutilizeService.create(h.tenantId, 'test', range(5, 2, series)),
    ).rejects.toMatchObject({
      response: { code: 'INUTILIZATION_RANGE_INVALID' },
    });
    await expect(
      s.inutilizeService.create(h.tenantId, 'test', range(0, 2, series)),
    ).rejects.toMatchObject({
      response: { code: 'INUTILIZATION_RANGE_INVALID' },
    });
  });

  it('lists the inutilizations, newest first, and filters by status', async () => {
    const series = nextSeries++;
    const { inutilization } = await s.inutilizeService.create(
      h.tenantId,
      'test',
      range(1, 2, series),
    );
    await s.dispatch('nfe.inutilize', inutilization.id);
    const page = await s.inutilizations.list(h.tenantId, 'test', {
      limit: 50,
      status: 'homologada',
    });
    expect(page.data.map((i) => i.id)).toContain(inutilization.id);
    expect(page.data.every((i) => i.status === 'homologada')).toBe(true);
  });

  it('is refused while production is closed for a live company', async () => {
    await expect(
      s.inutilizeService.create(h.tenantId, 'live', {
        ...range(1, 2, 1),
        companyId: h.liveCompanyId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'NFE_PRODUCTION_DISABLED' },
    });
  });
});
