import { code128Widths, encodeCode128C } from './code128c';

describe('encodeCode128C', () => {
  it('starts in subset C, ends with the check symbol and the stop', () => {
    // checksum = (105 + 12 x 1) % 103 = 14
    expect(encodeCode128C('12')).toEqual([105, 12, 14, 106]);
  });

  it('weights each pair by its position', () => {
    // (105 + 12 x 1 + 34 x 2 + 56 x 3) % 103 = 353 % 103 = 44
    expect(encodeCode128C('123456')).toEqual([105, 12, 34, 56, 44, 106]);
  });

  it('takes 22 symbols plus start, check and stop for a 44-digit key', () => {
    const symbols = encodeCode128C(
      '35261111222333000181550010000000101123456783',
    );
    expect(symbols).toHaveLength(22 + 3);
    expect(symbols[0]).toBe(105);
    expect(symbols[symbols.length - 1]).toBe(106);
  });

  it('refuses anything but an even number of digits', () => {
    expect(() => encodeCode128C('123')).toThrow('even number of digits');
    expect(() => encodeCode128C('12a4')).toThrow('even number of digits');
    expect(() => encodeCode128C('')).toThrow('even number of digits');
  });
});

describe('code128Widths', () => {
  it('draws start C as 211232 and the stop as 2331112', () => {
    expect(code128Widths([105]).join('')).toBe('211232');
    expect(code128Widths([106]).join('')).toBe('2331112');
  });

  it('gives every symbol 11 modules, and the stop 13', () => {
    const widths = code128Widths(
      encodeCode128C('35261111222333000181550010000000101123456783'),
    );
    const total = widths.reduce((sum, width) => sum + width, 0);
    expect(total).toBe(24 * 11 + 13);
    // starts with a bar and ends with a bar: an odd number of elements
    expect(widths.length % 2).toBe(1);
  });

  it('rejects a symbol outside the table', () => {
    expect(() => code128Widths([107])).toThrow('Unknown Code 128 symbol');
  });
});
