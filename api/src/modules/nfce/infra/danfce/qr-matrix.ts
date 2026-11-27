import QRCode from 'qrcode';

/**
 * The modules of a QR Code (`true` is a dark module), error correction M. Pure JS: the renderer draws
 * rectangles with it, so the PDF has no PNG and no native module. Deterministic: the same text gives
 * the same matrix.
 */
export function qrMatrix(text: string): boolean[][] {
  if (!text) throw new Error('The QR Code needs a text');
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = modules.size;
  const rows: boolean[][] = [];
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col += 1)
      line.push(Boolean(modules.get(row, col)));
    rows.push(line);
  }
  return rows;
}
