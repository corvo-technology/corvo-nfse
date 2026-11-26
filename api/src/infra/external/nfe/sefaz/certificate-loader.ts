/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-return,@typescript-eslint/no-unsafe-argument */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as forge from 'node-forge';
import type { LoadedCertificate } from '@/modules/fiscal-core/domain/ports/xml.port';
import { CertificateParserService } from '@/modules/certificate/domain/certificate-parser.service';

/** The message never carries the password, the PFX or any part of the key. */
export class CertificateLoadError extends Error {
  constructor(reason: string) {
    super(`Could not load the A1 certificate: ${reason}`);
    this.name = 'CertificateLoadError';
  }
}

/**
 * ICP-Brasil trust anchors for the SEFAZ server certificates, read once. Refreshed by
 * `scripts/update-icp-brasil-chain.sh` (see certs/README.md).
 */
export const ICP_BRASIL_CA: string = readFileSync(
  join(__dirname, 'certs', 'icp-brasil-chain.pem'),
  'utf8',
);

const parser = new CertificateParserService();

/**
 * Decrypts the PFX in memory. `certPem` has the leaf first, then any chain certificates found in
 * the PFX (mTLS sends the chain; the signer uses only the first block).
 */
export function loadCertificate(
  pfx: Buffer,
  password: string,
): LoadedCertificate {
  let p12: any;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(pfx.toString('binary')),
      password,
    );
  } catch {
    // The forge message can echo parser internals; the caller only needs to know it failed.
    throw new CertificateLoadError('invalid PFX or wrong password');
  }

  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[
      forge.pki.oids.keyBag
    ] ?? []),
  ];
  const key: any = keyBags.find((bag: any) => bag.key)?.key;
  if (!key) throw new CertificateLoadError('no private key in the PFX');

  const certs = (
    p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ??
    []
  )
    .map((bag: any) => bag.cert)
    .filter((c: any) => Boolean(c));
  const leaf = certs.find((c) => c.publicKey.n.equals(key.n));
  if (!leaf) throw new CertificateLoadError('no certificate matches the key');

  const cnpj = parser.extractTaxId(leaf);
  if (!cnpj) throw new CertificateLoadError('no CNPJ in the certificate');

  const chain = certs.filter((c) => c !== leaf);
  const certPem = [leaf, ...chain]
    .map((c) => forge.pki.certificateToPem(c))
    .join('');
  const keyPem = forge.pki.privateKeyInfoToPem(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key)),
  );
  return { certPem, keyPem, cnpj, notAfter: new Date(leaf.validity.notAfter) };
}
