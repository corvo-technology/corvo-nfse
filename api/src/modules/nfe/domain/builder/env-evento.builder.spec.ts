import { XmllintSchemaValidator } from '@/infra/external/nfe/sefaz/schema-validator';
import { withStructuralSignature } from '@/infra/external/nfe/sefaz/xml-signer';
import {
  buildCancelEvent,
  buildCorrectionEvent,
  CORRECTION_USE_CONDITIONS,
  escapeXmlText,
} from './env-evento.builder';
import { buildInutilization } from './inut-nfe.builder';

const schema = new XmllintSchemaValidator();
const KEY = '35261112345678000195550010000000011234567810';
const base = {
  accessKey: KEY,
  cnpj: '12345678000195',
  cOrgao: '35',
  tpAmb: 2 as const,
  dhEvento: '2026-11-26T10:30:00-03:00',
};
const JUSTIFICATION = 'Cancelamento por erro na digitação do pedido';

describe('NF-e event builders against the XSD', () => {
  it('cancellation: Id, protocol and justification, and it passes envEvento', async () => {
    const built = buildCancelEvent({
      ...base,
      nSeq: 1,
      protocol: '135260000000001',
      justification: JUSTIFICATION,
    });
    expect(built.id).toBe(`ID110111${KEY}01`);
    expect(built.referenceTag).toBe('infEvento');
    expect(built.xml).toContain('<nProt>135260000000001</nProt>');
    const signed = withStructuralSignature(built.xml, built.referenceTag);
    expect(await schema.validate(signed, 'envEvento')).toEqual({ ok: true });
  });

  it('correction letter: fixed xCondUso, two-digit nSeqEvento in the Id, passes envCCe', async () => {
    const built = buildCorrectionEvent({
      ...base,
      nSeq: 3,
      correction: 'Corrigir o endereço de entrega informado na observação',
    });
    expect(built.id).toBe(`ID110110${KEY}03`);
    expect(built.xml).toContain(
      `<xCondUso>${CORRECTION_USE_CONDITIONS}</xCondUso>`,
    );
    const signed = withStructuralSignature(built.xml, built.referenceTag);
    expect(await schema.validate(signed, 'envCCe')).toEqual({ ok: true });
  });

  it('escapes the free text and still passes the XSD', async () => {
    const built = buildCancelEvent({
      ...base,
      nSeq: 1,
      protocol: '135260000000001',
      justification: 'Erro: pedido "A&B" <duplicado> de ontem',
    });
    expect(built.xml).toContain('&quot;A&amp;B&quot; &lt;duplicado&gt;');
    const signed = withStructuralSignature(built.xml, built.referenceTag);
    expect(await schema.validate(signed, 'envEvento')).toEqual({ ok: true });
    expect(escapeXmlText("a'b")).toBe('a&apos;b');
  });

  it('inutilization: Id with 41 characters after the prefix, passes inutNFe', async () => {
    const built = buildInutilization({
      cUF: '35',
      tpAmb: 2,
      ano: '26',
      cnpj: '12345678000195',
      model: 55,
      series: 1,
      start: 10,
      end: 12,
      justification: 'Numeração pulada por falha do sistema emissor',
    });
    expect(built.id).toBe('ID35261234567800019555001000000010000000012');
    expect(built.id.slice(2)).toHaveLength(41);
    expect(built.referenceTag).toBe('infInut');
    const signed = withStructuralSignature(built.xml, built.referenceTag);
    expect(await schema.validate(signed, 'inutNFe')).toEqual({ ok: true });
  });
});
