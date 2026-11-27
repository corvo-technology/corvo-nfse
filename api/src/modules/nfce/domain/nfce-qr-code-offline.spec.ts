import { createVerify } from 'node:crypto';
import { makeTestA1 } from '../../../../test/fixtures/nfe/test-a1';
import { loadCertificate } from '@/infra/external/nfe/sefaz/certificate-loader';
import { QrPayloadSigner } from '@/infra/external/nfe/sefaz/qr-signer';
import {
  nfceQrCodeOffline,
  nfceQrPayloadOffline,
  type NfceQrOfflineParams,
} from './nfce-qr-code-offline';

const KEY = '35261111222333000181650010000000011900000019';
const BASE = 'https://www.nfce.fazenda.sp.gov.br/qrcode';
const PARAMS: NfceQrOfflineParams = {
  accessKey: KEY,
  tpAmb: 2,
  day: '05',
  vNF: '10.50',
  destIdType: '2',
  destId: '12345678909',
};

describe('nfceQrCodeOffline', () => {
  it('joins the 7 signed parameters and the signature', () => {
    expect(nfceQrPayloadOffline(PARAMS)).toBe(
      `${KEY}|3|2|05|10.50|2|12345678909`,
    );
    expect(nfceQrCodeOffline(BASE, PARAMS, 'QUJD+/9=')).toBe(
      `${BASE}?p=${KEY}|3|2|05|10.50|2|12345678909|QUJD+/9=`,
    );
  });

  it('keeps the separators of an unidentified consumer', () => {
    const p = { ...PARAMS, destIdType: '' as const, destId: '' };
    expect(nfceQrPayloadOffline(p)).toBe(`${KEY}|3|2|05|10.50||`);
    expect(nfceQrCodeOffline(BASE, p, 'QUJD')).toBe(
      `${BASE}?p=${KEY}|3|2|05|10.50|||QUJD`,
    );
  });

  it('matches the pattern of the official XSD', () => {
    const qr = nfceQrCodeOffline(BASE, PARAMS, 'QUJD+/9=');
    const xsd =
      /^((HTTPS?|https?):\/\/.*\?p=([0-9]{6}[0-9A-Z]{12}[0-9]{16}(9)[0-9]{9})\|[3]\|[1-2]\|([0]{1}[1-9]{1}|[1-2]{1}[0-9]{1}|[3]{1}[0-1]{1})\|(0|0\.[0-9]{2}|[1-9]{1}[0-9]{0,12}(\.[0-9]{2})?)\|((1|2|3)?)\|((([0-9A-Z]{12}[0-9]{2})|([0-9]{11}))?)\|([a-zA-Z0-9+/]+[=]{0,2}))$/;
    // The key of this fixture has tpEmis 1; the XSD wants 9 in position 35.
    const offlineKey = `${KEY.slice(0, 34)}9${KEY.slice(35)}`;
    const offline = nfceQrCodeOffline(
      BASE,
      { ...PARAMS, accessKey: offlineKey },
      'QUJD+/9=',
    );
    expect(xsd.test(offline)).toBe(true);
    expect(qr.length).toBeGreaterThan(60);
  });

  it.each([
    ['day with 1 digit', { day: '5' }],
    ['day 32', { day: '32' }],
    ['vNF with a comma', { vNF: '10,50' }],
    ['vNF with a thousands separator', { vNF: '1,000.00' }],
    ['a CPF with 10 digits', { destId: '1234567890' }],
    ['an id without a type', { destIdType: '' as const }],
  ])('refuses %s', (_name, override) => {
    expect(() =>
      nfceQrCodeOffline(BASE, { ...PARAMS, ...override }, 'QUJD'),
    ).toThrow();
  });

  it('refuses a signature that is not base64', () => {
    expect(() => nfceQrCodeOffline(BASE, PARAMS, 'not base64!')).toThrow();
  });
});

describe('QrPayloadSigner', () => {
  it('signs with RSA SHA-1 and the signature verifies with the certificate', () => {
    const { pfx, password } = makeTestA1({ cnpj: '11222333000181' });
    const cert = loadCertificate(pfx, password);
    const payload = nfceQrPayloadOffline(PARAMS);
    const signature = new QrPayloadSigner().sign(payload, cert);

    expect(signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    const verify = createVerify('RSA-SHA1');
    verify.update(payload, 'utf8');
    expect(verify.verify(cert.certPem, signature, 'base64')).toBe(true);
    // PKCS#1 v1.5 is deterministic: the same payload gives the same signature.
    expect(new QrPayloadSigner().sign(payload, cert)).toBe(signature);
  });
});
