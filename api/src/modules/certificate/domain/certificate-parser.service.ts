/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access */
import * as forge from 'node-forge';
import { ParsedP12 } from './certificate';
import {
  CertificateInvalidError,
  CertificateExpiredError,
  CertificateTaxIdMismatchError,
} from './errors';

const CNPJ_REGEX = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
const CNPJ_REGEX_RAW = /\b(\d{14})\b/;

export class CertificateParserService {
  parseP12(p12Buffer: Buffer, password: string): ParsedP12 {
    try {
      const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

      let validCert: any = null;

      const certBags =
        p12.getBags({ bagType: forge.pki.oids.certBag })[
          forge.pki.oids.certBag
        ] ?? [];
      const keyBags =
        p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
          forge.pki.oids.pkcs8ShroudedKeyBag
        ] ?? [];
      const plainKeys =
        p12.getBags({ bagType: forge.pki.oids.keyBag })[
          forge.pki.oids.keyBag
        ] ?? [];
      const key = [...keyBags, ...plainKeys].find((bag) => bag.key)?.key;
      if (!key)
        throw new CertificateInvalidError('No private key found in P12 file');
      validCert = certBags.find((bag) =>
        Boolean(bag.cert?.publicKey?.n?.equals(key.n)),
      )?.cert;
      if (validCert?.validity.notBefore > new Date())
        throw new CertificateInvalidError('Certificate is not yet valid');

      if (!validCert) {
        throw new CertificateInvalidError('No certificate found in P12 file');
      }

      const cert = validCert;

      // Extract serial number
      const serialHex = cert.serialNumber?.toUpperCase() ?? '';
      const serialNumber = serialHex;

      // Extract issuer
      const issuerParts: string[] = [];
      for (const rdn of cert.issuer.attributes) {
        issuerParts.push(`${rdn.shortName}=${rdn.value}`);
      }
      const issuer = issuerParts.join(', ');

      // Extract subject
      const subjectParts: string[] = [];
      for (const rdn of cert.subject.attributes) {
        subjectParts.push(`${rdn.shortName}=${rdn.value}`);
      }
      const subject = subjectParts.join(', ');

      // Extract validity
      const validFrom = cert.validity.notBefore as Date;
      const validUntil = cert.validity.notAfter as Date;

      // Extract fingerprint (SHA-1 of DER-encoded cert)
      const derBytes = forge.asn1
        .toDer(forge.pki.certificateToAsn1(cert))
        .getBytes();
      const md = forge.md.sha1.create();
      md.update(derBytes);
      const fingerprint = md.digest().toHex().toUpperCase();

      return {
        serialNumber,
        issuer,
        subject,
        fingerprint,
        validFrom: new Date(validFrom),
        validUntil: new Date(validUntil),
        p12Buffer,
      };
    } catch (err: any) {
      if (
        err.name === 'CertificateExpiredError' ||
        err instanceof CertificateExpiredError
      ) {
        throw err;
      }
      if (err instanceof CertificateTaxIdMismatchError) {
        throw err;
      }
      throw new CertificateInvalidError(
        `Failed to parse P12 file: ${err.message ?? 'invalid password or corrupted file'}`,
      );
    }
  }

  extractCNPJFromSubject(subject: string): string | null {
    // Try formatted CNPJ first
    const match = subject.match(CNPJ_REGEX);
    if (match) return match[0].replace(/\D/g, '');

    // Try raw 14-digit CNPJ
    const rawMatch = subject.match(CNPJ_REGEX_RAW);
    if (rawMatch) return rawMatch[1];

    return null;
  }
}
