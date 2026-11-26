import {
  InvalidNfeTransitionError,
  NfeNumberAlreadyAssignedError,
} from './errors';
import { NfeDocument } from './nfe-document';
import { documentParams } from '../testing/document-fixture';

const KEY_1 = '3'.repeat(44);
const KEY_2 = '4'.repeat(44);
const XML = '<NFe/>';
const AT = new Date('2026-11-26T12:00:00Z');

describe('NfeDocument', () => {
  it('is created queued, unnumbered and without a key', () => {
    const doc = NfeDocument.create(documentParams());
    expect(doc.status).toBe('queued');
    expect(doc.number).toBeNull();
    expect(doc.accessKey).toBeNull();
    expect(doc.attempt).toBe(0);
    expect(doc.toSnapshot().transport).toEqual({ modFrete: 9 });
  });

  it('walks the happy path and returns a history row per transition', () => {
    const doc = NfeDocument.create(documentParams());
    const processing = doc.transitionTo('processing');
    expect(processing).toMatchObject({
      fromStatus: 'queued',
      toStatus: 'processing',
      documentId: doc.id,
      tenantId: doc.tenantId,
    });
    const authorized = doc.markAuthorized({
      accessKey: KEY_1,
      protocol: '135260000000001',
      authorizedAt: AT,
      cStat: '100',
      xMotivo: 'Autorizado o uso da NF-e',
      protNFeXml: '<protNFe/>',
    });
    expect(authorized).toMatchObject({
      fromStatus: 'processing',
      toStatus: 'authorized',
      cStat: '100',
    });
    expect(doc.toSnapshot()).toMatchObject({
      status: 'authorized',
      protocol: '135260000000001',
      authorizedAt: AT,
      protNfeXml: '<protNFe/>',
    });
  });

  it.each([
    ['denied', 'queued'],
    ['cancelled', 'authorized'],
    ['authorized', 'rejected'],
  ] as const)('refuses %s -> %s', (from, to) => {
    const doc = NfeDocument.reconstitute({
      ...NfeDocument.create(documentParams()).toSnapshot(),
      status: from,
    });
    expect(() => doc.transitionTo(to)).toThrow(InvalidNfeTransitionError);
    expect(doc.status).toBe(from);
  });

  it('assigns the number only once', () => {
    const doc = NfeDocument.create(documentParams());
    doc.assignNumber(1, 7);
    expect(doc.toSnapshot()).toMatchObject({ series: 1, number: 7 });
    expect(() => doc.assignNumber(1, 8)).toThrow(NfeNumberAlreadyAssignedError);
    expect(doc.number).toBe(7);
  });

  it('startAttempt twice gives two history rows with different keys and attempts 1 and 2', () => {
    const doc = NfeDocument.create(documentParams());
    doc.transitionTo('processing');
    const first = doc.startAttempt('11111111', KEY_1, XML, AT);
    doc.transitionTo('rejected', { cStat: '225', xMotivo: 'Falha no Schema' });
    doc.transitionTo('queued');
    doc.transitionTo('processing');
    const second = doc.startAttempt('22222222', KEY_2, XML, AT);

    expect([first.attempt, second.attempt]).toEqual([1, 2]);
    expect([first.accessKey, second.accessKey]).toEqual([KEY_1, KEY_2]);
    expect(doc.accessKey).toBe(KEY_2);
    expect(doc.toSnapshot().cNf).toBe('22222222');
  });

  it('keeps the key of the rejected attempt in the history of its rejection', () => {
    const doc = NfeDocument.create(documentParams());
    doc.transitionTo('processing');
    doc.startAttempt('11111111', KEY_1, XML, AT);
    const rejected = doc.transitionTo('rejected', { cStat: '225' });
    expect(rejected).toMatchObject({
      accessKey: KEY_1,
      attempt: 1,
      cStat: '225',
    });
  });
});
