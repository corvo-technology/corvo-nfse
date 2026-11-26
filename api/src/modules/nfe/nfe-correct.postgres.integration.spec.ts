import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from './testing/postgres-harness';
import { createNfeStack, type NfeStack } from './testing/nfe-stack';

const CORRECTION = 'Corrigir o endereço de entrega para a Rua das Flores, 20';

describePostgres(
  'NF-e correction letters on PostgreSQL (simulated SEFAZ)',
  () => {
    let h: PostgresHarness;
    let s: NfeStack;

    beforeAll(async () => {
      h = await createPostgresHarness('nfecorrect');
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

    const eventsOf = async (id: string) => {
      const rows: Array<Record<string, unknown>> = await h.admin.query(
        `SELECT * FROM "${h.schema}".nfe_document_events WHERE document_id = $1 ORDER BY n_seq, created_at`,
        [id],
      );
      return rows;
    };

    it('stores a signed pending letter with nSeqEvento 1 and queues nfe.correct; the NF-e stays authorized', async () => {
      const id = await s.issue('FAKE-100');
      const event = await s.correctService.correct(
        id,
        h.tenantId,
        'test',
        CORRECTION,
      );
      expect(event).toMatchObject({
        tpEvento: '110110',
        nSeq: 1,
        status: 'pending',
        text: CORRECTION,
      });
      const [row] = await eventsOf(id);
      expect(String(row.request_xml)).toContain('<Signature');
      expect(String(row.request_xml)).toContain('<xCondUso>');
      expect((await s.row(id)).status).toBe('authorized');
      expect(await s.messages('nfe.correct', id)).toHaveLength(1);
    });

    it('the handler registers it and sends the corrected webhook', async () => {
      const id = await s.issue('FAKE-100');
      await s.correctService.correct(id, h.tenantId, 'test', CORRECTION);
      await s.dispatch('nfe.correct', id);
      const [row] = await eventsOf(id);
      expect(row).toMatchObject({ status: 'registered', c_stat: '135' });
      expect(row.protocol).toBeTruthy();
      const sent = s.deliveries.filter(
        (d) =>
          d.eventType === 'nfe.document.corrected' && d.data.documentId === id,
      );
      expect(sent).toHaveLength(1);
      expect(sent[0].data).toMatchObject({ nSeq: 1, cStat: '135' });
      // A redelivery sends nothing more.
      await s.dispatch('nfe.correct', id);
      expect(
        s.deliveries.filter(
          (d) =>
            d.eventType === 'nfe.document.corrected' &&
            d.data.documentId === id,
        ),
      ).toHaveLength(1);
      expect((await s.row(id)).status).toBe('authorized');
    });

    it('two letters at once (two connections): nSeqEvento 1 and 2, never equal', async () => {
      const id = await s.issue('FAKE-100');
      const results = await Promise.all([
        s.correctService.correct(id, h.tenantId, 'test', CORRECTION),
        s.correctService.correct(
          id,
          h.tenantId,
          'test',
          'Corrigir a informação adicional da observação',
        ),
      ]);
      expect(results.map((r) => r.nSeq).sort()).toEqual([1, 2]);
      expect((await eventsOf(id)).map((e) => e.n_seq)).toEqual([1, 2]);
    });

    it('a refused letter does not stop the next one, which takes the next sequence', async () => {
      const id = await s.issue('FAKE-100');
      await s.correctService.correct(
        id,
        h.tenantId,
        'test',
        `${CORRECTION} FAKE-EVT-REJ`,
      );
      await s.dispatch('nfe.correct', id);
      expect((await eventsOf(id))[0]).toMatchObject({
        status: 'rejected',
        c_stat: '573',
      });
      const next = await s.correctService.correct(
        id,
        h.tenantId,
        'test',
        CORRECTION,
      );
      expect(next.nSeq).toBe(2);
      expect(
        s.deliveries.filter(
          (d) =>
            d.eventType === 'nfe.document.corrected' &&
            d.data.documentId === id,
        ),
      ).toHaveLength(0);
    });

    it('the 21st letter is refused with 422 CORRECTION_LIMIT_REACHED', async () => {
      const id = await s.issue('FAKE-100');
      for (let n = 1; n <= 20; n += 1)
        await s.correctService.correct(
          id,
          h.tenantId,
          'test',
          `${CORRECTION} (${n})`,
        );
      await expect(
        s.correctService.correct(id, h.tenantId, 'test', CORRECTION),
      ).rejects.toMatchObject({
        response: { code: 'CORRECTION_LIMIT_REACHED' },
      });
      expect(await eventsOf(id)).toHaveLength(20);
    }, 60000);

    it('a short or too long correction is refused with 422 CORRECTION_LENGTH', async () => {
      const id = await s.issue('FAKE-100');
      await expect(
        s.correctService.correct(id, h.tenantId, 'test', 'curta demais'),
      ).rejects.toMatchObject({ response: { code: 'CORRECTION_LENGTH' } });
      await expect(
        s.correctService.correct(id, h.tenantId, 'test', 'x'.repeat(1001)),
      ).rejects.toMatchObject({ response: { code: 'CORRECTION_LENGTH' } });
      expect(await eventsOf(id)).toHaveLength(0);
    });

    it('only an authorized NF-e takes a letter', async () => {
      const id = await s.issue('FAKE-302');
      await expect(
        s.correctService.correct(id, h.tenantId, 'test', CORRECTION),
      ).rejects.toMatchObject({ response: { code: 'NFE_INVALID_STATE' } });
    });

    it('a lost answer: the look finds the letter by its sequence and registers it', async () => {
      const id = await s.issue('FAKE-100');
      await s.correctService.correct(
        id,
        h.tenantId,
        'test',
        `${CORRECTION} FAKE-EVT-TIMEOUT`,
      );
      await s.dispatch('nfe.correct', id);
      expect((await eventsOf(id))[0].status).toBe('pending_check');
      await s.dispatch('nfe.reconcile', id);
      expect((await eventsOf(id))[0].status).toBe('registered');
    });

    it('GET events: the states and the letters in time order', async () => {
      const id = await s.issue('FAKE-100');
      await s.correctService.correct(id, h.tenantId, 'test', CORRECTION);
      await s.dispatch('nfe.correct', id);
      const timeline = await s.timeline.timeline(id, h.tenantId, 'test');
      expect(
        timeline.map((e) => `${e.kind}:${e.tpEvento ?? e.status}`),
      ).toEqual([
        'status:queued',
        'status:processing',
        'status:authorized',
        'event:110110',
      ]);
      expect(timeline.at(-1)).toMatchObject({
        status: 'registered',
        sequence: 1,
      });
      await expect(
        s.timeline.timeline(
          '00000000-0000-4000-8000-000000000000',
          h.tenantId,
          'test',
        ),
      ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    });
  },
);
