import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  redactSchemaMessage,
  XmllintSchemaValidator,
} from './schema-validator';

const FIXTURES = join(__dirname, '../../../../../test/fixtures/nfe/xml');
const fixture = (name: string) =>
  readFileSync(join(FIXTURES, `${name}.xml`), 'utf8');

describe('XmllintSchemaValidator', () => {
  const validator = new XmllintSchemaValidator();

  it('accepts the minimal NF-e fixture (Simples, CSOSN 102, PIS/COFINS CST 49)', async () => {
    expect(
      await validator.validate(fixture('nfe-minimal-signed'), 'nfe'),
    ).toEqual({ ok: true });
  });

  it('accepts consStatServ and consSitNFe', async () => {
    expect(
      await validator.validate(fixture('consStatServ'), 'consStatServ'),
    ).toEqual({ ok: true });
    expect(
      await validator.validate(fixture('consSitNFe'), 'consSitNFe'),
    ).toEqual({
      ok: true,
    });
  });

  it('accepts the NF-e wrapped in enviNFe', async () => {
    const nfe = fixture('nfe-minimal-signed').trim();
    const envi = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc>${nfe}</enviNFe>`;
    expect(await validator.validate(envi, 'enviNFe')).toEqual({ ok: true });
  });

  it('rejects a NF-e without NCM and names it', async () => {
    const broken = fixture('nfe-minimal-signed').replace(
      /<NCM>[^<]*<\/NCM>/,
      '',
    );
    const result = await validator.validate(broken, 'nfe');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.map((e) => e.message).join('\n')).toContain('NCM');
      expect(typeof result.errors[0].line).toBe('number');
    }
  });

  it('does not echo the offending value (it may be a CPF or a name)', async () => {
    const broken = fixture('nfe-minimal-signed').replace(
      '<CNPJ>99999999000191</CNPJ>',
      '<CPF>529.982.247-25</CPF>',
    );
    const result = await validator.validate(broken, 'nfe');
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(JSON.stringify(result.errors)).not.toContain('529.982.247-25');
  });
});

describe('redactSchemaMessage', () => {
  it('drops quoted values but keeps the element and the rule', () => {
    const out = redactSchemaMessage(
      "Element '{http://www.portalfiscal.inf.br/nfe}CPF': [facet 'pattern'] The value '529.982.247-25' is not accepted by the pattern '[0-9]{11}'.",
    );
    expect(out).toContain('CPF');
    expect(out).toContain("pattern '[0-9]{11}'");
    expect(out).not.toContain('529.982.247-25');
  });

  it('drops the value of "is not a valid value"', () => {
    const out = redactSchemaMessage(
      "Element '{x}xNome': 'Maria da Silva' is not a valid value of the atomic type 'T'.",
    );
    expect(out).not.toContain('Maria');
  });
});
