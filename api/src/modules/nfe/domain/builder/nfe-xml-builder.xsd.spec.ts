import { XMLParser } from 'fast-xml-parser';
import { runValidators } from '@/modules/fiscal-core/application/emission-pipeline';
import { XmllintSchemaValidator } from '@/infra/external/nfe/sefaz/schema-validator';
import { withStructuralSignature } from '@/infra/external/nfe/sefaz/xml-signer';
import { buildDraft } from '../nfe-draft';
import { NFE_PRE_SEND_VALIDATORS } from '../validators';
import { NfeXmlBuilder } from './nfe-xml-builder';
import { ALL_FIXTURES, TEXTO_ESPECIAL } from './__fixtures__/inputs';
import { SETTINGS, issuerFixture } from '../../testing/draft-fixture';

/** The "XSD in CI" of design spec 9.1.3: every fixture builds, signs structurally and passes the XSD. */
const schema = new XmllintSchemaValidator();
const draftOf = (input: Parameters<typeof buildDraft>[0]) =>
  buildDraft(input, issuerFixture(), SETTINGS, 'test');

const builderOf = (input: Parameters<typeof buildDraft>[0]) =>
  NfeXmlBuilder.for(draftOf(input))
    .withNumber(1, 10)
    .withCnf('12345678')
    .withIssuedAt('2026-11-26T10:00:00-03:00')
    .withVerProc('Corvo 0.0.1')
    .withRespTec({
      cnpj: '11222333000181',
      contact: 'Corvo Suporte',
      email: 'suporte@corvo.tech',
      phone: '1133334444',
    });

describe('NfeXmlBuilder against the NF-e 4.00 XSD', () => {
  it.each(Object.entries(ALL_FIXTURES))('%s passes the validators', async (_, input) => {
    expect(
      await runValidators(NFE_PRE_SEND_VALIDATORS, draftOf(input), {
        environment: 'test',
      }),
    ).toEqual([]);
  });

  it.each(Object.entries(ALL_FIXTURES))('%s passes the XSD', async (_, input) => {
    const built = builderOf(input).build();
    const result = await schema.validate(
      withStructuralSignature(built.xml, built.referenceTag),
      'nfe',
    );
    expect(result).toEqual({ ok: true });
  });

  it('escapes & < " and accents and still passes the XSD (Review Focus 3)', async () => {
    const built = builderOf(TEXTO_ESPECIAL).build();
    expect(built.xml).toContain('Venda &amp; revenda');
    expect(built.xml).toContain('&lt;especial&gt;');
    expect(built.xml).not.toContain('<especial>');
    // Parsed back, the text is exactly what the customer sent.
    const parsed = new XMLParser({ parseTagValue: false }).parse(built.xml) as {
      NFe: { infNFe: { infAdic: { infCpl: string }; det: { prod: { xProd: string } } } };
    };
    expect(parsed.NFe.infNFe.det.prod.xProd).toBe(
      'Café & chá <especial> "premium" ação nº 1',
    );
    expect(parsed.NFe.infNFe.infAdic.infCpl).toBe(
      'Obs: pedido #77 & "urgente" <ok> à vista',
    );
    expect(
      await schema.validate(
        withStructuralSignature(built.xml, built.referenceTag),
        'nfe',
      ),
    ).toEqual({ ok: true });
  });

  it('is refused by the XSD when the NCM is wrong, so the XSD is really being applied', async () => {
    const input = ALL_FIXTURES['simples-102'];
    const bad = { ...input, items: [{ ...input.items[0], ncm: '1' }] };
    const built = builderOf(bad).build();
    const result = await schema.validate(
      withStructuralSignature(built.xml, built.referenceTag),
      'nfe',
    );
    expect(result.ok).toBe(false);
  });
});
