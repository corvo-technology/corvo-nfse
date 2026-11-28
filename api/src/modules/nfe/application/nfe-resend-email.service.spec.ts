import { NfeDocument } from '../domain/nfe-document';
import { documentParams } from '../testing/document-fixture';
import { NfeResendEmailService } from './nfe-resend-email.service';

function document(snapshot: object = {}, email: string | null = 'a@b.com') {
  const params = documentParams();
  const doc = NfeDocument.create({
    ...params,
    recipient: { ...params.recipient, email },
  });
  return NfeDocument.reconstitute({
    ...doc.toSnapshot(),
    status: 'authorized',
    documentsReadyAt: new Date(),
    ...snapshot,
  });
}

function build(doc: NfeDocument | null) {
  const findById = jest.fn().mockResolvedValue(doc);
  const touch = jest.fn().mockResolvedValue(undefined);
  const service = new NfeResendEmailService(
    { findById } as never,
    { touch } as never,
  );
  return { service, findById, touch };
}

const ask = (
  service: NfeResendEmailService,
  options: { toEmail?: string; idempotencyKey?: string } = {},
  model: 55 | 65 = 55,
) => service.request('d', 't', 'test', model, options);

const code = (c: string): unknown =>
  expect.objectContaining({ response: expect.objectContaining({ code: c }) });

describe('NfeResendEmailService', () => {
  it('queues one resend message with the request id, looking at the model asked', async () => {
    const { service, touch, findById } = build(document());
    const out = await ask(service, { idempotencyKey: 'req-1' }, 65);
    expect(out).toEqual({ emailId: 'req-1', status: 'queued' });
    expect(findById).toHaveBeenCalledWith('d', 't', 'test', { model: 65 });
    const options = (touch.mock.calls as unknown[][])[0][1] as {
      messages: { type: string; dedupeKey: string; payload: object }[];
    };
    expect(options.messages).toHaveLength(1);
    expect(options.messages[0]).toMatchObject({
      type: 'nfe.resend_email',
      dedupeKey: expect.stringContaining(':req-1'),
      payload: expect.objectContaining({ emailId: 'req-1' }),
    });
    expect(options.messages[0].payload).not.toHaveProperty('toEmail');
  });

  it('makes its own id without a key and carries the other address', async () => {
    const { service, touch } = build(document());
    const out = await ask(service, { toEmail: 'x@y.com' });
    expect(out.emailId).toMatch(/^eml_/);
    const options = (touch.mock.calls as unknown[][])[0][1] as {
      messages: { payload: { toEmail?: string } }[];
    };
    expect(options.messages[0].payload.toEmail).toBe('x@y.com');
  });

  it('sends to the address asked even when the note has none', async () => {
    const { service } = build(document({}, null));
    await expect(ask(service, { toEmail: 'x@y.com' })).resolves.toMatchObject({
      status: 'queued',
    });
  });

  it('refuses: no note, cancelled, not ready, no address, bad key', async () => {
    await expect(ask(build(null).service)).rejects.toEqual(
      code('RESOURCE_NOT_FOUND'),
    );
    await expect(
      ask(build(document({ status: 'cancelled' })).service),
    ).rejects.toEqual(code('INVOICE_CANCELLED_NO_EMAIL'));
    await expect(
      ask(build(document({ status: 'queued' })).service),
    ).rejects.toEqual(code('DOCUMENTS_NOT_READY'));
    await expect(
      ask(build(document({ documentsReadyAt: null })).service),
    ).rejects.toEqual(code('DOCUMENTS_NOT_READY'));
    await expect(ask(build(document({}, null)).service)).rejects.toEqual(
      code('CUSTOMER_EMAIL_MISSING'),
    );
    const { service, touch } = build(document());
    await expect(ask(service, { idempotencyKey: 'a b' })).rejects.toEqual(
      code('IDEMPOTENCY_KEY_INVALID'),
    );
    expect(touch).not.toHaveBeenCalled();
  });
});
