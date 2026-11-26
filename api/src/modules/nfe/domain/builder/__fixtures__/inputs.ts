import type { NfceInput } from '@/modules/nfce/domain/nfce-input';
import type { NfeInput } from '../../nfe-input';
import { inputFixture } from '../../../testing/draft-fixture';

/** The five request shapes the XSD spec builds, signs structurally and validates. */
export const SIMPLES_102: NfeInput = inputFixture();

export const SIMPLES_400: NfeInput = inputFixture({
  items: [{ ...inputFixture().items[0], tax: { csosn: '400' } }],
});

export const INTERESTADUAL: NfeInput = inputFixture({
  recipient: {
    taxId: '11.222.333/0001-81',
    name: 'Comercial Carioca LTDA',
    indIeDest: 1,
    stateRegistration: '12.345.67-8',
    email: 'compras@example.com',
    address: {
      street: 'Avenida Rio Branco',
      number: '156',
      complement: 'Sala 1201',
      district: 'Centro',
      zip: '20040-901',
      cityCode: '3304557',
      city: 'Rio de Janeiro',
      state: 'RJ',
    },
  },
  items: [
    {
      code: 'CAM-01',
      gtin: '7891234567895',
      description: 'Camiseta algodão',
      ncm: '61091000',
      cest: '2806400',
      cfop: '6102',
      unit: 'UN',
      quantity: 3,
      unitPrice: 49.9,
      discount: 5,
      freight: 12.5,
      insurance: 1,
      other: 0.5,
    },
    {
      code: 'BON-02',
      description: 'Boné',
      ncm: '65050090',
      cfop: '6102',
      unit: 'UN',
      quantity: 1.5,
      unitPrice: 19.123456789,
      tax: { origin: 1, csosn: '400' },
    },
  ],
  payments: [
    { tPag: '01', amount: 100 },
    { tPag: '17', amount: 100 },
  ],
  change: 12.61,
});

export const CPF_CONSUMIDOR_FINAL: NfeInput = inputFixture({
  recipient: {
    ...inputFixture().recipient,
    email: null,
  },
  additionalInfo: 'Entrega no período da tarde',
});

export const TEXTO_ESPECIAL: NfeInput = inputFixture({
  natOp: 'Venda & revenda',
  recipient: {
    ...inputFixture().recipient,
    name: 'José "Zé" D\'Ávila & Filhos <ME>',
  },
  items: [
    {
      ...inputFixture().items[0],
      description: 'Café & chá <especial> "premium" ação nº 1',
    },
  ],
  additionalInfo: 'Obs: pedido #77 & "urgente" <ok> à vista',
});

export const ALL_FIXTURES: Record<string, NfeInput> = {
  'simples-102': SIMPLES_102,
  'simples-400': SIMPLES_400,
  interestadual: INTERESTADUAL,
  'cpf-consumidor-final': CPF_CONSUMIDOR_FINAL,
  'texto-especial': TEXTO_ESPECIAL,
};

const NFCE_BASE: NfceInput = {
  companyId: '00000000-0000-4000-8000-000000000001',
  items: [{ ...inputFixture().items[0], code: 'SKU1' }],
  payments: [{ tPag: '17', amount: 20 }],
};

/** The NFC-e request shapes: anonymous, with a CPF, paid by card and for delivery. */
export const NFCE_ANONIMA: NfceInput = NFCE_BASE;

export const NFCE_COM_CPF: NfceInput = {
  ...NFCE_BASE,
  recipient: { taxId: '123.456.789-09', name: 'Maria da Silva' },
  items: [
    NFCE_BASE.items[0],
    { ...NFCE_BASE.items[0], code: 'SKU2', description: 'Segundo produto' },
  ],
  payments: [{ tPag: '01', amount: 50 }],
  change: 10,
};

export const NFCE_CARTAO: NfceInput = {
  ...NFCE_BASE,
  payments: [
    {
      tPag: '03',
      amount: 20,
      card: {
        tpIntegra: 1,
        cnpj: '11222333000181',
        tBand: '01',
        cAut: 'A1B2C3',
      },
    },
  ],
};

export const NFCE_ENTREGA: NfceInput = {
  ...NFCE_BASE,
  indPres: 4,
  recipient: {
    taxId: '123.456.789-09',
    name: 'Maria da Silva',
    address: inputFixture().recipient.address,
  },
};

export const ALL_NFCE_FIXTURES: Record<string, NfceInput> = {
  'nfce-anonima': NFCE_ANONIMA,
  'nfce-com-cpf': NFCE_COM_CPF,
  'nfce-cartao': NFCE_CARTAO,
  'nfce-entrega': NFCE_ENTREGA,
};
