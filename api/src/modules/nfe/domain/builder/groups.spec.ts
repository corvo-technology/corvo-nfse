import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDraft } from '../nfe-draft';
import { NfeXmlBuilder } from './nfe-xml-builder';
import {
  HOMOLOGATION_RECIPIENT_NAME,
  type BuildContext,
  type NfeRespTec,
} from './context';
import { destGroup } from './dest.group';
import { detGroup, unitPriceText } from './det.group';
import { emitGroup } from './emit.group';
import {
  ibsCbsGroup,
  ibsCbsRequired,
  NfeIbsCbsNotSupportedError,
} from './ibs-cbs.group';
import { ideGroup } from './ide.group';
import { infAdicGroup } from './inf-adic.group';
import { infRespTecGroup } from './inf-resp-tec.group';
import { pagGroup } from './pag.group';
import { totalGroup } from './total.group';
import { transpGroup } from './transp.group';
import { INTERESTADUAL, SIMPLES_102 } from './__fixtures__/inputs';
import { SETTINGS, issuerFixture } from '../../testing/draft-fixture';

const RESP_TEC: NfeRespTec = {
  cnpj: '11222333000181',
  contact: 'Corvo Suporte',
  email: 'suporte@corvo.tech',
  phone: '1133334444',
};
const KEY = '3526111122233300018155001000000010112345678';

function context(
  input = SIMPLES_102,
  overrides: Partial<BuildContext> = {},
): BuildContext {
  return {
    draft: buildDraft(input, issuerFixture(), SETTINGS, 'test'),
    cUF: '35',
    series: 1,
    number: 10,
    cNF: '12345678',
    dhEmi: '2026-11-26T10:00:00-03:00',
    tpAmb: 2,
    accessKey: `${KEY}0`,
    verProc: 'Corvo 0.0.1',
    respTec: RESP_TEC,
    tpEmis: 1,
    contingency: null,
    ...overrides,
  };
}

describe('NF-e groups', () => {
  it('ide', () => {
    expect(ideGroup(context())).toEqual({
      cUF: '35',
      cNF: '12345678',
      natOp: 'Venda de mercadoria',
      mod: 55,
      serie: 1,
      nNF: 10,
      dhEmi: '2026-11-26T10:00:00-03:00',
      tpNF: 1,
      idDest: 1,
      cMunFG: '3550308',
      tpImp: 1,
      tpEmis: 1,
      cDV: '0',
      tpAmb: 2,
      finNFe: 1,
      indFinal: 1,
      indPres: 1,
      procEmi: 0,
      verProc: 'Corvo 0.0.1',
    });
  });

  it('emit', () => {
    expect(emitGroup(context())).toEqual({
      CNPJ: '11222333000181',
      xNome: 'Empresa Teste LTDA',
      xFant: 'Empresa Teste',
      enderEmit: {
        xLgr: 'Avenida Paulista',
        nro: '1000',
        xCpl: undefined,
        xBairro: 'Bela Vista',
        cMun: '3550308',
        xMun: 'São Paulo',
        UF: 'SP',
        CEP: '01310100',
        cPais: '1058',
        xPais: 'Brasil',
      },
      IE: '110042490114',
      CRT: 1,
    });
  });

  describe('dest', () => {
    it('uses CPF and the fixed name in homologation', () => {
      expect(destGroup(context())).toMatchObject({
        CPF: '12345678909',
        xNome: HOMOLOGATION_RECIPIENT_NAME,
        indIEDest: 9,
        IE: undefined,
        email: 'maria@example.com',
      });
    });

    it('uses CNPJ, the real name in production and the IE of a contributor', () => {
      expect(destGroup(context(INTERESTADUAL, { tpAmb: 1 }))).toMatchObject({
        CNPJ: '11222333000181',
        xNome: 'Comercial Carioca LTDA',
        indIEDest: 1,
        IE: '12345678',
        enderDest: expect.objectContaining({ UF: 'RJ', cMun: '3304557' }),
      });
    });
  });

  describe('det', () => {
    it('numbers the items and fills the zeroed Simples taxes', () => {
      const [det] = detGroup(context());
      expect(det).toEqual({
        '@_nItem': '1',
        prod: expect.objectContaining({
          cProd: 'SKU1',
          cEAN: 'SEM GTIN',
          NCM: '61091000',
          CFOP: '5102',
          qCom: '2.0000',
          vUnCom: '10.00',
          vProd: '20.00',
          indTot: 1,
          vFrete: undefined,
        }),
        imposto: {
          ICMS: { ICMSSN102: { orig: 0, CSOSN: '102' } },
          PIS: {
            PISOutr: { CST: '49', vBC: '0.00', pPIS: '0.0000', vPIS: '0.00' },
          },
          COFINS: {
            COFINSOutr: {
              CST: '49',
              vBC: '0.00',
              pCOFINS: '0.0000',
              vCOFINS: '0.00',
            },
          },
        },
      });
    });

    it('carries freight, insurance, discount, other, GTIN and CEST', () => {
      const [first, second] = detGroup(context(INTERESTADUAL));
      expect(first.prod).toMatchObject({
        cEAN: '7891234567895',
        CEST: '2806400',
        indEscala: 'S',
        vProd: '149.70',
        vFrete: '12.50',
        vSeg: '1.00',
        vDesc: '5.00',
        vOutro: '0.50',
      });
      expect(second.imposto).toMatchObject({
        ICMS: { ICMSSN102: { orig: 1, CSOSN: '400' } },
      });
      expect(second.prod).toMatchObject({
        qCom: '1.5000',
        vUnCom: '19.123456789',
        vProd: '28.69',
      });
    });

    it('prints the unit price with 2 to 10 decimals', () => {
      expect(unitPriceText('10.0000000000')).toBe('10.00');
      expect(unitPriceText('0.3333333333')).toBe('0.3333333333');
      expect(unitPriceText('1.5000000000')).toBe('1.50');
    });
  });

  it('total zeroes every tax total and sums the goods', () => {
    expect(totalGroup(context(INTERESTADUAL))).toEqual({
      ICMSTot: expect.objectContaining({
        vBC: '0.00',
        vICMS: '0.00',
        vPIS: '0.00',
        vCOFINS: '0.00',
        vProd: '178.39',
        vFrete: '12.50',
        vSeg: '1.00',
        vDesc: '5.00',
        vOutro: '0.50',
        vNF: '187.39',
      }),
    });
  });

  it('transp is modFrete 9', () => {
    expect(transpGroup(context())).toEqual({ modFrete: 9 });
  });

  it('pag lists the payments and the change only when there is one', () => {
    expect(pagGroup(context())).toEqual({
      detPag: [{ tPag: '17', vPag: '20.00' }],
      vTroco: undefined,
    });
    expect(pagGroup(context(INTERESTADUAL))).toEqual({
      detPag: [
        { tPag: '01', vPag: '100.00' },
        { tPag: '17', vPag: '100.00' },
      ],
      vTroco: '12.61',
    });
  });

  it('infAdic only when there is text', () => {
    expect(infAdicGroup(context())).toBeUndefined();
    expect(
      infAdicGroup(context({ ...SIMPLES_102, additionalInfo: 'Obs' })),
    ).toEqual({ infCpl: 'Obs' });
  });

  it('infRespTec comes from the settings, without idCSRT', () => {
    expect(infRespTecGroup(context())).toEqual({
      CNPJ: '11222333000181',
      xContato: 'Corvo Suporte',
      email: 'suporte@corvo.tech',
      fone: '1133334444',
    });
    expect(
      infRespTecGroup(context(SIMPLES_102, { respTec: null })),
    ).toBeUndefined();
  });

  describe('IBS/CBS', () => {
    it('is not required without a date', () => {
      expect(ibsCbsRequired('2030-01-01T00:00:00-03:00', null)).toBe(false);
      expect(ibsCbsGroup(context(), null)).toBeUndefined();
    });

    it('is required from the date, by the issuer-local day', () => {
      expect(ibsCbsRequired('2027-01-01T00:00:00-03:00', '2027-01-01')).toBe(
        true,
      );
      expect(ibsCbsRequired('2026-12-31T23:59:59-03:00', '2027-01-01')).toBe(
        false,
      );
    });

    it('refuses to build while required but not implemented', () => {
      expect(() =>
        ibsCbsGroup(
          context(SIMPLES_102, { dhEmi: '2027-02-01T10:00:00-03:00' }),
          '2027-01-01',
        ),
      ).toThrow(NfeIbsCbsNotSupportedError);
    });
  });
});

describe('NfeXmlBuilder', () => {
  const builder = () =>
    NfeXmlBuilder.for(
      buildDraft(SIMPLES_102, issuerFixture(), SETTINGS, 'test'),
    )
      .withNumber(1, 10)
      .withCnf('12345678')
      .withIssuedAt('2026-11-26T10:00:00-03:00')
      .withVerProc('Corvo 0.0.1')
      .withRespTec(RESP_TEC);

  it('produces the XML of the fixture, byte for byte', () => {
    const expected = readFileSync(
      join(__dirname, '__fixtures__', 'simples-102.xml'),
      'utf8',
    ).trim();
    expect(builder().build().xml).toBe(expected);
  });

  it('is immutable: a with* call does not change the builder it came from', () => {
    const base = builder();
    const other = base.withNumber(1, 11);
    expect(base.build().accessKey).not.toBe(other.build().accessKey);
    expect(base.build().xml).toContain('<nNF>10</nNF>');
  });

  it('puts the key, built from the dhEmi of the issuer UF, in the Id', () => {
    const built = builder().build();
    expect(built.accessKey).toMatch(/^35261\d{39}$/);
    expect(built.accessKey.slice(2, 6)).toBe('2611');
    expect(built.xml).toContain(`Id="NFe${built.accessKey}"`);
    expect(built.referenceTag).toBe('infNFe');
  });

  it('takes AAMM from the local dhEmi, not from UTC (Review Focus 5)', () => {
    const late = builder().withIssuedAt('2026-11-30T23:30:00-03:00').build();
    expect(late.accessKey.slice(2, 6)).toBe('2611');
  });

  it('asks for the number, the cNF and the date', () => {
    const draft = buildDraft(SIMPLES_102, issuerFixture(), SETTINGS, 'test');
    expect(() => NfeXmlBuilder.for(draft).build()).toThrow(/withNumber/);
    expect(() => NfeXmlBuilder.for(draft).withNumber(1, 1).build()).toThrow(
      /withCnf/,
    );
    expect(() =>
      NfeXmlBuilder.for(draft).withNumber(1, 1).withCnf('12345678').build(),
    ).toThrow(/withIssuedAt/);
  });

  it('uses tpAmb 2 for a test company and 1 for a live one, unless told', () => {
    const live = NfeXmlBuilder.for(
      buildDraft(SIMPLES_102, issuerFixture(), SETTINGS, 'live'),
    )
      .withNumber(1, 10)
      .withCnf('12345678')
      .withIssuedAt('2026-11-26T10:00:00-03:00');
    expect(live.build().xml).toContain('<tpAmb>1</tpAmb>');
    expect(live.withTpAmb(2).build().xml).toContain('<tpAmb>2</tpAmb>');
    expect(builder().build().xml).toContain('<tpAmb>2</tpAmb>');
  });
});
