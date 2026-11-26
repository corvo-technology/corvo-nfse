import { XMLParser } from 'fast-xml-parser';
import { XmllintSchemaValidator } from '@/infra/external/nfe/sefaz/schema-validator';
import { withStructuralSignature } from '@/infra/external/nfe/sefaz/xml-signer';
import { buildNfceDraft } from '@/modules/nfce/domain/nfce-draft';
import type { NfceInput } from '@/modules/nfce/domain/nfce-input';
import { SETTINGS, issuerFixture } from '../../testing/draft-fixture';
import { HOMOLOGATION_RECIPIENT_NAME } from './context';
import { NfeXmlBuilder } from './nfe-xml-builder';
import {
  ALL_NFCE_FIXTURES,
  NFCE_ANONIMA,
  NFCE_CARTAO,
  NFCE_COM_CPF,
} from './__fixtures__/inputs';

const schema = new XmllintSchemaValidator();
const FIXED_ITEM_TEXT =
  'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

const builderOf = (input: NfceInput, environment: 'test' | 'live' = 'test') =>
  NfeXmlBuilder.for(
    buildNfceDraft(input, issuerFixture(), SETTINGS, environment),
  )
    .withNumber(1, 10)
    .withCnf('12345678')
    .withIssuedAt('2026-11-26T10:00:00-03:00')
    .withVerProc('Corvo 0.0.1');

const parse = (xml: string) =>
  new XMLParser({ parseTagValue: false, isArray: (n) => n === 'det' }).parse(
    xml,
  ) as {
    NFe: {
      infNFe: {
        ide: Record<string, string>;
        dest?: Record<string, string>;
        det: Array<{ prod: { xProd: string } }>;
      };
    };
  };

describe('NfeXmlBuilder, model 65', () => {
  it('anonymous sale: no dest, mod 65, DANFCE, inside the UF, key with 65', () => {
    const built = builderOf(NFCE_ANONIMA).build();
    const { infNFe } = parse(built.xml).NFe;
    expect(infNFe.dest).toBeUndefined();
    expect(infNFe.ide.mod).toBe('65');
    expect(infNFe.ide.tpImp).toBe('4');
    expect(infNFe.ide.idDest).toBe('1');
    expect(infNFe.ide.indFinal).toBe('1');
    expect(infNFe.ide.indPres).toBe('1');
    expect(built.accessKey.slice(20, 22)).toBe('65');
  });

  it('homologation: only the first item gets the fixed text (Review Focus 1)', () => {
    const { det } = parse(builderOf(NFCE_COM_CPF).build().xml).NFe.infNFe;
    expect(det[0].prod.xProd).toBe(FIXED_ITEM_TEXT);
    expect(det[1].prod.xProd).toBe('Segundo produto');
  });

  it('production keeps the real description', () => {
    const { det } = parse(builderOf(NFCE_COM_CPF, 'live').build().xml).NFe
      .infNFe;
    expect(det[0].prod.xProd).toBe('Produto de teste');
  });

  it('a CPF consumer in homologation gets the fixed name, no address, indIEDest 9, no IE', () => {
    const { dest } = parse(builderOf(NFCE_COM_CPF).build().xml).NFe.infNFe;
    expect(dest).toEqual({
      CPF: '12345678909',
      xNome: HOMOLOGATION_RECIPIENT_NAME,
      indIEDest: '9',
    });
  });

  it('a CPF consumer in production keeps the name', () => {
    const { dest } = parse(builderOf(NFCE_COM_CPF, 'live').build().xml).NFe
      .infNFe;
    expect(dest?.xNome).toBe('Maria da Silva');
  });

  it('a CPF alone sends no xNome in production', () => {
    const { dest } = parse(
      builderOf(
        { ...NFCE_ANONIMA, recipient: { taxId: '12345678909' } },
        'live',
      ).build().xml,
    ).NFe.infNFe;
    expect(dest).toEqual({ CPF: '12345678909', indIEDest: '9' });
  });

  it('a name without a CPF leaves no dest (the layout needs an identification)', () => {
    const built = builderOf({
      ...NFCE_ANONIMA,
      recipient: { name: 'Maria' },
    }).build();
    expect(parse(built.xml).NFe.infNFe.dest).toBeUndefined();
  });

  it('card group follows the layout order', () => {
    expect(builderOf(NFCE_CARTAO).build().xml).toContain(
      '<card><tpIntegra>1</tpIntegra><CNPJ>11222333000181</CNPJ><tBand>01</tBand><cAut>A1B2C3</cAut></card>',
    );
    const bare = builderOf({
      ...NFCE_ANONIMA,
      payments: [{ tPag: '03', amount: 20, card: {} }],
    }).build().xml;
    expect(bare).toContain('<card><tpIntegra>2</tpIntegra></card>');
  });

  it.each(Object.entries(ALL_NFCE_FIXTURES))(
    '%s passes the XSD with a structural signature',
    async (_, input) => {
      const built = builderOf(input).build();
      expect(
        await schema.validate(
          withStructuralSignature(built.xml, built.referenceTag),
          'nfe',
        ),
      ).toEqual({ ok: true });
    },
  );
});
