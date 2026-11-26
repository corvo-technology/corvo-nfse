import { SignedXml } from 'xml-crypto';
import { makeTestA1 } from '../../../../../test/fixtures/nfe/test-a1';
import { loadCertificate } from './certificate-loader';
import {
  SefazXmlSigner,
  withStructuralSignature,
  XmlAlreadySignedError,
} from './xml-signer';

const NS = 'http://www.portalfiscal.inf.br/nfe';
const KEY = '35261112345678000195550010000000011234567810';

const NFE = `<NFe xmlns="${NS}"><infNFe Id="NFe${KEY}" versao="4.00"><ide><cUF>35</cUF><natOp>Venda &amp; revenda</natOp></ide><det nItem="1"><prod><xProd>Café "especial"</xProd></prod></det></infNFe></NFe>`;
const EVENTO = `<evento xmlns="${NS}" versao="1.00"><infEvento Id="ID1101113526111234567800019555001000000001123456781001"><cOrgao>35</cOrgao></infEvento></evento>`;
const INUT = `<inutNFe xmlns="${NS}" versao="4.00"><infInut Id="ID35261112345678000195550010000000010000000001"><tpAmb>2</tpAmb></infInut></inutNFe>`;

function certificate() {
  const { pfx, password } = makeTestA1({ cnpj: '12345678000195' });
  return loadCertificate(pfx, password);
}

function verify(signedXml: string, certPem: string): boolean {
  const signature = /<Signature[\s\S]*<\/Signature>/.exec(signedXml)?.[0];
  if (!signature) return false;
  const checker = new SignedXml({ publicCert: certPem });
  checker.loadSignature(signature);
  return checker.checkSignature(signedXml);
}

describe('SefazXmlSigner', () => {
  const signer = new SefazXmlSigner();
  const cert = certificate();

  it.each([
    ['infNFe', NFE],
    ['infEvento', EVENTO],
    ['infInut', INUT],
  ] as const)('signs %s and the signature verifies', (tag, xml) => {
    const signed = signer.sign(xml, tag, cert);
    expect(verify(signed, cert.certPem)).toBe(true);
  });

  it.each([
    ['infNFe', NFE, 'Café', 'Caffé'],
    ['infEvento', EVENTO, '<cOrgao>35', '<cOrgao>41'],
    ['infInut', INUT, '<tpAmb>2', '<tpAmb>1'],
  ] as const)(
    'fails verification when %s is changed after signing',
    (tag, xml, from, to) => {
      const signed = signer.sign(xml, tag, cert);
      const tampered = signed.replace(from, to);
      expect(tampered).not.toBe(signed);
      expect(verify(tampered, cert.certPem)).toBe(false);
    },
  );

  it('uses the algorithms the layout requires and puts Signature last', () => {
    const signed = signer.sign(NFE, 'infNFe', cert);
    expect(signed).toContain(
      'Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"',
    );
    expect(signed).toContain(
      'Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"',
    );
    expect(signed).toContain(
      'CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"',
    );
    expect(signed).toContain(`<Reference URI="#NFe${KEY}">`);
    expect(signed).toMatch(
      /<\/infNFe><Signature [^>]*>[\s\S]*<\/Signature><\/NFe>$/,
    );
    // Only the leaf certificate, as plain base64.
    expect(signed).toMatch(
      /<X509Certificate>[A-Za-z0-9+/=]+<\/X509Certificate>/,
    );
  });

  it('throws when the XML is already signed', () => {
    const signed = signer.sign(NFE, 'infNFe', cert);
    expect(() => signer.sign(signed, 'infNFe', cert)).toThrow(
      XmlAlreadySignedError,
    );
  });

  it('does not put the document in the error when signing fails', () => {
    expect(() =>
      signer.sign(NFE.replace(/ Id="[^"]+"/, ''), 'infNFe', cert),
    ).toThrow(/without an Id/);
  });
});

describe('withStructuralSignature', () => {
  it('appends a Signature with the right shape as the last child', () => {
    const out = withStructuralSignature(NFE, 'infNFe');
    expect(out).toMatch(
      /<\/infNFe><Signature [^>]*>[\s\S]*<\/Signature><\/NFe>$/,
    );
    expect(out).toContain(`URI="#NFe${KEY}"`);
  });

  it('refuses an XML that is already signed', () => {
    const signed = withStructuralSignature(NFE, 'infNFe');
    expect(() => withStructuralSignature(signed, 'infNFe')).toThrow(
      XmlAlreadySignedError,
    );
  });
});
