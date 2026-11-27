import { makeTestA1 } from '../../../test/fixtures/nfe/test-a1';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from './testing/postgres-harness';
import { createNfeStack, type NfeStack } from './testing/nfe-stack';

const JUSTIFICATION = 'Cancelamento por erro na digitação do pedido';

describePostgres('NF-e cancellation on PostgreSQL (simulated SEFAZ)', () => {
  let h: PostgresHarness;
  let s: NfeStack;

  beforeAll(async () => {
    h = await createPostgresHarness('nfecancel');
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
      `SELECT * FROM "${h.schema}".nfe_document_events WHERE document_id = $1 ORDER BY created_at, id`,
      [id],
    );
    return rows;
  };
  const statusOf = async (id: string) => (await s.row(id)).status;
  let current = '';
  const hooks = (type: string) =>
    s.deliveries.filter(
      (d) => d.eventType === type && d.data.documentId === current,
    );

  it('asks for the cancellation: cancelling, a signed pending event with nSeqEvento 1 and one message', async () => {
    const id = (current = await s.issue('FAKE-100'));
    const doc = await s.cancelService.cancel(
      id,
      h.tenantId,
      'test',
      JUSTIFICATION,
    );
    expect(doc.status).toBe('cancelling');
    const [event] = await eventsOf(id);
    expect(event).toMatchObject({
      tp_evento: '110111',
      n_seq: 1,
      status: 'pending',
      text: JUSTIFICATION,
    });
    expect(String(event.request_xml)).toContain('<Signature');
    expect(String(event.request_xml)).toContain('<nProt>');
    expect((await s.row(id)).cancel_reason).toBe(JUSTIFICATION);
    expect(await s.messages('nfe.cancel', id)).toHaveLength(1);
  });

  it('the handler sends it: event registered, NF-e cancelled, webhook once', async () => {
    const id = (current = await s.issue('FAKE-100'));
    await s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION);
    await s.dispatch('nfe.cancel', id);
    const [event] = await eventsOf(id);
    expect(event).toMatchObject({ status: 'registered', c_stat: '135' });
    expect(event.protocol).toBeTruthy();
    expect(await statusOf(id)).toBe('cancelled');
    expect(hooks('nfe.document.cancelled')).toHaveLength(1);
    // The message again (a redelivery) changes nothing.
    await s.dispatch('nfe.cancel', id);
    expect(hooks('nfe.document.cancelled')).toHaveLength(1);
  });

  it('FAKE-EVT-REJ: the SEFAZ refuses, the NF-e goes back to authorized and says cancellation_rejected', async () => {
    const id = (current = await s.issue('FAKE-100'));
    await s.cancelService.cancel(
      id,
      h.tenantId,
      'test',
      `${JUSTIFICATION} FAKE-EVT-REJ`,
    );
    const authorizedBefore = hooks('nfe.document.authorized').length;
    await s.dispatch('nfe.cancel', id);
    const [event] = await eventsOf(id);
    expect(event).toMatchObject({ status: 'rejected', c_stat: '573' });
    expect(await statusOf(id)).toBe('authorized');
    const rejected = hooks('nfe.document.cancellation_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].data).toMatchObject({
      cStat: '573',
      xMotivo: 'Rejeição: Duplicidade de Evento',
    });
    // Going back to authorized does not announce "authorized" again.
    expect(hooks('nfe.document.authorized')).toHaveLength(authorizedBefore);
    // The customer can ask again: the same event row is reused (nSeqEvento 1 was never registered).
    await s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION);
    await s.dispatch('nfe.cancel', id);
    expect(await eventsOf(id)).toHaveLength(1);
    expect(await statusOf(id)).toBe('cancelled');
  });

  it('a timeout leaves the event pending_check; the look finds it registered (procEventoNFe)', async () => {
    const id = (current = await s.issue('FAKE-100'));
    await s.cancelService.cancel(
      id,
      h.tenantId,
      'test',
      `${JUSTIFICATION} FAKE-EVT-TIMEOUT`,
    );
    await s.dispatch('nfe.cancel', id);
    const [pending] = await eventsOf(id);
    expect(pending.status).toBe('pending_check');
    expect(await statusOf(id)).toBe('cancelling');
    const looks = await s.messages('nfe.reconcile', id);
    expect(looks.at(-1)?.payload).toMatchObject({ eventId: pending.id });

    await s.dispatch('nfe.reconcile', id);
    const [event] = await eventsOf(id);
    expect(event).toMatchObject({ status: 'registered' });
    expect(event.proc_xml).toContain('procEventoNFe');
    expect(await statusOf(id)).toBe('cancelled');
    expect(hooks('nfe.document.cancelled')).toHaveLength(1);
  });

  it('a timeout where the SEFAZ never saw it: the SAME request goes out again and is registered', async () => {
    const id = (current = await s.issue('FAKE-100'));
    await s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION);
    const sent: Array<string | undefined> = [];
    let first = true;
    s.hooks.beforeEvent = (_kind, request) => {
      sent.push(request.signedXml);
      if (!first) return undefined;
      first = false;
      return { kind: 'uncertain', reason: 'timeout' };
    };
    await s.dispatch('nfe.cancel', id);
    expect((await eventsOf(id))[0].status).toBe('pending_check');
    const stored = (await eventsOf(id))[0].request_xml;

    // The look: the SEFAZ answers and has no such event.
    await s.dispatch('nfe.reconcile', id);
    expect((await eventsOf(id))[0].status).toBe('pending');
    expect(await s.messages('nfe.cancel', id)).toHaveLength(2);

    await s.dispatch('nfe.cancel', id);
    expect((await eventsOf(id))[0].status).toBe('registered');
    expect(await statusOf(id)).toBe('cancelled');
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe(stored);
    expect(sent[1]).toBe(stored);
  });

  it('while the SEFAZ does not answer the look, it looks again (up to the limit)', async () => {
    const id = (current = await s.issue('FAKE-100'));
    await s.cancelService.cancel(
      id,
      h.tenantId,
      'test',
      `${JUSTIFICATION} FAKE-EVT-TIMEOUT`,
    );
    await s.dispatch('nfe.cancel', id);
    s.hooks.consult = () => ({ kind: 'uncertain', reason: 'timeout' });
    try {
      await s.dispatch('nfe.reconcile', id);
    } finally {
      s.hooks.consult = undefined;
    }
    expect((await eventsOf(id))[0].status).toBe('pending_check');
    const looks = await s.messages('nfe.reconcile', id);
    expect(looks.map((m) => m.payload.attempt)).toEqual([1, 2]);
  });

  it('refuses a 14-character justification with 422 JUSTIFICATION_LENGTH and changes nothing', async () => {
    const id = (current = await s.issue('FAKE-100'));
    await expect(
      s.cancelService.cancel(id, h.tenantId, 'test', 'x'.repeat(14)),
    ).rejects.toMatchObject({
      response: { code: 'JUSTIFICATION_LENGTH', type: 'validation' },
    });
    await expect(
      s.cancelService.cancel(id, h.tenantId, 'test', 'x'.repeat(256)),
    ).rejects.toMatchObject({ response: { code: 'JUSTIFICATION_LENGTH' } });
    expect(await statusOf(id)).toBe('authorized');
    expect(await eventsOf(id)).toHaveLength(0);
  });

  it('only an authorized NF-e is cancelled: others answer NFE_INVALID_STATE', async () => {
    const denied = await s.issue('FAKE-302');
    await expect(
      s.cancelService.cancel(denied, h.tenantId, 'test', JUSTIFICATION),
    ).rejects.toMatchObject({ response: { code: 'NFE_INVALID_STATE' } });
    const rejected = await s.issue('FAKE-225');
    await expect(
      s.cancelService.cancel(rejected, h.tenantId, 'test', JUSTIFICATION),
    ).rejects.toMatchObject({ response: { code: 'NFE_INVALID_STATE' } });
    const id = (current = await s.issue('FAKE-100'));
    await s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION);
    await expect(
      s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION),
    ).rejects.toMatchObject({ response: { code: 'NFE_INVALID_STATE' } });
  });

  it('two cancellations at once: one wins, one event', async () => {
    const id = (current = await s.issue('FAKE-100'));
    const results = await Promise.allSettled([
      s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION),
      s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await eventsOf(id)).toHaveLength(1);
  });

  it('the log of the timeline joins the states and the event', async () => {
    const id = (current = await s.issue('FAKE-100'));
    await s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION);
    await s.dispatch('nfe.cancel', id);
    const timeline = await s.timeline.timeline(id, h.tenantId, 'test');
    const names = timeline.map((e) => `${e.kind}:${e.tpEvento ?? e.status}`);
    expect(names.slice(0, 3)).toEqual([
      'status:queued',
      'status:processing',
      'status:authorized',
    ]);
    // The request and the state change of the same transaction share the instant.
    expect(names.slice(3, 5).sort()).toEqual([
      'event:110111',
      'status:cancelling',
    ]);
    expect(names[5]).toBe('status:cancelled');
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
    const credits = async (id: string) => {
      const rows: Array<{ amount: number; is_reservation: boolean }> =
        await h.admin.query(
          `SELECT amount, is_reservation FROM "${h.schema}".credit_transactions
            WHERE reserved_nfe_document_id = $1 OR related_transaction_id IN (SELECT id FROM "${h.schema}".credit_transactions WHERE reserved_nfe_document_id = $1)
            ORDER BY created_at, id`,
          [id],
        );
      return rows.map((r) => [r.amount, r.is_reservation]);
    };

    it('cancelling after the authorization does NOT give the credit back (signing with the real certificate)', async () => {
      const id = await live.issue('FAKE-100', 'live');
      await live.cancelService.cancel(id, h.tenantId, 'live', JUSTIFICATION);
      const [event]: Array<{ request_xml: string }> = await h.admin.query(
        `SELECT request_xml FROM "${h.schema}".nfe_document_events WHERE document_id = $1`,
        [id],
      );
      expect(event.request_xml).toContain('<SignatureValue>');
      await live.dispatch('nfe.cancel', id);
      expect((await live.row(id)).status).toBe('cancelled');
      expect(await credits(id)).toEqual([[-1, false]]);
    });

    it('a live company is refused while production is closed', async () => {
      const closed = createNfeStack(h, { certificate: { pfx, password } });
      const id = await live.issue('FAKE-100', 'live');
      await expect(
        closed.cancelService.cancel(id, h.tenantId, 'live', JUSTIFICATION),
      ).rejects.toMatchObject({
        response: { code: 'NFE_PRODUCTION_DISABLED', type: 'configuration' },
      });
    });
  });
});
