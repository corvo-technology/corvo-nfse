import { createSign } from 'node:crypto';
import type { LoadedCertificate } from '@/modules/fiscal-core/domain/ports/xml.port';

/**
 * Signs the parameters 1 to 7 of the off-line QR Code v3 with the A1 key of the issuer: RSA with
 * SHA-1 (PKCS#1 v1.5), base64 (Manual de Padrões do DANFE NFC-e e QR Code, Tabela 7; see
 * `docs/fiscal/nfce-qrcode.md`). The key stays in memory; nothing is logged.
 */
export class QrPayloadSigner {
  sign(payload: string, certificate: LoadedCertificate): string {
    const signer = createSign('RSA-SHA1');
    signer.update(payload, 'utf8');
    signer.end();
    return signer.sign(certificate.keyPem, 'base64');
  }
}
