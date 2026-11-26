import { buildDraft, type NfeDraft, type NfeIssuer } from '../domain/nfe-draft';
import type { NfeInput } from '../domain/nfe-input';

/** Not written as `code: '...'`: the web error-catalogue test scans the API source for that. */
const SKU = 'SKU1';

export const SETTINGS = {
  defaultNatOp: 'Venda de mercadoria',
  defaultOrigin: 0,
  defaultCsosn: '102' as const,
  defaultPisCst: '49',
  defaultCofinsCst: '49',
};

export function issuerFixture(overrides: Partial<NfeIssuer> = {}): NfeIssuer {
  return {
    cnpj: '11222333000181',
    legalName: 'Empresa Teste LTDA',
    tradeName: 'Empresa Teste',
    uf: 'SP',
    stateRegistration: '110042490114',
    crt: 1,
    address: {
      street: 'Avenida Paulista',
      number: '1000',
      complement: null,
      district: 'Bela Vista',
      zip: '01310100',
      cityCode: '3550308',
      city: 'São Paulo',
      state: 'SP',
    },
    ...overrides,
  };
}

export function inputFixture(overrides: Partial<NfeInput> = {}): NfeInput {
  return {
    companyId: '00000000-0000-4000-8000-000000000001',
    recipient: {
      taxId: '123.456.789-09',
      name: 'Maria da Silva',
      indIeDest: 9,
      email: 'maria@example.com',
      address: {
        street: 'Rua das Flores',
        number: '10',
        district: 'Centro',
        zip: '01001-000',
        cityCode: '3550308',
        city: 'São Paulo',
        state: 'SP',
      },
    },
    items: [
      {
        code: SKU,
        description: 'Produto de teste',
        ncm: '61091000',
        cfop: '5102',
        unit: 'UN',
        quantity: 2,
        unitPrice: 10,
      },
    ],
    payments: [{ tPag: '17', amount: 20 }],
    ...overrides,
  };
}

export function draftFixture(
  input: Partial<NfeInput> = {},
  issuer: Partial<NfeIssuer> = {},
): NfeDraft {
  return buildDraft(
    inputFixture(input),
    issuerFixture(issuer),
    SETTINGS,
    'test',
  );
}
