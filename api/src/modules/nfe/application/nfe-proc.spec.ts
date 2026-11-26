import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignedXml } from 'xml-crypto';
import { makeTestA1 } from '../../../../test/fixtures/nfe/test-a1';
import { loadCertificate } from '@/infra/external/nfe/sefaz/certificate-loader';
import { XmllintSchemaValidator } from '@/infra/external/nfe/sefaz/schema-validator';
import { SefazXmlSigner } from '@/infra/external/nfe/sefaz/xml-signer';
import { buildNfeProc } from './nfe-proc';

const NFE = readFileSync(
  join(__dirname, '../domain/builder/__fixtures__/simples-102.xml'),
  'utf8',
).trim();
const KEY = '35261111222333000181550010000000101123456783';
const PROT = `<protNFe versao="4.00"><infProt Id="ID135260000000001"><tpAmb>2</tpAmb><verAplic>SP_NFE_PL_009_V4</verAplic><chNFe>${KEY}</chNFe><dhRecbto>2026-11-26T10:00:05-03:00</dhRecbto><nProt>135260000000001</nProt><digVal>qW3k0Zq0e3Qy2k1kq3cYp0sKq1A=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;

function signed(): { xml: string; certPem: string } {
  const { pfx, password } = makeTestA1({ cnpj: '11222333000181' });
  const cert = loadCertificate(pfx, password);
  return {
    xml: new SefazXmlSigner().sign(NFE, 'infNFe', cert),
    certPem: cert.certPem,
  };
}

/** The signature of the first `<Signature>` against the whole document, as the SEFAZ does. */
function signatureHolds(document: string, certPem: string): boolean {
  const signature = /<Signature[\s\S]*?<\/Signature>/.exec(document)?.[0];
  if (!signature) return false;
  const checker = new SignedXml({ publicCert: certPem });
  checker.loadSignature(signature);
  return checker.checkSignature(document);
}

describe('buildNfeProc', () => {
  const { xml, certPem } = signed();

  it('joins the NFe and the protNFe inside nfeProc, byte for byte', () => {
    const proc = buildNfeProc(xml, PROT);
    expect(proc).toBe(
      `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${xml}${PROT}</nfeProc>`,
    );
  });

  it('keeps the signature of the NFe valid inside the nfeProc', () => {
    expect(signatureHolds(xml, certPem)).toBe(true);
    expect(signatureHolds(buildNfeProc(xml, PROT), certPem)).toBe(true);
  });

  it('passes the official procNFe schema', async () => {
    const result = await new XmllintSchemaValidator().validate(
      buildNfeProc(xml, PROT),
      'nfeProc',
    );
    expect(result).toEqual({ ok: true });
  });

  it('accepts the XML declaration the SEFAZ answer may carry', () => {
    const proc = buildNfeProc(
      `<?xml version="1.0" encoding="UTF-8"?>${xml}`,
      `<?xml version="1.0"?>${PROT}`,
    );
    expect(proc.match(/<\?xml/g)).toHaveLength(1);
  });

  it('refuses a piece that is not what it says', () => {
    expect(() => buildNfeProc('<outra/>', PROT)).toThrow('not an NFe');
    expect(() => buildNfeProc(xml, '<retEnviNFe/>')).toThrow('not a protNFe');
  });
});
