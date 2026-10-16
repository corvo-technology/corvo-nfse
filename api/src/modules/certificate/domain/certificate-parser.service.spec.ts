/* eslint-disable @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-return,@typescript-eslint/no-unsafe-argument */
import * as forge from 'node-forge';
import { CertificateParserService } from './certificate-parser.service';

const COMPANY = '11222333000181';
const REGISTRATION_AUTHORITY = '29979036000140';
const PASSWORD = 'secret';

const OID_CNPJ = '2.16.76.1.3.3';
const OID_RESPONSIBLE_NAME = '2.16.76.1.3.2';

/** subjectAltName with ICP-Brasil otherName entries: [oid, value] pairs. */
function icpBrasilAltNames(entries: [string, string][]): string {
  const otherName = ([oid, value]: [string, string]) =>
    forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer(oid).getBytes(),
      ),
      forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.PRINTABLESTRING,
          false,
          value,
        ),
      ]),
    ]);
  return forge.asn1
    .toDer(
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.SEQUENCE,
        true,
        entries.map(otherName),
      ),
    )
    .getBytes();
}

function buildP12(options: {
  subject: forge.pki.CertificateField[];
  altNames?: [string, string][];
}): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  cert.setSubject(options.subject);
  cert.setIssuer([{ name: 'commonName', value: 'AC Teste' }]);
  if (options.altNames) {
    cert.setExtensions([
      {
        id: '2.5.29.17',
        critical: false,
        value: icpBrasilAltNames(options.altNames),
      } as never,
    ]);
  }
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSWORD, {
    algorithm: '3des',
  });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

// ICP-Brasil encodes the subject as C, O, OU..., CN: the CN comes last.
const subjectOf = (cn: string): forge.pki.CertificateField[] => [
  { name: 'countryName', value: 'BR' },
  { name: 'organizationName', value: 'ICP-Brasil' },
  { shortName: 'OU', value: 'Secretaria da Receita Federal do Brasil - RFB' },
  { shortName: 'OU', value: REGISTRATION_AUTHORITY },
  { shortName: 'OU', value: 'AC Exemplo v5' },
  { name: 'commonName', value: cn },
];

const parse = (p12: Buffer) =>
  new CertificateParserService().parseP12(p12, PASSWORD);

describe('CertificateParserService tax id', () => {
  it('reads the CNPJ from the ICP-Brasil subjectAltName, not from another number in the subject', () => {
    const p12 = buildP12({
      subject: subjectOf('EMPRESA TESTE LTDA:' + COMPANY),
      altNames: [[OID_CNPJ, COMPANY]],
    });
    expect(parse(p12).taxId).toBe(COMPANY);
  });

  it('is not fooled by the registration authority CNPJ that appears before the CN', () => {
    const p12 = buildP12({
      subject: subjectOf('EMPRESA TESTE LTDA:' + COMPANY),
    });
    const parsed = parse(p12);
    expect(parsed.taxId).toBe(COMPANY);
    expect(
      new CertificateParserService().extractCNPJFromSubject(parsed.subject),
    ).toBe(COMPANY);
  });

  it('prefers the subjectAltName when the CN holds something else', () => {
    const p12 = buildP12({
      subject: subjectOf('EMPRESA TESTE LTDA'),
      altNames: [
        [OID_RESPONSIBLE_NAME, 'JOAO DA SILVA'],
        [OID_CNPJ, COMPANY],
      ],
    });
    expect(parse(p12).taxId).toBe(COMPANY);
  });

  it('returns null for a person certificate (e-CPF), so no company is rejected for it', () => {
    const p12 = buildP12({ subject: subjectOf('JOAO DA SILVA:12345678909') });
    expect(parse(p12).taxId).toBeNull();
  });

  it('reads a formatted CNPJ in the CN', () => {
    const p12 = buildP12({ subject: subjectOf('EMPRESA 11.222.333/0001-81') });
    expect(parse(p12).taxId).toBe(COMPANY);
  });
  describe('alphanumeric CNPJ (2026 format)', () => {
    const ALPHANUMERIC = 'RLJ1XFI8000102';

    it('is not replaced by the numeric CNPJ of the registration authority', () => {
      // The old rule only looked for 14 digits and picked the OU number instead.
      const p12 = buildP12({
        subject: subjectOf('EMPRESA TESTE LTDA:' + ALPHANUMERIC),
      });
      const parsed = parse(p12);
      expect(parsed.taxId).toBe(ALPHANUMERIC);
      expect(
        new CertificateParserService().extractCNPJFromSubject(parsed.subject),
      ).toBe(ALPHANUMERIC);
    });

    it('reads it from the ICP-Brasil subjectAltName', () => {
      const p12 = buildP12({
        subject: subjectOf('EMPRESA TESTE LTDA'),
        altNames: [[OID_CNPJ, ALPHANUMERIC]],
      });
      expect(parse(p12).taxId).toBe(ALPHANUMERIC);
    });

    it('reads the formatted form RL.J1X.FI8/0001-02', () => {
      const p12 = buildP12({
        subject: subjectOf('EMPRESA TESTE LTDA RL.J1X.FI8/0001-02'),
      });
      expect(parse(p12).taxId).toBe(ALPHANUMERIC);
    });

    it('does not take a common word with digits for a CNPJ', () => {
      const p12 = buildP12({ subject: subjectOf('MARIA DA SILVA 2026') });
      expect(parse(p12).taxId).toBeNull();
    });
  });
});
