import { runValidators } from '@/modules/fiscal-core/application/emission-pipeline';
import { SETTINGS, issuerFixture } from '@/modules/nfe/testing/draft-fixture';
import { buildNfceDraft } from '../nfce-draft';
import type { NfceInput } from '../nfce-input';
import { NFCE_PRE_SEND_VALIDATORS } from './index';

const base: NfceInput = {
  companyId: '00000000-0000-4000-8000-000000000001',
  items: [
    {
      code: 'SKU1',
      description: 'Produto de teste',
      ncm: '61091000',
      cfop: '5102',
      unit: 'UN',
      quantity: 1,
      unitPrice: 10,
    },
  ],
  payments: [{ tPag: '01', amount: 10 }],
};

const run = (overrides: Partial<NfceInput> = {}) =>
  runValidators(
    NFCE_PRE_SEND_VALIDATORS,
    buildNfceDraft(
      { ...base, ...overrides },
      issuerFixture(),
      SETTINGS,
      'test',
    ),
    { environment: 'test' },
  );

const sale = (total: number, extra: Partial<NfceInput> = {}) =>
  run({
    items: [{ ...base.items[0], unitPrice: total }],
    payments: [{ tPag: '01', amount: total }],
    ...extra,
  });

const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe('NFCE_PRE_SEND_VALIDATORS', () => {
  it('passes an anonymous sale', async () => {
    expect(await run()).toEqual([]);
  });

  it('passes a CPF-only consumer (no address, no name)', async () => {
    expect(await run({ recipient: { taxId: '123.456.789-09' } })).toEqual([]);
  });

  it('refuses an invalid CPF', async () => {
    expect(
      codes(await run({ recipient: { taxId: '123.456.789-00' } })),
    ).toEqual(['TAX_ID_INVALID']);
  });

  describe('consumer identification limit (Review Focus 5)', () => {
    it('R$ 9.999,99 passes without a CPF', async () => {
      expect(await sale(9999.99)).toEqual([]);
    });

    it('R$ 10.000,00 asks for the CPF', async () => {
      expect(await sale(10000)).toEqual([
        expect.objectContaining({
          field: 'recipient.taxId',
          code: 'NFCE_CONSUMER_ID_REQUIRED',
        }),
      ]);
    });

    it('R$ 10.000,00 with a CPF passes', async () => {
      expect(
        await sale(10000, { recipient: { taxId: '123.456.789-09' } }),
      ).toEqual([]);
    });
  });

  describe('indPres', () => {
    it('refuses a value outside 1, 4 and 5', async () => {
      expect(codes(await run({ indPres: 2 as unknown as 1 }))).toEqual([
        'NFCE_IND_PRES_INVALID',
      ]);
    });

    it('delivery without the address is refused before numbering', async () => {
      expect(
        await run({
          indPres: 4,
          recipient: { taxId: '123.456.789-09', name: 'Maria' },
        }),
      ).toEqual([
        expect.objectContaining({
          field: 'recipient',
          code: 'NFCE_DELIVERY_ADDRESS_REQUIRED',
        }),
      ]);
      expect(codes(await run({ indPres: 4 }))).toEqual([
        'NFCE_DELIVERY_ADDRESS_REQUIRED',
      ]);
    });

    it('delivery with the consumer complete passes', async () => {
      expect(
        await run({
          indPres: 4,
          recipient: {
            taxId: '123.456.789-09',
            name: 'Maria',
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
        }),
      ).toEqual([]);
    });
  });

  describe('card', () => {
    const card = (
      tPag: string,
      c: NonNullable<NfceInput['payments'][0]['card']>,
    ) => run({ payments: [{ tPag, amount: 10, card: c }] });

    it('integrated without authorization is refused', async () => {
      expect(
        await card('03', { tpIntegra: 1, cnpj: '11222333000181' }),
      ).toEqual([
        expect.objectContaining({
          field: 'payments[0].card',
          code: 'NFCE_CARD_DATA_REQUIRED',
        }),
      ]);
    });

    it('integrated and complete passes', async () => {
      expect(
        await card('03', {
          tpIntegra: 1,
          cnpj: '11222333000181',
          cAut: 'A1',
          tBand: '01',
        }),
      ).toEqual([]);
    });

    it('an unknown brand is refused', async () => {
      expect(codes(await card('04', { tBand: '77' }))).toEqual([
        'NFCE_CARD_BRAND_INVALID',
      ]);
    });

    it('an invalid acquirer CNPJ is refused', async () => {
      expect(codes(await card('03', { cnpj: '11222333000182' }))).toEqual([
        'TAX_ID_INVALID',
      ]);
    });

    it('card with cash is not allowed', async () => {
      expect(codes(await card('01', {}))).toEqual(['NFCE_CARD_NOT_ALLOWED']);
    });

    it('PIX (17) with no card group gets the minimal one', async () => {
      expect(await run({ payments: [{ tPag: '17', amount: 10 }] })).toEqual([]);
    });

    it('PIX (17) accepts the card group', async () => {
      expect(await card('17', {})).toEqual([]);
    });
  });

  it('tPag 90 with a value is refused', async () => {
    expect(
      codes(await run({ payments: [{ tPag: '90', amount: 1 }], change: 0 })),
    ).toContain('NFCE_NO_PAYMENT_AMOUNT');
  });

  it('payments below the total are refused (reuse of the NF-e rule)', async () => {
    expect(codes(await run({ payments: [{ tPag: '01', amount: 5 }] }))).toEqual(
      ['PAYMENTS_TOTAL_MISMATCH'],
    );
  });

  it('a consumer from another UF is out of scope', async () => {
    const issues = await run({
      recipient: {
        taxId: '123.456.789-09',
        address: {
          street: 'Rua X',
          number: '1',
          district: 'Centro',
          zip: '20040-901',
          cityCode: '3304557',
          city: 'Rio de Janeiro',
          state: 'RJ',
        },
      },
    });
    expect(issues).toEqual([
      expect.objectContaining({
        field: 'recipient.address.state',
        code: 'NFCE_SCOPE_NOT_SUPPORTED',
      }),
    ]);
  });

  it('returns every problem at once', async () => {
    const issues = await run({
      indPres: 4,
      payments: [{ tPag: '01', amount: 1, card: {} }],
    });
    expect(codes(issues).sort()).toEqual(
      [
        'NFCE_CARD_NOT_ALLOWED',
        'NFCE_DELIVERY_ADDRESS_REQUIRED',
        'PAYMENTS_TOTAL_MISMATCH',
      ].sort(),
    );
  });
});
