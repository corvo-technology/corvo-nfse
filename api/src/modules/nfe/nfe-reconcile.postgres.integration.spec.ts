import type { NfeConsultResult } from '@/infra/external/nfe/sefaz/signed-nfe';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from './testing/postgres-harness';
import { createNfeStack, type NfeStack } from './testing/nfe-stack';

describePostgres('NF-e reconciliation on PostgreSQL', () => {
  let h: PostgresHarness;
  let s: NfeStack;

  beforeAll(async () => {
    h = await createPostgresHarness('nfereconcile');
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
  });

  const currentNumber = async (): Promise<number> => {
    const rows: Array<{ current_number: number }> = await h.admin.query(
      `SELECT current_number FROM "${h.schema}".nfe_number_sequences WHERE company_id = $1`,
      [h.companyId],
    );
    return rows[0].current_number;
  };

  const authorizedEvents = (id: string) =>
    s.deliveries.filter(
      (d) =>
        d.eventType === 'nfe.document.authorized' && d.data.documentId === id,
    );

  /** The worker dies right after the SEFAZ answered: the answer is never recorded. */
  const issueAndCrashAfterSend = async (scenario: string) => {
    const accepted = await s.intake.submit(
      h.tenantId,
      'test',
      s.input(scenario),
      `crash-${Math.random()}`,
    );
    s.hooks.afterIssue = () => {
      throw new Error('worker killed');
    };
    await expect(
      s.emit.process(accepted.id, h.tenantId, 'test'),
    ).rejects.toThrow('worker killed');
    s.hooks.afterIssue = undefined;
    return accepted.id;
  };

  it('lost answer: the redelivered message reconciles by key, authorizes once and never renumbers', async () => {
    const id = await issueAndCrashAfterSend('FAKE-100');
    const sent = await s.row(id);
    expect(sent.status).toBe('processing');
    const numberAfterSend = await currentNumber();

    // The outbox delivers the emit message again.
    await s.emit.process(id, h.tenantId, 'test');
    const waiting = await s.row(id);
    expect(waiting.status).toBe('reconciliation_required');
    expect(waiting.access_key).toBe(sent.access_key);

    const [message] = await s.messages('nfe.reconcile', id);
    await s.reconcile.handle(message);
    await s.reconcile.handle(message);

    const done = await s.row(id);
    expect(done).toMatchObject({
      status: 'authorized',
      access_key: sent.access_key,
      number: sent.number,
      signed_xml: sent.signed_xml,
    });
    expect(await currentNumber()).toBe(numberAfterSend);
    expect(authorizedEvents(id)).toHaveLength(1);
    expect(await s.messages('nfe.prepare_documents', id)).toHaveLength(1);
  });

  it('the answer was lost with FAKE-TIMEOUT: the consultation adopts the authorization', async () => {
    const id = await s.issue('FAKE-TIMEOUT');
    const first = await s.row(id);
    const [message] = await s.messages('nfe.reconcile', id);
    await s.reconcile.handle(message);
    expect(await s.row(id)).toMatchObject({
      status: 'authorized',
      access_key: first.access_key,
    });
  });

  it('the SEFAZ does not know the key yet: another look is scheduled, nothing is resent', async () => {
    const accepted = await s.intake.submit(
      h.tenantId,
      'test',
      s.input('FAKE-100'),
      'not-yet',
    );
    s.hooks.beforeIssue = () => {
      throw new Error('worker killed before the send');
    };
    await expect(
      s.emit.process(accepted.id, h.tenantId, 'test'),
    ).rejects.toThrow();
    s.hooks.beforeIssue = undefined;
    await s.emit.process(accepted.id, h.tenantId, 'test');
    const [message] = await s.messages('nfe.reconcile', accepted.id);
    const issue = jest.spyOn(s.fake.issuer, 'issue');
    await s.reconcile.handle(message);
    expect(issue).not.toHaveBeenCalled();
    issue.mockRestore();
    const row = await s.row(accepted.id);
    expect(row).toMatchObject({
      status: 'reconciliation_required',
      reconcile_attempts: 2,
    });
    expect(await s.messages('nfe.reconcile', accepted.id)).toHaveLength(2);
  });

  it('after uncertainMaxHours a not_found sends the SAME signed XML again', async () => {
    const accepted = await s.intake.submit(
      h.tenantId,
      'test',
      s.input('FAKE-100'),
      'resend',
    );
    s.hooks.beforeIssue = () => {
      throw new Error('worker killed before the send');
    };
    await expect(
      s.emit.process(accepted.id, h.tenantId, 'test'),
    ).rejects.toThrow();
    s.hooks.beforeIssue = undefined;
    await s.emit.process(accepted.id, h.tenantId, 'test');
    const before = await s.row(accepted.id);
    await h.admin.query(
      `UPDATE "${h.schema}".nfe_documents SET issued_at = now() - interval '7 hours' WHERE id = $1`,
      [accepted.id],
    );
    const sentXml: string[] = [];
    s.hooks.beforeIssue = (doc) => {
      sentXml.push(doc.signedXml);
    };
    const doc = await s.consult.sync(accepted.id, h.tenantId, 'test', 'manual');
    expect(doc.status).toBe('authorized');
    expect(sentXml).toEqual([before.signed_xml]);
    expect(await s.row(accepted.id)).toMatchObject({
      number: before.number,
      access_key: before.access_key,
      attempt: 1,
    });
  });

  it('five automatic looks without an answer end in manual_review, and a manual sync can still settle it', async () => {
    const accepted = await s.intake.submit(
      h.tenantId,
      'test',
      s.input('FAKE-100'),
      'exhaust',
    );
    s.hooks.beforeIssue = () => {
      throw new Error('worker killed before the send');
    };
    await expect(
      s.emit.process(accepted.id, h.tenantId, 'test'),
    ).rejects.toThrow();
    s.hooks.beforeIssue = undefined;
    await s.emit.process(accepted.id, h.tenantId, 'test');
    for (let i = 0; i < 4; i += 1)
      await s.consult.sync(accepted.id, h.tenantId, 'test', 'automatic');
    expect((await s.row(accepted.id)).status).toBe('manual_review');
    expect(s.deliveries.at(-1)?.eventType).toBe('nfe.document.manual_review');
    // The SEFAZ now knows the key (the note had reached it): a person asks and it is adopted.
    const { signed_xml, access_key } = await s.row(accepted.id);
    await s.fake.issuer.issue(
      {
        accessKey: String(access_key),
        signedXml: String(signed_xml),
        uf: 'SP',
      },
      {} as never,
    );
    const doc = await s.consult.sync(accepted.id, h.tenantId, 'test', 'manual');
    expect(doc.status).toBe('authorized');
  });

  it('an authority that is paused postpones the look without spending an attempt', async () => {
    const id = await s.issue('FAKE-TIMEOUT');
    await s.breaker.recordFailure('test', 'nfe-sp-2');
    await s.breaker.recordFailure('test', 'nfe-sp-2');
    await s.consult.sync(id, h.tenantId, 'test', 'automatic');
    expect(await s.row(id)).toMatchObject({
      status: 'reconciliation_required',
      reconcile_attempts: 1,
    });
  });

  it('the SEFAZ says it was cancelled: the document ends cancelled, authorized once', async () => {
    const id = await s.issue('FAKE-TIMEOUT');
    s.hooks.consult = (key) => ({
      kind: 'ok',
      value: {
        status: 'cancelled',
        accessKey: key,
        cStat: '101',
        xMotivo: 'Cancelamento de NF-e homologado',
        events: [],
        authorization: {
          accessKey: key,
          protocol: '135260000000099',
          authorizedAt: new Date(),
          cStat: '100',
          xMotivo: 'Autorizado o uso da NF-e',
          protNFeXml: '<protNFe/>',
        },
      } satisfies NfeConsultResult,
    });
    const doc = await s.consult.sync(id, h.tenantId, 'test', 'automatic');
    expect(doc.status).toBe('cancelled');
    expect((await s.row(id)).protocol).toBe('135260000000099');
    expect(authorizedEvents(id)).toHaveLength(1);
    expect(s.deliveries.at(-1)?.eventType).toBe('nfe.document.cancelled');
  });

  it('the SEFAZ says it was denied, even from manual_review', async () => {
    const id = await s.issue('FAKE-TIMEOUT');
    await h.admin.query(
      `UPDATE "${h.schema}".nfe_documents SET status = 'manual_review' WHERE id = $1`,
      [id],
    );
    s.hooks.consult = (key) => ({
      kind: 'ok',
      value: {
        status: 'denied',
        accessKey: key,
        cStat: '110',
        xMotivo: 'Uso Denegado',
        events: [],
      },
    });
    const doc = await s.consult.sync(id, h.tenantId, 'test', 'manual');
    expect(doc.status).toBe('denied');
  });

  describe('sync, resubmission and discard', () => {
    it('sync of an authorized NF-e returns it as it is; of a queued one is a 409', async () => {
      const authorized = await s.issue('FAKE-100');
      expect(
        (await s.consult.sync(authorized, h.tenantId, 'test')).status,
      ).toBe('authorized');
      const queued = await s.intake.submit(
        h.tenantId,
        'test',
        s.input('FAKE-100'),
        'still-queued',
      );
      await expect(
        s.consult.sync(queued.id, h.tenantId, 'test'),
      ).rejects.toMatchObject({
        response: { code: 'NFE_INVALID_STATE' },
      });
    });

    it('resubmitting keeps the number, draws a new key and attempt 2; the same body again is a replay', async () => {
      const id = await s.issue('FAKE-225');
      const rejected = await s.row(id);
      const body = s.input('FAKE-100');
      const accepted = await s.resubmit.resubmit(id, h.tenantId, 'test', body);
      expect(accepted).toMatchObject({ id, status: 'queued', replayed: false });
      expect(
        await s.resubmit.resubmit(id, h.tenantId, 'test', body),
      ).toMatchObject({ replayed: true });
      await s.emit.process(id, h.tenantId, 'test');
      const row = await s.row(id);
      expect(row).toMatchObject({
        status: 'authorized',
        number: rejected.number,
        attempt: 2,
      });
      expect(row.access_key).not.toBe(rejected.access_key);
      const items: Array<{ code: string }> = await h.admin.query(
        `SELECT code FROM "${h.schema}".nfe_document_items WHERE document_id = $1`,
        [id],
      );
      expect(items).toEqual([{ code: 'FAKE-100' }]);
    });

    it('only a rejected NF-e can be resubmitted or discarded', async () => {
      const id = await s.issue('FAKE-100');
      await expect(
        s.resubmit.resubmit(
          id,
          h.tenantId,
          'test',
          s.input('FAKE-100', 'test', { additionalInfo: 'outra' }),
        ),
      ).rejects.toMatchObject({ response: { code: 'NFE_INVALID_STATE' } });
      await expect(
        s.resubmit.discard(id, h.tenantId, 'test'),
      ).rejects.toMatchObject({ response: { code: 'NFE_INVALID_STATE' } });
    });

    it('discarding a rejected NF-e ends it, and discarding again is harmless', async () => {
      const id = await s.issue('FAKE-225');
      expect((await s.resubmit.discard(id, h.tenantId, 'test')).status).toBe(
        'discarded',
      );
      expect((await s.resubmit.discard(id, h.tenantId, 'test')).status).toBe(
        'discarded',
      );
    });

    it('an unknown id is a 404', async () => {
      await expect(
        s.consult.sync(
          '00000000-0000-4000-8000-000000000000',
          h.tenantId,
          'test',
        ),
      ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    });
  });
});
