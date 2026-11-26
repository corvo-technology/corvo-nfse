/**
 * Code 128, subset C: the barcode of the access key of the DANFE (MOC, Anexo II). Digits go in
 * pairs, so the 44 digits of the key take 22 symbols.
 */

/**
 * Bar/space widths (in modules) of the symbols 0 to 106, starting with a bar. The last one is the
 * stop symbol (7 elements, with the final bar); the others have 6.
 */
const PATTERNS: readonly string[] = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
  '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
  '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
  '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
  '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
  '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
  '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
  '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
  '114131 311141 411131 211412 211214 211232 2331112'
).split(' ');

const START_C = 105;
const STOP = 106;

/** The symbol values of the barcode: start C, the digit pairs, the check symbol and the stop. */
export function encodeCode128C(digits: string): number[] {
  if (!/^\d+$/.test(digits) || digits.length % 2 !== 0)
    throw new Error('Code 128C encodes an even number of digits');
  const values: number[] = [];
  for (let i = 0; i < digits.length; i += 2)
    values.push(Number(digits.slice(i, i + 2)));
  const checksum =
    (START_C +
      values.reduce((sum, value, index) => sum + value * (index + 1), 0)) %
    103;
  return [START_C, ...values, checksum, STOP];
}

/**
 * The widths, in modules, of every bar and space of the barcode, in order, starting with a bar
 * (the odd positions are bars, the even ones are spaces).
 */
export function code128Widths(symbols: readonly number[]): number[] {
  return symbols.flatMap((symbol) => {
    const pattern = PATTERNS[symbol];
    if (!pattern) throw new Error(`Unknown Code 128 symbol ${symbol}`);
    return [...pattern].map(Number);
  });
}
