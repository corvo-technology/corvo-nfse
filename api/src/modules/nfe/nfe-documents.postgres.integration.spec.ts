import { PermanentEmailError } from '@/infra/external/email/mmsend-email.provider';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from './testing/postgres-harness';
import { createNfeStack, type NfeStack } from './testing/nfe-stack';

const JUSTIFICATION = 'Cancelamento por erro na digitação do pedido';
const CORRECTION = 'Corrigir o endereço de entrega da observação';

describePostgres('NF-e documents on PostgreSQL (simulated SEFAZ)', () => {
  let h: PostgresHarness;
  let s: NfeStack;

  beforeAll(async () => {
    h = await createPostgresHarness('nfedocs');
    s = createNfeStack(h);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(() => {
    s.redis.values.clear();
    s.redis.sets.clear();
    s.hooks.beforeEvent = undefined;
    s.mailer.send.mockReset().mockResolvedValue({ id: 'mail-1' });
  });

  const keyOf = (id: string, file: string) =>
    `${h.tenantId}/test/nfe/${id}/${file}`;
  const hooks = (type: string, id: string) =>
    s.deliveries.filter(
      (d) => d.eventType === type && d.data.documentId === id,
    );
  const prepared = async (id: string) => {
    await s.dispatch('nfe.prepare_documents', id);
    return id;
  };

  it('authorization queues one prepare message; the handler stores the nfeProc and the DANFE and marks it ready', async () => {
    const id = await s.issue('FAKE-100');
    expect(await s.messages('nfe.prepare_documents', id)).toHaveLength(1);
    expect((await s.row(id)).documents_ready_at).toBeNull();

    await prepared(id);

    const proc = String(s.objects.get(keyOf(id, 'nfe-proc.xml')));
    expect(proc).toContain('<nfeProc');
    expect(proc).toContain('<protNFe');
    expect(proc).toContain((await s.row(id)).access_key as string);
    const pdf = s.objects.get(keyOf(id, 'danfe.pdf')) as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await s.row(id)).documents_ready_at).not.toBeNull();
    expect(hooks('nfe.document.documents_ready', id)).toHaveLength(1);
  });

  it('running the handler again stores the same files and does not repeat the webhook or the e-mail', async () => {
    const id = await s.issue('FAKE-100');
    await prepared(id);
    const before = String(s.objects.get(keyOf(id, 'nfe-proc.xml')));
    const renders = jest.spyOn(s.renderer, 'render');
    await prepared(id);
    await prepared(id);
    expect(String(s.objects.get(keyOf(id, 'nfe-proc.xml')))).toBe(before);
    // The DANFE exists: it is not drawn again for an NF-e that is still authorized.
    expect(renders).not.toHaveBeenCalled();
    renders.mockRestore();
    expect(hooks('nfe.document.documents_ready', id)).toHaveLength(1);
    expect(await s.messages('nfe.send_email', id)).toHaveLength(1);
  });

  it('draws the DANFE of a test company as homologation', async () => {
    const id = await s.issue('FAKE-100');
    const renders = jest.spyOn(s.renderer, 'render');
    await prepared(id);
    expect(renders).toHaveBeenCalledWith(expect.any(String), {
      homologation: true,
      cancelled: false,
    });
    renders.mockRestore();
  });

  it('queues the e-mail with the documents when the recipient has one and sendEmail is not false', async () => {
    const id = await s.issue('FAKE-100');
    await prepared(id);
    expect(await s.messages('nfe.send_email', id)).toHaveLength(1);
    expect((await s.row(id)).email_status).toBe('queued');
  });

  it('queues no e-mail when sendEmail is false, or when the recipient has no address', async () => {
    const off = await s.intake.submit(
      h.tenantId,
      'test',
      s.input('FAKE-100', 'test', { sendEmail: false }),
      'no-mail-1',
    );
    await s.emit.process(off.id, h.tenantId, 'test');
    await prepared(off.id);
    const base = s.input('FAKE-100');
    const noAddress = await s.intake.submit(
      h.tenantId,
      'test',
      { ...base, recipient: { ...base.recipient, email: null } },
      'no-mail-2',
    );
    await s.emit.process(noAddress.id, h.tenantId, 'test');
    await prepared(noAddress.id);
    for (const id of [off.id, noAddress.id]) {
      expect(await s.messages('nfe.send_email', id)).toHaveLength(0);
      expect((await s.row(id)).email_status).toBeNull();
      expect((await s.row(id)).documents_ready_at).not.toBeNull();
    }
    expect((await s.row(off.id)).send_email).toBe(false);
  });

  it('does nothing for an NF-e that was not authorized', async () => {
    const id = await s.issue('FAKE-225');
    expect((await s.row(id)).status).toBe('rejected');
    await prepared(id);
    expect(s.objects.has(keyOf(id, 'nfe-proc.xml'))).toBe(false);
    expect((await s.row(id)).documents_ready_at).toBeNull();
  });

  it('sends the e-mail once, with the XML and the DANFE attached, and says email_sent', async () => {
    const id = await s.issue('FAKE-100');
    await prepared(id);
    await s.dispatch('nfe.send_email', id);

    expect(s.mailer.send).toHaveBeenCalledTimes(1);
    const mail = (s.mailer.send.mock.calls as unknown[][])[0][0] as {
      to: string[];
      subject: string;
      attachments: Array<{ filename: string; contentType: string }>;
      idempotencyKey: string;
    };
    expect(mail.to).toEqual(['maria@example.com']);
    expect(mail.subject).toMatch(/^\[TESTE\] Sua nota fiscal eletrônica nº /);
    expect(mail.attachments.map((a) => a.contentType)).toEqual([
      'application/xml',
      'application/pdf',
    ]);
    expect(mail.idempotencyKey).toBe(`nfe-email-${id}`);
    const row = await s.row(id);
    expect(row.email_status).toBe('sent');
    expect(row.email_sent_at).not.toBeNull();
    expect(hooks('nfe.document.email_sent', id)).toHaveLength(1);

    await s.dispatch('nfe.send_email', id);
    expect(s.mailer.send).toHaveBeenCalledTimes(1);
    expect(hooks('nfe.document.email_sent', id)).toHaveLength(1);
  });

  it('a refusal by the provider ends the e-mail as failed at once', async () => {
    const id = await s.issue('FAKE-100');
    await prepared(id);
    s.mailer.send.mockRejectedValueOnce(new PermanentEmailError('bad address'));
    await s.dispatch('nfe.send_email', id);
    expect((await s.row(id)).email_status).toBe('failed');
    expect(hooks('nfe.document.email_failed', id)).toHaveLength(1);
    expect(hooks('nfe.document.email_sent', id)).toHaveLength(0);
  });

  it('another error is thrown for a new try, and ends failed on the last one', async () => {
    const id = await s.issue('FAKE-100');
    await prepared(id);
    s.mailer.send.mockRejectedValue(new Error('provider down'));
    await expect(
      s.emailService.send(id, h.tenantId, 'test', false),
    ).rejects.toThrow('provider down');
    expect((await s.row(id)).email_status).toBe('queued');
    await s.emailService.send(id, h.tenantId, 'test', true);
    expect((await s.row(id)).email_status).toBe('failed');
    expect(hooks('nfe.document.email_failed', id)).toHaveLength(1);
  });

  it('a cancellation stores the event XML and draws the DANFE again with the mark; no e-mail after it', async () => {
    const id = await s.issue('FAKE-100');
    await prepared(id);
    await s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION);
    await s.dispatch('nfe.cancel', id);
    expect((await s.row(id)).status).toBe('cancelled');
    expect(await s.messages('nfe.prepare_documents', id)).toHaveLength(2);

    const renders = jest.spyOn(s.renderer, 'render');
    await prepared(id);
    expect(renders).toHaveBeenCalledWith(expect.any(String), {
      homologation: true,
      cancelled: true,
    });
    renders.mockRestore();
    const event = String(s.objects.get(keyOf(id, 'events/110111-1.xml')));
    expect(event).toContain('<procEventoNFe');
    const [stored]: Array<{ xml_path: string }> = await h.admin.query(
      `SELECT xml_path FROM "${h.schema}".nfe_document_events WHERE document_id = $1`,
      [id],
    );
    expect(stored.xml_path).toBe(keyOf(id, 'events/110111-1.xml'));
    // A cancelled NF-e is never e-mailed.
    await s.dispatch('nfe.send_email', id);
    expect(s.mailer.send).not.toHaveBeenCalled();
    // The documents stay available.
    expect((await s.row(id)).documents_ready_at).not.toBeNull();
  });

  it('an NF-e cancelled before its documents were prepared gets the marked DANFE at once', async () => {
    const id = await s.issue('FAKE-100');
    await s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION);
    await s.dispatch('nfe.cancel', id);
    const renders = jest.spyOn(s.renderer, 'render');
    await prepared(id);
    expect(renders).toHaveBeenCalledWith(expect.any(String), {
      homologation: true,
      cancelled: true,
    });
    renders.mockRestore();
    expect(s.objects.has(keyOf(id, 'nfe-proc.xml'))).toBe(true);
    expect(hooks('nfe.document.documents_ready', id)).toHaveLength(1);
  });

  it('a registered correction letter stores its XML by tpEvento and sequence', async () => {
    const id = await s.issue('FAKE-100');
    await prepared(id);
    await s.correctService.correct(id, h.tenantId, 'test', CORRECTION);
    await s.dispatch('nfe.correct', id);
    await prepared(id);
    expect(s.objects.has(keyOf(id, 'events/110110-1.xml'))).toBe(true);
    // The NF-e itself is untouched: still authorized, DANFE not drawn again.
    expect((await s.row(id)).status).toBe('authorized');
  });

  it('an approved inutilization stores its XML under nfe-inutilizacoes', async () => {
    const { inutilization } = await s.inutilizeService.create(
      h.tenantId,
      'test',
      {
        companyId: h.companyId,
        series: 77,
        start: 1,
        end: 2,
        justification: 'Numeração pulada por falha do sistema emissor',
      },
    );
    await s.dispatch('nfe.inutilize', inutilization.id);
    const prepares = await s.messages(
      'nfe.prepare_documents',
      inutilization.id,
    );
    expect(prepares).toHaveLength(1);
    await s.prepareHandler.handle(prepares[0]);
    const key = `${h.tenantId}/test/nfe-inutilizacoes/${inutilization.id}.xml`;
    expect(String(s.objects.get(key))).toContain('<ProcInutNFe');
    const [row]: Array<{ xml_path: string }> = await h.admin.query(
      `SELECT xml_path FROM "${h.schema}".nfe_inutilizations WHERE id = $1`,
      [inutilization.id],
    );
    expect(row.xml_path).toBe(key);
  });
});
