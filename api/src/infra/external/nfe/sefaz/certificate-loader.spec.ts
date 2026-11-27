import { makeTestA1 } from '../../../../../test/fixtures/nfe/test-a1';
import {
  CertificateLoadError,
  ICP_BRASIL_CA,
  loadCertificate,
} from './certificate-loader';

describe('loadCertificate', () => {
  it('returns PEMs, the CNPJ and the expiry date of the A1', () => {
    const notAfter = new Date('2029-05-17T12:00:00Z');
    const { pfx, password } = makeTestA1({ cnpj: '11222333000181', notAfter });
    const cert = loadCertificate(pfx, password);
    expect(cert.cnpj).toBe('11222333000181');
    expect(cert.notAfter.getTime()).toBe(notAfter.getTime());
    expect(cert.certPem).toContain('BEGIN CERTIFICATE');
    expect(cert.keyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('reads an alphanumeric CNPJ', () => {
    const { pfx, password } = makeTestA1({ cnpj: '12ABC34501DE35' });
    expect(loadCertificate(pfx, password).cnpj).toBe('12ABC34501DE35');
  });

  it('fails with a wrong password without leaking it', () => {
    const { pfx } = makeTestA1({ cnpj: '11222333000181' });
    const wrong = 'wrong-password-123';
    let error: unknown;
    try {
      loadCertificate(pfx, wrong);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CertificateLoadError);
    expect((error as Error).message).not.toContain(wrong);
  });

  it('fails for garbage that is not a PFX', () => {
    expect(() => loadCertificate(Buffer.from('not a pfx'), 'x')).toThrow(
      CertificateLoadError,
    );
  });
});

describe('ICP_BRASIL_CA', () => {
  it('holds at least one certificate', () => {
    expect(ICP_BRASIL_CA).toContain('BEGIN CERTIFICATE');
  });
});
