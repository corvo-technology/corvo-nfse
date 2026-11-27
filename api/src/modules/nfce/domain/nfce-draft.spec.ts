import {
  SETTINGS,
  inputFixture,
  issuerFixture,
} from '@/modules/nfe/testing/draft-fixture';
import { buildDraft } from '@/modules/nfe/domain/nfe-draft';
import { buildNfceDraft } from './nfce-draft';
import type { NfceInput } from './nfce-input';

const nfce = (overrides: Partial<NfceInput> = {}): NfceInput => ({
  companyId: '00000000-0000-4000-8000-000000000001',
  items: [
    {
      code: 'SKU1',
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
});
const draftOf = (input: NfceInput) =>
  buildNfceDraft(input, issuerFixture(), SETTINGS, 'test');

describe('buildNfceDraft', () => {
  it('without a consumer: no recipient, in person, DANFCE, inside the UF', () => {
    const draft = draftOf(nfce());
    expect(draft.model).toBe(65);
    expect(draft.recipient).toBeNull();
    expect(draft.indPres).toBe(1);
    expect(draft.tpImp).toBe(4);
    expect(draft.idDest).toBe(1);
    expect(draft.indFinal).toBe(1);
    expect(draft.finNfe).toBe(1);
    expect(draft.natOp).toBe('Venda de mercadoria');
    expect(draft.totals.vNF).toBe(2000);
  });

  it('a CPF alone is a non-contributor consumer without an address', () => {
    const draft = draftOf(nfce({ recipient: { taxId: '123.456.789-09' } }));
    expect(draft.recipient).toEqual({
      taxId: '12345678909',
      name: '',
      indIeDest: 9,
      stateRegistration: null,
      email: null,
      address: null,
    });
  });

  it('keeps the indPres the customer chose', () => {
    expect(draftOf(nfce({ indPres: 4 })).indPres).toBe(4);
  });

  it('a card with no data is a non-integrated payment', () => {
    const draft = draftOf(
      nfce({ payments: [{ tPag: '03', amount: 20, card: {} }] }),
    );
    expect(draft.payments[0].card).toEqual({
      tpIntegra: 2,
      cnpj: null,
      tBand: null,
      cAut: null,
    });
  });

  it('PIX without card gets the minimal one (rejection 391)', () => {
    expect(draftOf(nfce()).payments[0]).toEqual({
      tPag: '17',
      cents: 2000,
      card: { tpIntegra: 2, cnpj: null, tBand: null, cAut: null },
    });
  });
});

describe('buildDraft (NF-e)', () => {
  it('is still model 55', () => {
    expect(
      buildDraft(inputFixture(), issuerFixture(), SETTINGS, 'test').model,
    ).toBe(55);
  });
});
