import { computeTotals, itemAmounts, toCents, centsToString } from './totals';
import { applyTaxDefaults, deriveIdDest } from './tax-defaults';
import { NFE_PRE_SEND_VALIDATORS } from './validators';
import { runValidators } from '@/modules/fiscal-core/application/emission-pipeline';
import { draftFixture, inputFixture, SETTINGS } from '../testing/draft-fixture';

const AWKWARD = { quantity: 1.3333, unitPrice: 0.3333333333 };

describe('totals (Review Focus 4)', () => {
  it('rounds the item vProd half up to 2 places', () => {
    expect(itemAmounts(AWKWARD).vProd).toBe(44);
    expect(toCents(0.005)).toBe(1);
    expect(toCents('2.675')).toBe(268);
  });

  it('sums the already rounded items: 3 awkward items make 1.32', () => {
    const totals = computeTotals([AWKWARD, AWKWARD, AWKWARD]);
    expect(totals.vProd).toBe(132);
    expect(totals.vNF).toBe(132);
    expect(centsToString(totals.vNF)).toBe('1.32');
  });

  it('adds freight, insurance and other, and subtracts the discount', () => {
    const totals = computeTotals([
      {
        quantity: 2,
        unitPrice: 10,
        discount: 1,
        freight: 2.5,
        insurance: 0.5,
        other: 1,
      },
    ]);
    expect(totals).toMatchObject({
      vProd: 2000,
      vDesc: 100,
      vFrete: 250,
      vSeg: 50,
      vOutro: 100,
      vNF: 2300,
    });
  });

  it('accepts a payment of 1.32 and refuses 1.33 for the three awkward items', async () => {
    const items = [AWKWARD, AWKWARD, AWKWARD].map((x, i) => ({
      code: `S${i}`,
      description: 'Item',
      ncm: '61091000',
      cfop: '5102',
      unit: 'UN',
      ...x,
    }));
    const run = (amount: number) =>
      runValidators(
        NFE_PRE_SEND_VALIDATORS,
        draftFixture({ items, payments: [{ tPag: '17', amount }] }),
        { environment: 'test' },
      );
    expect(await run(1.32)).toEqual([]);
    expect((await run(1.33)).map((i) => i.code)).toEqual([
      'PAYMENTS_TOTAL_MISMATCH',
    ]);
  });

  it('subtracts the change from the payments', async () => {
    const issues = await runValidators(
      NFE_PRE_SEND_VALIDATORS,
      draftFixture({ payments: [{ tPag: '01', amount: 50 }], change: 30 }),
      { environment: 'test' },
    );
    expect(issues).toEqual([]);
  });
});

describe('tax defaults', () => {
  it('gives an item without tax the defaults of the company', () => {
    expect(applyTaxDefaults([{}], SETTINGS)).toEqual([
      { origin: 0, csosn: '102', pisCst: '49', cofinsCst: '49' },
    ]);
  });

  it('lets an item override one field and keeps the rest', () => {
    expect(
      applyTaxDefaults([{ tax: { csosn: '400', origin: 2 } }], SETTINGS),
    ).toEqual([{ origin: 2, csosn: '400', pisCst: '49', cofinsCst: '49' }]);
  });

  it('derives idDest from the UF of the recipient', () => {
    expect(deriveIdDest('SP', 'sp')).toBe(1);
    expect(deriveIdDest('SP', 'RJ')).toBe(2);
    expect(draftFixture().idDest).toBe(1);
    expect(
      draftFixture({
        recipient: {
          ...inputFixture().recipient,
          address: { ...inputFixture().recipient.address, state: 'RJ' },
        },
      }).idDest,
    ).toBe(2);
  });
});
