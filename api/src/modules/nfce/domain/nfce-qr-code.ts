/**
 * QR Code version 3, online emission (`tpEmis` 1), NT 2025.001. No CSC and no hash: the content is
 * `<base>?p=<chave>|3|<tpAmb>`. The pattern is the one of the official `infNFeSupl/qrCode` in the
 * vendored XSD (`...\?p=([0-9]{6}[0-9A-Z]{12}[0-9]{16}(1|3|4)[0-9]{9})\|[3]\|[1-2]`) [verificado].
 */
export const NFCE_QR_VERSION = '3';

const MIN_LENGTH = 60;
const MAX_LENGTH = 1000;

export function nfceQrCodeOnline(
  base: string,
  accessKey: string,
  tpAmb: 1 | 2,
): string {
  if (!base) throw new Error('The QR Code base URL is required');
  if (base.includes('?'))
    throw new Error('The QR Code base URL must not have a query');
  if (!/^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/.test(accessKey))
    throw new Error('The access key is not valid for the QR Code');
  const qr = `${base}?p=${accessKey}|${NFCE_QR_VERSION}|${tpAmb}`;
  if (qr.length < MIN_LENGTH || qr.length > MAX_LENGTH)
    throw new Error(
      `The QR Code must have ${MIN_LENGTH} to ${MAX_LENGTH} characters`,
    );
  return qr;
}
