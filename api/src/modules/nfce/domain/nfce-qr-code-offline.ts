import { NFCE_QR_VERSION } from './nfce-qr-code';

export interface NfceQrOfflineParams {
  accessKey: string;
  tpAmb: 1 | 2;
  /** Day of `dhEmi`, 2 digits (`01`..`31`). */
  day: string;
  /** `vNF` with a decimal point, no thousands separator (`10.00`). */
  vNF: string;
  /** 1 CNPJ, 2 CPF, 3 foreign id, empty when the consumer is not identified. */
  destIdType: '' | '1' | '2' | '3';
  destId: string;
}

function assertParams(base: string, p: NfceQrOfflineParams): void {
  if (!base) throw new Error('The QR Code base URL is required');
  if (base.includes('?'))
    throw new Error('The QR Code base URL must not have a query');
  if (!/^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/.test(p.accessKey))
    throw new Error('The access key is not valid for the QR Code');
  if (!/^(0[1-9]|[12][0-9]|3[01])$/.test(p.day))
    throw new Error('The day must have exactly 2 digits (01 to 31)');
  if (!/^(0|0\.[0-9]{2}|[1-9][0-9]{0,12}(\.[0-9]{2})?)$/.test(p.vNF))
    throw new Error('vNF must use a decimal point and no thousands separator');
  if (p.destIdType === '' && p.destId !== '')
    throw new Error('An unidentified consumer has no id');
  if (p.destIdType === '3' && p.destId !== '')
    throw new Error('A foreign id is not carried in the QR Code');
  if (
    p.destIdType === '1' &&
    !/^([0-9A-Z]{12}[0-9]{2}|[0-9]{11})$/.test(p.destId)
  )
    throw new Error('The CNPJ is not valid for the QR Code');
  if (p.destIdType === '2' && !/^[0-9]{11}$/.test(p.destId))
    throw new Error('The CPF is not valid for the QR Code');
}

/** The text the issuer signs: parameters 1 to 7 with their separators (Tabela 7). */
export function nfceQrPayloadOffline(p: NfceQrOfflineParams): string {
  return [
    p.accessKey,
    NFCE_QR_VERSION,
    String(p.tpAmb),
    p.day,
    p.vNF,
    p.destIdType,
    p.destId,
  ].join('|');
}

/** QR Code v3 of a NFC-e in off-line contingency (`tpEmis` 9): the signed parameters in the URL. */
export function nfceQrCodeOffline(
  base: string,
  p: NfceQrOfflineParams,
  signature: string,
): string {
  assertParams(base, p);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))
    throw new Error('The signature must be base64');
  return `${base}?p=${nfceQrPayloadOffline(p)}|${signature}`;
}
