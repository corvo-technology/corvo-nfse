import { randomUUID } from 'node:crypto';
import type { CreateNfeDocumentParams } from '../domain/nfe-document';

export function documentParams(
  overrides: Partial<CreateNfeDocumentParams> = {},
): CreateNfeDocumentParams {
  return {
    tenantId: randomUUID(),
    companyId: randomUUID(),
    environment: 'test',
    natOp: 'Venda de mercadoria',
    idDest: 1,
    indFinal: 1,
    indPres: 1,
    finNfe: 1,
    tpImp: 1,
    recipient: {
      taxId: '12345678909',
      name: 'Cliente',
      indIeDest: 9,
      stateRegistration: null,
      email: null,
      address: {
        street: 'Rua A',
        number: '10',
        complement: null,
        district: 'Centro',
        zip: '01001000',
        cityCode: '3550308',
        city: 'São Paulo',
        state: 'SP',
      },
    },
    items: [
      {
        nItem: 1,
        code: 'SKU1',
        gtin: null,
        description: 'Produto',
        ncm: '12345678',
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
    idempotencyKey: randomUUID(),
    requestHash: 'a'.repeat(64),
    ...overrides,
  };
}
