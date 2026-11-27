import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '@/modules/nfe/testing/postgres-harness';
import { createNfeStack, type NfeStack } from '@/modules/nfe/testing/nfe-stack';

describePostgres('NFC-e documents on PostgreSQL (DANFCE)', () => {
  let h: PostgresHarness;
  let s: NfeStack;

  beforeAll(async () => {
    h = await createPostgresHarness('nfcedocs');
    s = createNfeStack(h);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  // The in-memory S3 cannot presign: the call is what is under test (name and file).
  const signed = () =>
    jest
      .spyOn(s.storage, 'getFileSignedUrl')
      .mockImplementation((_ref, file, opts) =>
        Promise.resolve({
          url: `https://signed.example/${file}`,
          expiresAt: new Date(),
          fileName: opts?.downloadName ?? file,
          mimeType: 'application/pdf',
        }),
      );

  beforeEach(() => {
    s.redis.values.clear();
    s.redis.sets.clear();
    s.mailer.send.mockClear();
  });

  const keysOf = (id: string) =>
    [...s.objects.keys()].filter((key) => key.includes(id));
  const danfceKey = (id: string) =>
    keysOf(id).find((key) => key.endsWith('/danfce.pdf'))!;

  const authorized = async (overrides: Record<string, unknown> = {}) => {
    const accepted = await s.nfceIntake.submit(
      h.tenantId,
      'test',
      s.nfceInput('FAKE-100', 'test', overrides),
      `nfce-docs-${Math.random()}`,
    );
    await s.emit.process(accepted.id, h.tenantId, 'test');
    return accepted.id;
  };

  it('an authorized NFC-e gets documents_ready, danfce.pdf in the storage and the PDF by the files service', async () => {
    const id = await authorized();
    await s.dispatch('nfe.prepare_documents', id);

    expect((await s.row(id)).documents_ready_at).not.toBeNull();
    const keys = keysOf(id);
    expect(keys.some((key) => key.endsWith('/danfce.pdf'))).toBe(true);
    expect(keys.some((key) => key.endsWith('/nfe-proc.xml'))).toBe(true);
    expect(keys.some((key) => key.endsWith('/danfe.pdf'))).toBe(false);
    expect(s.deliveries.at(-1)).toMatchObject({
      eventType: 'nfce.document.documents_ready',
      data: { documentType: 'nfce', emailRequested: false },
    });

    const pdf = await s.files.read(id, h.tenantId, 'test', 'pdf');
    expect(pdf.fileName).toMatch(/^nfce-\d+\.pdf$/);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    const a4 = await s.files.read(id, h.tenantId, 'test', 'pdf', {
      layout: 'a4',
    });
    expect(a4.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(a4.body.equals(pdf.body)).toBe(false);
    // The A4 sheet is drawn when asked for: it is not stored.
    expect(keysOf(id).filter((key) => key.endsWith('.pdf'))).toHaveLength(1);
    const spy = signed();
    const link = await s.files.downloadUrl(id, h.tenantId, 'test', 'pdf');
    expect(link.fileName).toMatch(/^nfce-\d+\.pdf$/);
    expect(link.url).toBe('https://signed.example/danfce.pdf');
    spy.mockRestore();
  });

  it('without an e-mail of the consumer nothing is sent and no email_failed is published', async () => {
    const id = await authorized();
    await s.dispatch('nfe.prepare_documents', id);
    expect(await s.messages('nfe.send_email', id)).toHaveLength(0);
    expect(await s.dispatch('nfe.send_email', id)).toBe(0);
    expect(s.mailer.send).not.toHaveBeenCalled();
    expect(
      s.deliveries.some((d) => String(d.eventType).includes('email_failed')),
    ).toBe(false);
    expect((await s.row(id)).email_status).toBeNull();
  });

  it('with the e-mail of the consumer it sends the DANFCE and the XML as nfce', async () => {
    const id = await authorized({
      recipient: { taxId: '123.456.789-09', email: 'maria@example.com' },
    });
    await s.dispatch('nfe.prepare_documents', id);
    expect(s.deliveries.at(-1)).toMatchObject({
      eventType: 'nfce.document.documents_ready',
      data: { emailRequested: true },
    });
    expect(await s.messages('nfe.send_email', id)).toHaveLength(1);
    await s.dispatch('nfe.send_email', id);

    expect(s.mailer.send).toHaveBeenCalledTimes(1);
    const calls = s.mailer.send.mock.calls as unknown[][];
    const mail = calls[0][0] as {
      to: string[];
      subject: string;
      attachments: Array<{ filename: string; contentType: string }>;
      idempotencyKey: string;
    };
    expect(mail.to).toEqual(['maria@example.com']);
    expect(mail.subject).toContain('Sua NFC-e');
    expect(mail.attachments.map((a) => a.contentType)).toEqual([
      'application/xml',
      'application/pdf',
    ]);
    expect(mail.attachments[0].filename).toMatch(/^nfce-\d+\.xml$/);
    expect(mail.attachments[1].filename).toMatch(/^danfce-\d+\.pdf$/);
    expect(mail.idempotencyKey).toBe(`nfce-email-${id}`);
    expect((await s.row(id)).email_status).toBe('sent');
    expect(s.deliveries.at(-1)).toMatchObject({
      eventType: 'nfce.document.email_sent',
      data: { documentType: 'nfce' },
    });
  });

  it('a NF-e of the same company still gets its DANFE and e-mail as nfe', async () => {
    const nfe = await s.issue('FAKE-100');
    await s.dispatch('nfe.prepare_documents', nfe);
    const keys = keysOf(nfe);
    expect(keys.some((key) => key.endsWith('/danfe.pdf'))).toBe(true);
    expect(keys.some((key) => key.endsWith('/danfce.pdf'))).toBe(false);
  });

  it('a cancelled NFC-e keeps its documents and redraws the cupom with the mark', async () => {
    const id = await authorized();
    await s.dispatch('nfe.prepare_documents', id);
    const before = Buffer.from(s.objects.get(danfceKey(id))!);
    await h.admin.query(
      `UPDATE "${h.schema}".nfe_documents SET status = 'cancelled' WHERE id = $1`,
      [id],
    );
    await s.dispatch('nfe.prepare_documents', id);
    const after = Buffer.from(s.objects.get(danfceKey(id))!);
    expect(after.equals(before)).toBe(false);
    const read = await s.files.read(id, h.tenantId, 'test', 'pdf');
    expect(read.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('a cupom authorized before the DANFCE existed is drawn on demand', async () => {
    const id = await authorized();
    await s.dispatch('nfe.prepare_documents', id);
    s.objects.delete(danfceKey(id));
    const pdf = await s.files.read(id, h.tenantId, 'test', 'pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    const spy = signed();
    await s.files.downloadUrl(id, h.tenantId, 'test', 'pdf');
    spy.mockRestore();
    expect(keysOf(id).some((key) => key.endsWith('/danfce.pdf'))).toBe(true);
  });
});
