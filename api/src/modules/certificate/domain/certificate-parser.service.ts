/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access */
import * as forge from 'node-forge';
import { ParsedP12 } from './certificate';
import {
  CertificateInvalidError,
  CertificateExpiredError,
  CertificateTaxIdMismatchError,
} from './errors';

/** Formatted CNPJ, numeric or alphanumeric (2026 format): 11.222.333/0001-81 or RL.J1X.FI8/0001-02. */
const CNPJ_REGEX =
  /\b[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-\d{2}\b/;
/** 14 characters at the end of the name ("EMPRESA LTDA:11222333000181"); the last two are digits. */
const CNPJ_AT_END = /(?:^|[^0-9A-Z])([0-9A-Z]{12}\d{2})\s*$/;
/** ICP-Brasil: otherName in subjectAltName holding the CNPJ of an e-CNPJ certificate. */
const OID_ICP_BRASIL_CNPJ = '2.16.76.1.3.3';

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
        taxId: this.extractTaxId(cert),
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

  /**
   * CNPJ the certificate was issued to. The official place is the ICP-Brasil
   * otherName (OID 2.16.76.1.3.3) in subjectAltName; the CN ("NAME:CNPJ") is the
   * fallback. Other numbers in the subject, such as the CNPJ of the registration
   * authority in an OU, are never used. Returns null when none is found (e-CPF).
   */
  extractTaxId(cert: any): string | null {
    const fromAltName = this.cnpjFromAltName(cert);
    if (fromAltName) return fromAltName;
    const commonName = cert.subject?.getField?.('CN')?.value;
    return typeof commonName === 'string'
      ? this.cnpjFromName(commonName)
      : null;
  }

  /** Same rule applied to a flattened subject string ("C=BR, OU=..., CN=NAME:CNPJ"). */
  extractCNPJFromSubject(subject: string): string | null {
    const commonName = /(?:^|, )CN=([^,]*)/.exec(subject)?.[1];
    return commonName ? this.cnpjFromName(commonName) : null;
  }

  private cnpjFromName(name: string): string | null {
    const upper = name.toUpperCase();
    const formatted = upper.match(CNPJ_REGEX);
    if (formatted) return formatted[0].replace(/[./-]/g, '');
    return CNPJ_AT_END.exec(upper)?.[1] ?? null;
  }

  private cnpjFromAltName(cert: any): string | null {
    try {
      const extension = cert.getExtension?.('subjectAltName');
      if (!extension?.value) return null;
      const names = forge.asn1.fromDer(extension.value);
      for (const general of names.value as any[]) {
        // otherName is the [0] choice of GeneralName: SEQUENCE { OID, [0] value }.
        if (
          general.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC ||
          general.type !== 0
        )
          continue;
        const [oid, wrapped] = general.value as any[];
        if (forge.asn1.derToOid(oid.value) !== OID_ICP_BRASIL_CNPJ) continue;
        const raw = String(wrapped?.value?.[0]?.value ?? '')
          .trim()
          .toUpperCase();
        if (/^[0-9A-Z]{12}\d{2}$/.test(raw)) return raw;
      }
    } catch {
      // A malformed extension must not block the upload: fall back to the CN.
    }
    return null;
  }
}
