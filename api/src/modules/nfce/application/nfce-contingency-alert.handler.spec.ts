import { NfeDocument } from '@/modules/nfe/domain/nfe-document';
import { documentParams } from '@/modules/nfe/testing/document-fixture';
import { NfceContingencyAlertHandler } from './nfce-contingency-alert.handler';

const HOUR = 3_600_000;
const AT = new Date('2026-11-26T13:00:00Z');

function build(environment: 'test' | 'live', status = 'contingency_pending') {
  const doc = NfeDocument.createOffline({
    ...documentParams(),
    environment,
    model: 65,
    contingencyAt: AT,
    contingencyReason: 'SEFAZ indisponivel',
  });
  if (status !== 'contingency_pending') {
    doc.transitionTo('processing');
    doc.transitionTo(status as never);
  }
  const publish = jest.fn<Promise<void>, [unknown, string, unknown]>();
  publish.mockResolvedValue(undefined);
  const notices = jest.fn<void, [unknown]>();
  const handler = new NfceContingencyAlertHandler(
    { register: jest.fn() } as never,
    { findById: () => Promise.resolve(doc) } as never,
    {
      touch: (_key: unknown, options: { change: (d: NfeDocument) => void }) => {
        options.change(doc);
        return Promise.resolve(doc);
      },
    } as never,
    { publish } as never,
    { publishBestEffort: notices } as never,
  );
  return { doc, handler, publish, notices };
}

describe('NfceContingencyAlertHandler', () => {
  it('a live note: the webhook and the e-mail to the account owner, once', async () => {
    const { handler, publish, notices, doc } = build('live');
    const at = new Date(AT.getTime() + 20 * HOUR);
    await handler.process(doc.id, doc.tenantId, 'live', at);
    await handler.process(doc.id, doc.tenantId, 'live', at);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][1]).toBe('nfce.contingency.deadline_near');
    expect(notices).toHaveBeenCalledTimes(1);
    expect(notices.mock.calls[0][0]).toMatchObject({
      name: 'account.notice',
      tenantId: doc.tenantId,
      notice: {
        kind: 'nfce-contingency-deadline',
        documentId: doc.id,
        deadlineAt: new Date(AT.getTime() + 24 * HOUR),
      },
    });
  });

  it('a test note: the webhook only, no e-mail', async () => {
    const { handler, publish, notices, doc } = build('test');
    await handler.process(
      doc.id,
      doc.tenantId,
      'test',
      new Date(AT.getTime() + 22 * HOUR),
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(notices).not.toHaveBeenCalled();
  });

  it('refuses to warn before 20 hours, and a note that is not waiting gets no warning', async () => {
    const early = build('live');
    await expect(
      early.handler.process(
        early.doc.id,
        early.doc.tenantId,
        'live',
        new Date(AT.getTime() + 19 * HOUR),
      ),
    ).rejects.toThrow();
    expect(early.publish).not.toHaveBeenCalled();

    const rejected = build('live', 'rejected');
    await rejected.handler.process(
      rejected.doc.id,
      rejected.doc.tenantId,
      'live',
      new Date(AT.getTime() + 21 * HOUR),
    );
    expect(rejected.publish).not.toHaveBeenCalled();
  });
});
