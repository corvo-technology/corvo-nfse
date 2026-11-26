import { NfeXmlBuilder } from './builder/nfe-xml-builder';
import { NfeDocument } from './nfe-document';
import { contentFromDraft, draftFromDocument } from './nfe-draft-mapper';
import {
  draftFixture,
  inputFixture,
  issuerFixture,
} from '../testing/draft-fixture';

const roundTrip = (draft = draftFixture()) => {
  const doc = NfeDocument.create({
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    companyId: inputFixture().companyId,
    environment: 'test',
    idempotencyKey: 'k',
    requestHash: 'a'.repeat(64),
    ...contentFromDraft(draft),
  });
  return { doc, back: draftFromDocument(doc.toSnapshot(), issuerFixture()) };
};

describe('draft <-> document mapping', () => {
  it('reads back exactly the draft that was stored', () => {
    const draft = draftFixture();
    expect(roundTrip(draft).back).toEqual(draft);
  });

  it('keeps the rounding of a 4-place quantity times a 10-place price', () => {
    const draft = draftFixture({
      items: [
        {
          code: 'A',
          description: 'Item',
          ncm: '61091000',
          cfop: '5102',
          unit: 'UN',
          quantity: 3.3333,
          unitPrice: 1.2345678901,
          discount: 0.1,
        },
      ],
      payments: [{ tPag: '17', amount: 4.01 }],
    });
    const { back, doc } = roundTrip(draft);
    expect(back.items[0].amounts).toEqual(draft.items[0].amounts);
    expect(back.totals).toEqual(draft.totals);
    expect(doc.toSnapshot().items[0]).toMatchObject({
      quantity: '3.3333',
      unitPrice: '1.2345678901',
    });
  });

  it('builds byte-identical XML from the draft and from the stored document', () => {
    const draft = draftFixture();
    const { back } = roundTrip(draft);
    const build = (d: typeof draft) =>
      NfeXmlBuilder.for(d)
        .withNumber(1, 7)
        .withCnf('12345678')
        .withIssuedAt('2026-11-26T10:00:00-03:00')
        .build().xml;
    expect(build(back)).toBe(build(draft));
  });
});
