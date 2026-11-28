import { NfeDocument } from '../domain/nfe-document';
import { documentParams } from '../testing/document-fixture';
import { repeatRequest } from './nfe-repeat';

/** A document that went all the way: it has number, key and protocol, which a copy must not carry. */
function authorized(
  overrides: Partial<ReturnType<typeof documentParams>> = {},
  snapshot: object = {},
) {
  const doc = NfeDocument.create({
    ...documentParams(),
    additionalInfo: 'Pedido 10',
    externalId: 'ext-1',
    ...overrides,
  });
  return NfeDocument.reconstitute({
    ...doc.toSnapshot(),
    status: 'authorized',
    number: 7,
    series: 1,
    accessKey: 'K'.repeat(44),
    protocol: '123',
    ...snapshot,
  });
}

describe('repeatRequest (NF-e)', () => {
  it('keeps the parties, items, payments, natOp and additional information', () => {
    const doc = authorized();
    const body = repeatRequest(doc);
    expect(body).toMatchObject({
      companyId: doc.toSnapshot().companyId,
      natOp: 'Venda de mercadoria',
      additionalInfo: 'Pedido 10',
      recipient: { taxId: '12345678909', name: 'Cliente', indIeDest: 9 },
      items: [
        {
          code: 'SKU1',
          ncm: '12345678',
          cfop: '5102',
          quantity: 2,
          unitPrice: 10,
          tax: { csosn: '102' },
        },
      ],
      payments: [{ tPag: '17', amount: 20 }],
    });
  });

  it('never carries the number, key, protocol, date or external id', () => {
    const body = repeatRequest(authorized());
    expect(JSON.stringify(body)).not.toContain('K'.repeat(44));
    for (const field of [
      'accessKey',
      'protocol',
      'number',
      'series',
      'externalId',
      'issuedAt',
      'idempotencyKey',
      'finNfe',
    ])
      expect(body).not.toHaveProperty(field);
  });

  it('replaces the additional information when asked', () => {
    expect(repeatRequest(authorized(), 'Outro texto')).toMatchObject({
      additionalInfo: 'Outro texto',
    });
  });

  it('refuses a note that is not a normal sale (return, complement, adjustment)', () => {
    for (const finNfe of [2, 3, 4])
      expect(() => repeatRequest(authorized({ finNfe }))).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'NFE_REPEAT_NOT_NORMAL' }),
        }),
      );
  });
});

describe('repeatRequest (NFC-e)', () => {
  const consumer = (recipient: object | null) =>
    authorized({ recipient: recipient as never, indPres: 1 }, { model: 65 });

  it('copies the consumer and the sale, with no natOp', () => {
    const body = repeatRequest(
      consumer({
        taxId: '12345678909',
        name: 'Maria',
        indIeDest: 9,
        stateRegistration: null,
        email: 'm@x.com',
        address: null,
      }),
    );
    expect(body).toMatchObject({
      indPres: 1,
      recipient: { taxId: '12345678909', name: 'Maria', email: 'm@x.com' },
    });
    expect(body).not.toHaveProperty('natOp');
    expect(body).not.toHaveProperty('tpImp');
  });

  it('keeps an anonymous sale anonymous and copies the delivery address only when there is one', () => {
    expect(repeatRequest(consumer(null))).toMatchObject({ recipient: null });
    const withAddress = repeatRequest(
      consumer({
        taxId: '12345678909',
        name: '',
        indIeDest: 9,
        stateRegistration: null,
        email: null,
        address: {
          street: 'Rua B',
          number: '2',
          complement: null,
          district: 'Centro',
          zip: '01001000',
          cityCode: '3550308',
          city: 'São Paulo',
          state: 'SP',
        },
      }),
    ) as { recipient: { name?: string; address?: { street: string } } };
    expect(withAddress.recipient.address?.street).toBe('Rua B');
    expect(withAddress.recipient.name).toBeUndefined();
  });
});
