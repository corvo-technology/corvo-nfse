import { parseNfseXml } from 'open-nfse';
import {
  checkPortalNfse,
  dpsUsedByOtherNfseMessage,
  type PortalNfseExpectation,
} from './portal-nfse-match';
import { portalNfseXml, REAL_NFSE_XML } from './__fixtures__/portal-nfse-xml';

/** The invoice from production: same CNPJ, customer and DPS as the real note, other sale. */
const ours: PortalNfseExpectation = {
  providerTaxId: '61469487000140',
  customerTaxId: '111.444.777-35',
  amount: 9.9,
  competenceDate: '2026-11-22',
  series: '1',
  number: 2,
};

describe('checkPortalNfse', () => {
  it('accepts the note when it says what the invoice says', () => {
    expect(
      checkPortalNfse(REAL_NFSE_XML, {
        ...ours,
        amount: 49.9,
        competenceDate: '2026-10-16',
      }),
    ).toEqual({ matches: true });
  });

  it('refuses another note with the same DPS (other value and competence) and says which one it is', () => {
    expect(checkPortalNfse(REAL_NFSE_XML, ours)).toEqual({
      matches: false,
      differences: ['amount', 'competenceDate'],
      found: { nfseNumber: '1', issuedOn: '2026-10-16', amount: 4990 },
    });
  });

  it.each([
    ['provider', { providerTaxId: '11222333000181' }],
    ['customer', { customerTaxId: '05352745139' }],
    ['customer', { customerTaxId: null }],
    ['dps', { number: 3 }],
    ['dps', { series: '2' }],
  ] as const)('flags a different %s', (field, change) => {
    const result = checkPortalNfse(REAL_NFSE_XML, {
      ...ours,
      amount: 49.9,
      competenceDate: '2026-10-16',
      ...change,
    });
    expect(result).toMatchObject({ matches: false, differences: [field] });
  });

  it('matches a consumer without document and a business customer', () => {
    const base = {
      providerCnpj: '11222333000181',
      amount: '1000.00',
      competenceDate: '2026-10-13',
      series: '1',
      number: 7,
    };
    const expected = {
      providerTaxId: '11222333000181',
      amount: 1000,
      competenceDate: '2026-10-13',
      series: '1',
      number: 7,
    };
    expect(
      checkPortalNfse(portalNfseXml(base), {
        ...expected,
        customerTaxId: null,
      }),
    ).toEqual({ matches: true });
    expect(
      checkPortalNfse(
        portalNfseXml({ ...base, customerCnpj: '12345678000195' }),
        {
          ...expected,
          customerTaxId: '12.345.678/0001-95',
        },
      ),
    ).toEqual({ matches: true });
  });

  it('keeps the competence day (no shift to the previous day in São Paulo)', () => {
    const dCompet = parseNfseXml(REAL_NFSE_XML).infNFSe.DPS.infDPS.dCompet;
    expect(new Date(dCompet).toISOString()).toBe('2026-10-16T03:00:00.000Z');
    expect(
      checkPortalNfse(REAL_NFSE_XML, {
        ...ours,
        amount: 49.9,
        competenceDate: '2026-10-15',
      }),
    ).toMatchObject({ differences: ['competenceDate'] });
  });

  it('never accepts a note it cannot read', () => {
    expect(checkPortalNfse('<NFSe/>', ours)).toEqual({
      matches: false,
      differences: ['unreadable'],
      found: null,
    });
  });
});

describe('dpsUsedByOtherNfseMessage', () => {
  it('names the DPS and the other note in plain Portuguese', () => {
    const message = dpsUsedByOtherNfseMessage(
      { series: '1', number: 2 },
      { nfseNumber: '1', issuedOn: '2026-10-16', amount: 4990 },
    );
    expect(message).toContain(
      'O número de DPS 2 (série 1) já foi usado por outra nota (nº 1, de 16/10/2026, R$ 49,90). Esta nota não foi emitida.',
    );
    expect(message).toContain('Duplicar');
    expect(message).toContain('outro número');
  });

  it('after a discard says the credit came back', () => {
    expect(
      dpsUsedByOtherNfseMessage({ series: '1', number: 2 }, null, true),
    ).toContain(
      'já foi usado por outra nota. Esta nota foi descartada sem ser emitida e o crédito voltou.',
    );
  });
});
