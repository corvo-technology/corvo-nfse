import { NfeDocument } from '../domain/nfe-document';
import { documentParams } from '../testing/document-fixture';
import { NfeEmailService } from './nfe-email.service';

/** An authorized, ready NF-e (the recipient e-mail is the test's choice). */
function readyDocument(email: string | null, overrides: object = {}) {
  const params = documentParams();
  const doc = NfeDocument.create({
    ...params,
    recipient: { ...params.recipient, email },
  });
  const snapshot = {
    ...doc.toSnapshot(),
    status: 'authorized' as const,
    documentsReadyAt: new Date(),
    ...overrides,
  };
  return NfeDocument.reconstitute(snapshot);
}

function build(doc: NfeDocument | null) {
  const storage = { getFile: jest.fn().mockResolvedValue(Buffer.from('x')) };
  const mailer = { send: jest.fn().mockResolvedValue({ id: 'm' }) };
  const transitions = { touch: jest.fn().mockResolvedValue(undefined) };
  const webhooks = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new NfeEmailService(
    { findById: jest.fn().mockResolvedValue(doc) } as never,
    storage as never,
    {
      findByIdAndTenantId: jest
        .fn()
        .mockResolvedValue({ legalName: 'Acme', tradeName: null }),
    } as never,
    transitions as never,
    webhooks as never,
    mailer as never,
  );
  return { service, storage, mailer, transitions, webhooks };
}

const run = (service: NfeEmailService) => service.send('d', 't', 'test', false);

describe('NfeEmailService', () => {
  it('does nothing for an NF-e that is gone, cancelled, already e-mailed or without an address', async () => {
    const cases = [
      null,
      readyDocument('a@b.com', { status: 'cancelled' }),
      readyDocument('a@b.com', { emailStatus: 'sent' }),
      readyDocument(null),
      readyDocument('a@b.com', { documentsReadyAt: null }),
    ];
    for (const doc of cases) {
      const { service, mailer, webhooks } = build(doc);
      await run(service);
      expect(mailer.send).not.toHaveBeenCalled();
      expect(webhooks.publish).not.toHaveBeenCalled();
    }
  });

  it('sends to the recipient with both files attached and marks it sent', async () => {
    const { service, mailer, transitions, webhooks } = build(
      readyDocument('maria@example.com'),
    );
    await run(service);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const mail = (mailer.send.mock.calls as unknown[][])[0][0] as {
      to: string[];
      attachments: unknown[];
    };
    expect(mail.to).toEqual(['maria@example.com']);
    expect(mail.attachments).toHaveLength(2);
    expect(transitions.touch).toHaveBeenCalledTimes(1);
    expect(webhooks.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'nfe' }),
      'nfe.document.email_sent',
      expect.objectContaining({ emailStatus: 'sent' }),
    );
  });

  it('never puts the address or the XML in the webhook data', async () => {
    const { service, webhooks } = build(readyDocument('maria@example.com'));
    await run(service);
    const data = JSON.stringify(
      (webhooks.publish.mock.calls as unknown[][])[0][2],
    );
    expect(data).not.toContain('maria@example.com');
    expect(data).not.toContain('<');
  });

  it('fails with a clear error when the provider is not available in this process', async () => {
    const service = new NfeEmailService(
      {
        findById: jest.fn().mockResolvedValue(readyDocument('a@b.com')),
      } as never,
      { getFile: jest.fn().mockResolvedValue(Buffer.from('x')) } as never,
      {} as never,
      { touch: jest.fn() } as never,
      { publish: jest.fn() } as never,
    );
    await expect(run(service)).rejects.toThrow('provider is not available');
  });

  describe('resend', () => {
    const again = (
      service: NfeEmailService,
      request: { emailId: string; toEmail?: string } = { emailId: 'r1' },
      lastAttempt = false,
    ) => service.resend('d', 't', 'test', request, lastAttempt);

    it('sends again even when it was sent before, to the other address, with a key of its own', async () => {
      const { service, mailer, transitions } = build(
        readyDocument('maria@example.com', { emailStatus: 'sent' }),
      );
      await again(service, { emailId: 'r1', toEmail: 'outro@example.com' });
      const mail = (mailer.send.mock.calls as unknown[][])[0][0] as {
        to: string[];
        idempotencyKey: string;
        attachments: unknown[];
      };
      expect(mail.to).toEqual(['outro@example.com']);
      expect(mail.attachments).toHaveLength(2);
      expect(mail.idempotencyKey).toMatch(/^nfe-email-.+-r1$/);
      expect(transitions.touch).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a note that is not authorized or has no address at all', async () => {
      for (const doc of [
        null,
        readyDocument('a@b.com', { status: 'cancelled' }),
        readyDocument('a@b.com', { documentsReadyAt: null }),
        readyDocument(null),
      ]) {
        const { service, mailer } = build(doc);
        await again(service);
        expect(mailer.send).not.toHaveBeenCalled();
      }
    });

    it('on the last failed try says failed, but a note already delivered keeps its status', async () => {
      const failing = (doc: NfeDocument) => {
        const built = build(doc);
        built.mailer.send.mockRejectedValue(new Error('boom'));
        return built;
      };
      const first = failing(readyDocument('a@b.com'));
      await expect(again(first.service)).rejects.toThrow('boom');
      await again(first.service, { emailId: 'r1' }, true);
      expect(first.transitions.touch).toHaveBeenCalledTimes(1);
      expect(first.webhooks.publish).toHaveBeenCalledWith(
        expect.anything(),
        'nfe.document.email_failed',
        expect.anything(),
      );
      const delivered = failing(
        readyDocument('a@b.com', { emailStatus: 'sent' }),
      );
      await again(delivered.service, { emailId: 'r1' }, true);
      expect(delivered.transitions.touch).not.toHaveBeenCalled();
    });
  });
});
