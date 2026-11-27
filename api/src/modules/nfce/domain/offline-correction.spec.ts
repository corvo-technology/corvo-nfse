import type { NfeContent } from '@/modules/nfe/domain/nfe-document';
import { lockedFieldsChanged } from './offline-correction';

const content = (): NfeContent => ({
  natOp: 'Venda de mercadoria',
  idDest: 1,
  indFinal: 1,
  indPres: 1,
  finNfe: 1,
  tpImp: 4,
  recipient: null,
  items: [
    {
      nItem: 1,
      code: 'SKU1',
      gtin: null,
      description: 'Produto de teste',
      ncm: '61091000',
      cest: null,
      cfop: '5102',
      unit: 'UN',
      quantity: '2.0000',
      unitPrice: '10.0000000000',
      total: '20.00',
      discount: '0.00',
      freight: '0.00',
      insurance: '0.00',
      other: '0.00',
      tax: { origin: 0, csosn: '102', pisCst: '49', cofinsCst: '49' },
      ibsCbs: null,
    },
  ],
  totals: {
    vProd: '20.00',
    vDesc: '0.00',
    vFrete: '0.00',
    vSeg: '0.00',
    vOutro: '0.00',
    vNF: '20.00',
  },
  payment: { payments: [{ tPag: '17', amount: '20.00' }], change: '0.00' },
  additionalInfo: null,
  externalId: null,
  sendEmail: true,
});

describe('lockedFieldsChanged', () => {
  it('the same body changes nothing, even with the database padding of the decimals', () => {
    const after = content();
    after.items[0].quantity = '2';
    after.items[0].unitPrice = '10.00';
    expect(lockedFieldsChanged(content(), after)).toEqual([]);
  });

  it('description, gtin, ncm, cest, unit and additionalInfo are free', () => {
    const after = content();
    Object.assign(after.items[0], {
      description: 'Camiseta',
      gtin: '7891234567895',
      ncm: '61099000',
      cest: '2806400',
      unit: 'PC',
    });
    after.additionalInfo = 'Obrigado';
    expect(lockedFieldsChanged(content(), after)).toEqual([]);
  });

  it('the unit price is locked and the paths say where', () => {
    const after = content();
    after.items[0].unitPrice = '11.0000000000';
    after.items[0].total = '22.00';
    after.totals.vProd = '22.00';
    after.totals.vNF = '22.00';
    expect(lockedFieldsChanged(content(), after)).toEqual([
      'totals',
      'items[0].unitPrice',
      'items[0].total',
    ]);
  });

  it.each([
    ['payment', (c: NfeContent) => (c.payment.payments[0].tPag = '01')],
    [
      'recipient',
      (c: NfeContent) =>
        (c.recipient = {
          taxId: '12345678909',
          name: 'Ana',
          indIeDest: 9,
          stateRegistration: null,
          email: null,
          address: null,
        }),
    ],
    ['indPres', (c: NfeContent) => (c.indPres = 5)],
    ['externalId', (c: NfeContent) => (c.externalId = 'novo')],
    ['items[0].cfop', (c: NfeContent) => (c.items[0].cfop = '5101')],
    ['items[0].code', (c: NfeContent) => (c.items[0].code = 'SKU2')],
  ])('%s is locked', (path, change) => {
    const after = content();
    change(after);
    expect(lockedFieldsChanged(content(), after)).toContain(path);
  });

  it('adding or removing an item is locked', () => {
    const after = content();
    after.items.push({ ...after.items[0], nItem: 2 });
    expect(lockedFieldsChanged(content(), after)).toContain('items');
  });
});
