import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';

/** Digit counts accepted for the state registration (IE) of each UF. Format only, except SP. */
export const IE_LENGTH_BY_UF: Readonly<Record<Uf, readonly number[]>> = {
  AC: [13],
  AL: [9],
  AM: [9],
  AP: [9],
  BA: [8, 9],
  CE: [9],
  DF: [13],
  ES: [9],
  GO: [9],
  MA: [9],
  MG: [13],
  MS: [9],
  MT: [11],
  PA: [9],
  PB: [9],
  PE: [9, 14],
  PI: [9],
  PR: [10],
  RJ: [8],
  RN: [9, 10],
  RO: [14],
  RR: [9],
  RS: [10],
  SC: [9],
  SE: [9],
  SP: [12],
  TO: [11],
};

const SP_WEIGHTS_FIRST = [1, 3, 4, 5, 6, 7, 8, 10];
const SP_WEIGHTS_SECOND = [3, 2, 10, 9, 8, 7, 6, 5, 4, 3, 2];

function weightedDigit(digits: number[], weights: number[]): number {
  const sum = weights.reduce(
    (total, weight, i) => total + weight * digits[i],
    0,
  );
  return (sum % 11) % 10;
}

function validSaoPaulo(ie: string): boolean {
  const d = [...ie].map(Number);
  return (
    weightedDigit(d, SP_WEIGHTS_FIRST) === d[8] &&
    weightedDigit(d, SP_WEIGHTS_SECOND) === d[11]
  );
}

/**
 * Issuer IE: digits only (dots, dashes and slashes are ignored). São Paulo is checked with the
 * two official check digits; the other UFs only by length. `ISENTO` is not valid for an issuer.
 */
export function validateStateRegistration(uf: Uf, ie: string): boolean {
  const digits = ie.replace(/[.\-/\s]/g, '');
  if (!/^\d+$/.test(digits)) return false;
  const lengths = IE_LENGTH_BY_UF[uf];
  if (!lengths?.includes(digits.length)) return false;
  return uf === 'SP' ? validSaoPaulo(digits) : true;
}

/** The digits only, as stored and sent in the XML. */
export function normalizeStateRegistration(ie: string): string {
  return ie.replace(/[.\-/\s]/g, '');
}
