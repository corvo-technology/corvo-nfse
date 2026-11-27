import { NfeDocument } from '../domain/nfe-document';
import { documentParams } from '../testing/document-fixture';
import { NfeDocumentMapper } from './nfe-document.mapper';

describe('NfeDocumentMapper (NFC-e supplement)', () => {
  const mapper = new NfeDocumentMapper();

  it('writes and reads qr_code and url_chave', () => {
    const doc = NfeDocument.create(documentParams({ model: 65 }));
    doc.startAttempt('12345678', 'K'.repeat(44), '<xml/>', new Date(), {
      qrCode: 'https://qr?p=abc|3|2',
      urlChave: 'https://consulta',
    });
    const row = mapper.toPersistence(doc);
    expect(row.qrCode).toBe('https://qr?p=abc|3|2');
    expect(row.urlChave).toBe('https://consulta');
    const back = mapper.toDomain(row, []).toSnapshot();
    expect(back.qrCode).toBe('https://qr?p=abc|3|2');
    expect(back.urlChave).toBe('https://consulta');
  });

  it('leaves both null on an NF-e', () => {
    const doc = NfeDocument.create(documentParams());
    doc.startAttempt('12345678', 'K'.repeat(44), '<xml/>', new Date());
    const s = doc.toSnapshot();
    expect(s.qrCode).toBeNull();
    expect(s.urlChave).toBeNull();
  });
});
