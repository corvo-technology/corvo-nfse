import { qrMatrix } from './qr-matrix';

const QR =
  'https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=35261111222333000181650010000000311123456780|3|2';

describe('qrMatrix', () => {
  it('is a square of at least 21 modules', () => {
    const matrix = qrMatrix(QR);
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
  });

  it('is deterministic', () => {
    expect(qrMatrix(QR)).toEqual(qrMatrix(QR));
    expect(qrMatrix(QR)).not.toEqual(qrMatrix(`${QR}x`));
  });

  it('has the finder pattern in the three corners', () => {
    const matrix = qrMatrix(QR);
    const last = matrix.length - 1;
    for (const [row, col] of [
      [0, 0],
      [0, last - 6],
      [last - 6, 0],
    ]) {
      // 7x7 finder: a dark ring, a light ring and a dark 3x3 centre.
      expect(matrix[row][col]).toBe(true);
      expect(matrix[row + 6][col + 6]).toBe(true);
      expect(matrix[row + 1][col + 1]).toBe(false);
      expect(matrix[row + 3][col + 3]).toBe(true);
    }
  });

  it('refuses an empty text', () => {
    expect(() => qrMatrix('')).toThrow('needs a text');
  });
});
