import { NfeDocument } from '../domain/nfe-document';
import { documentParams } from '../testing/document-fixture';
import { NfeTransitionService } from './nfe-transition.service';

function build(stored: NfeDocument | null) {
  const calls: string[] = [];
  const documents = {
    findById: jest.fn().mockResolvedValue(stored),
    save: jest.fn().mockImplementation(() => {
      calls.push('save');
      return Promise.resolve();
    }),
    appendHistory: jest.fn().mockImplementation(() => {
      calls.push('history');
      return Promise.resolve();
    }),
  };
  const ledger = {
    settle: jest.fn().mockImplementation(() => {
      calls.push('settle');
      return Promise.resolve();
    }),
  };
  const outbox = {
    enqueue: jest.fn().mockImplementation(() => {
      calls.push('outbox');
      return Promise.resolve(true);
    }),
  };
  const webhooks = {
    publish: jest.fn().mockImplementation(() => {
      calls.push('webhook');
      return Promise.resolve();
    }),
  };
  const cache = { delete: jest.fn().mockResolvedValue(undefined) };
  const service = new NfeTransitionService(
    { execute: <T>(work: () => Promise<T>) => work() },
    { locked: <T>(_t: string, work: () => Promise<T>) => work() } as never,
    documents as never,
    ledger as never,
    outbox as never,
    webhooks as never,
    cache as never,
  );
  return { service, documents, ledger, outbox, webhooks, cache, calls };
}

const keyOf = (doc: NfeDocument) => ({
  id: doc.id,
  tenantId: doc.tenantId,
  environment: doc.environment,
});

describe('NfeTransitionService', () => {
  it('writes state, history, messages and credit in one go, then the webhook', async () => {
    const doc = NfeDocument.create(documentParams());
    doc.transitionTo('processing');
    const f = build(doc);
    const message = {
      tenantId: doc.tenantId,
      environment: doc.environment,
      type: 'nfe.prepare_documents',
      aggregateId: doc.id,
      payload: { documentId: doc.id },
      dedupeKey: `prepare:${doc.id}`,
    };
    const result = await f.service.apply(keyOf(doc), 'authorized', {
      info: { cStat: '100', xMotivo: 'Autorizado o uso da NF-e' },
      change: (d) =>
        d.recordAuthorization({
          accessKey: '3'.repeat(44),
          protocol: '135260000000001',
          protNFeXml: '<protNFe/>',
        }),
      messages: [message],
    });
    expect(result.applied).toBe(true);
    expect(f.calls).toEqual(['save', 'history', 'outbox', 'settle', 'webhook']);
    expect(f.ledger.settle).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'nfe', id: doc.id }),
      'processing',
      'authorized',
    );
    expect(f.webhooks.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'nfe', id: doc.id }),
      'nfe.document.authorized',
      expect.objectContaining({
        status: 'authorized',
        protocol: '135260000000001',
      }),
    );
    expect(result.document.toSnapshot()).toMatchObject({
      status: 'authorized',
      protocol: '135260000000001',
      protNfeXml: '<protNFe/>',
    });
  });

  it('does nothing when the stored state already is the destination (the once-only latch)', async () => {
    const doc = NfeDocument.create(documentParams());
    doc.transitionTo('processing');
    doc.transitionTo('authorized');
    const f = build(doc);
    const change = jest.fn();
    const result = await f.service.apply(keyOf(doc), 'authorized', { change });
    expect(result.applied).toBe(false);
    expect(change).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
  });

  it('does nothing when the stored state is not an allowed origin', async () => {
    const doc = NfeDocument.create(documentParams());
    doc.transitionTo('processing');
    doc.transitionTo('rejected');
    const f = build(doc);
    const result = await f.service.apply(keyOf(doc), 'processing', {
      from: ['queued', 'retry_pending'],
    });
    expect(result.applied).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('sends no webhook for states without an event, and none for a test document balance cache', async () => {
    const doc = NfeDocument.create(documentParams());
    const f = build(doc);
    await f.service.apply(keyOf(doc), 'processing');
    expect(f.webhooks.publish).not.toHaveBeenCalled();
    expect(f.cache.delete).not.toHaveBeenCalled();
  });

  it('invalidates the credit balance of a live document', async () => {
    const doc = NfeDocument.create(documentParams({ environment: 'live' }));
    const f = build(doc);
    await f.service.apply(keyOf(doc), 'processing');
    expect(f.cache.delete).toHaveBeenCalledWith(
      `credit:balance:${doc.tenantId}`,
    );
  });

  it('a state the machine does not allow fails before writing anything', async () => {
    const doc = NfeDocument.create(documentParams());
    const f = build(doc);
    await expect(f.service.apply(keyOf(doc), 'authorized')).rejects.toThrow(
      'Invalid NF-e transition',
    );
    expect(f.calls).toEqual([]);
  });
});
