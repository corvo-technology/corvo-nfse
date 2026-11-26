import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import { NfeDocument } from '../domain/nfe-document';
import { documentParams } from '../testing/document-fixture';
import { NfePrepareDocumentsHandler } from './nfe-prepare-documents.handler';

function message(payload: Record<string, unknown>): OutboxMessage {
  return {
    id: 'm1',
    tenantId: 't1',
    environment: 'test',
    type: 'nfe.prepare_documents',
    aggregateId: 'a1',
    payload,
    dedupeKey: 'k',
    status: 'claimed',
    availableAt: new Date(),
    leaseUntil: null,
    attempts: 1,
    lastError: null,
  };
}

function build(options: { doc?: NfeDocument | null } = {}) {
  const storage = {
    fileExists: jest.fn().mockResolvedValue(false),
    saveFile: jest.fn().mockResolvedValue('key'),
  };
  const documents = {
    findById: jest.fn().mockResolvedValue(options.doc ?? null),
  };
  const inutilizations = {
    find: jest.fn().mockResolvedValue(null),
    markStored: jest.fn(),
  };
  const handler = new NfePrepareDocumentsHandler(
    { register: jest.fn() } as never,
    documents as never,
    storage as never,
    { type: 'nfe', render: jest.fn() } as never,
    { list: jest.fn().mockResolvedValue([]), markStored: jest.fn() } as never,
    inutilizations as never,
    { touch: jest.fn() } as never,
    { publish: jest.fn() } as never,
  );
  return { handler, storage, documents, inutilizations };
}

describe('NfePrepareDocumentsHandler', () => {
  it('registers itself for nfe.prepare_documents', () => {
    const registry = { register: jest.fn() };
    const handler = new NfePrepareDocumentsHandler(
      registry as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
    expect(handler.type).toBe('nfe.prepare_documents');
  });

  it('acknowledges a message about an NF-e that no longer exists', async () => {
    const { handler, storage } = build({ doc: null });
    await expect(
      handler.handle(message({ documentId: 'gone', tenantId: 't1' })),
    ).resolves.toBeUndefined();
    expect(storage.saveFile).not.toHaveBeenCalled();
  });

  it('stores nothing for an NF-e that is still queued', async () => {
    const { handler, storage } = build({
      doc: NfeDocument.create(documentParams()),
    });
    await handler.handle(message({ documentId: 'd1', tenantId: 't1' }));
    expect(storage.saveFile).not.toHaveBeenCalled();
  });

  it('refuses a message that names neither a document nor an inutilization', async () => {
    const { handler } = build();
    await expect(handler.handle(message({}))).rejects.toThrow('no document');
  });

  it('leaves an inutilization alone when it is not approved or already stored', async () => {
    const { handler, storage, inutilizations } = build();
    inutilizations.find.mockResolvedValueOnce({
      status: 'pending',
      procXml: null,
      xmlPath: null,
    });
    inutilizations.find.mockResolvedValueOnce({
      status: 'homologada',
      procXml: '<x/>',
      xmlPath: 'already/there.xml',
    });
    for (let i = 0; i < 2; i += 1)
      await handler.handle(message({ inutilizationId: 'i1' }));
    expect(storage.saveFile).not.toHaveBeenCalled();
    expect(inutilizations.markStored).not.toHaveBeenCalled();
  });
});
