import { normalizeTaxID } from './tax-id';

describe('normalizeTaxID', () => {
  describe('numeric CPF/CNPJ', () => {
    it('strips punctuation from CPF', () => {
      expect(normalizeTaxID('123.456.789-01')).toBe('12345678901');
    });

    it('strips punctuation from CPF — real example', () => {
      expect(normalizeTaxID('768.828.340-08')).toBe('76882834008');
    });

    it('strips punctuation from CNPJ', () => {
      expect(normalizeTaxID('12.345.678/0001-99')).toBe('12345678000199');
    });

    it('strips punctuation from CNPJ — real example', () => {
      expect(normalizeTaxID('52.805.431/0001-29')).toBe('52805431000129');
    });

    it('is idempotent when already normalized', () => {
      expect(normalizeTaxID('12345678901')).toBe('12345678901');
      expect(normalizeTaxID('12345678000199')).toBe('12345678000199');
      expect(normalizeTaxID('76882834008')).toBe('76882834008');
      expect(normalizeTaxID('52805431000129')).toBe('52805431000129');
    });
  });

  describe('alphanumeric CNPJ (IN RFB 2.229/2024)', () => {
    it('strips punctuation and uppercases letters', () => {
      expect(normalizeTaxID('FD.NKX.YDC/0001-93')).toBe('FDNKXYDC000193');
    });

    it('handles lowercase input', () => {
      expect(normalizeTaxID('fd.nkx.ydc/0001-93')).toBe('FDNKXYDC000193');
    });

    it('is idempotent when already normalized', () => {
      expect(normalizeTaxID('FDNKXYDC000193')).toBe('FDNKXYDC000193');
    });
  });

  describe('edge cases', () => {
    it('treats empty or punctuation-only values as absent', () => {
      expect(normalizeTaxID('')).toBeUndefined();
      expect(normalizeTaxID(' .- / ')).toBeUndefined();
      expect(normalizeTaxID(null)).toBeUndefined();
      expect(normalizeTaxID(undefined)).toBeUndefined();
    });
  });
});
