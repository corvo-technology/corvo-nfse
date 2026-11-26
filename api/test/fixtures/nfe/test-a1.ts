/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-argument */
import * as forge from 'node-forge';

let cachedKeys: any = null;

/** RSA generation in pure JS takes a second or two, so one pair serves the whole test process. */
function keys(): any {
  cachedKeys ??= forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  return cachedKeys;
}

/**
 * Self-signed A1 generated at test time. No real PFX ever lives in the repository; the CN follows
 * the ICP-Brasil "NAME:CNPJ" convention that `loadCertificate` reads.
 */
export function makeTestA1(opts: {
  cnpj: string;
  notAfter?: Date;
  notBefore?: Date;
  password?: string;
}): { pfx: Buffer; password: string } {
  const password = opts.password ?? 'test-password-not-secret';
  const pair = keys();
  const cert = forge.pki.createCertificate();
  cert.publicKey = pair.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = opts.notBefore ?? new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = opts.notAfter ?? new Date('2030-01-01T00:00:00Z');
  const attrs = [
    { name: 'commonName', value: `EMPRESA DE TESTE LTDA:${opts.cnpj}` },
    { name: 'countryName', value: 'BR' },
    { shortName: 'O', value: 'ICP-Brasil' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(pair.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(pair.privateKey, [cert], password, {
    algorithm: '3des',
  });
  const pfx = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
  return { pfx, password };
}
