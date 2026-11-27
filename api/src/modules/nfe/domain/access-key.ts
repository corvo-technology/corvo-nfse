import { randomInt } from 'node:crypto';
import type { TpEmis } from '@/modules/fiscal-core/domain/ports/authority.port';

export class AccessKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessKeyError';
  }
}

const CNPJ_PATTERN = /^[0-9A-Z]{12}[0-9]{2}$/;
const CNF_SPACE = 100_000_000;

/**
 * Check digit of the chave de acesso: modulo 11, weights 2..9 from right to left (restarting at 2
 * after 9); remainder 0 or 1 gives DV 0.
 *
 * Each character is worth `charCode - 48`. For digits that is the digit itself; for the letters of
 * the alphanumeric CNPJ (NT 2026.004) it is the same rule the Receita Federal uses for the CNPJ DV
 * (A = 17 ... Z = 42). [verificar no spike]: NT 2026.004 v1.01 only says the key accepts letters; it
 * does not spell out the DV rule, so this is proven only when a SEFAZ authorizes such a key.
 */
export function accessKeyDv(first43: string): number {
  if (!/^[0-9A-Z]{43}$/.test(first43))
    throw new AccessKeyError('The first 43 characters must be [0-9A-Z]');
  let sum = 0;
  let weight = 2;
  for (let i = first43.length - 1; i >= 0; i--) {
    sum += (first43.charCodeAt(i) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function digits(value: number, length: number, name: string): string {
  if (!Number.isInteger(value) || value < 0 || String(value).length > length)
    throw new AccessKeyError(`${name} does not fit in ${length} digits`);
  return String(value).padStart(length, '0');
}

export interface AccessKeyParts {
  cUF: string;
  /** dhEmi with the offset of the issuer's UF; AAMM is read from its text, never from UTC. */
  issuedAt: string;
  cnpj: string;
  model: 55 | 65;
  series: number;
  number: number;
  tpEmis: TpEmis;
  cNF: string;
}

/** cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1) = 44 characters. */
export function buildAccessKey(p: AccessKeyParts): string {
  if (!/^\d{2}$/.test(p.cUF))
    throw new AccessKeyError('cUF must have 2 digits');
  const date = /^(\d{4})-(\d{2})-\d{2}T/.exec(p.issuedAt);
  if (!date) throw new AccessKeyError('issuedAt must be an ISO dhEmi');
  if (!CNPJ_PATTERN.test(p.cnpj))
    throw new AccessKeyError('cnpj must have 14 characters [0-9A-Z]');
  if (!/^\d{8}$/.test(p.cNF))
    throw new AccessKeyError('cNF must have 8 digits');
  const aamm = `${date[1].slice(2)}${date[2]}`;
  const first43 =
    p.cUF +
    aamm +
    p.cnpj +
    String(p.model) +
    digits(p.series, 3, 'series') +
    digits(p.number, 9, 'number') +
    String(p.tpEmis) +
    p.cNF;
  return `${first43}${accessKeyDv(first43)}`;
}

/** Sequences and repetitions the MOC treats as a lazy cNF. [verificar no spike]: exact list. */
function isPredictable(cNF: string): boolean {
  if (/^(\d)\1{7}$/.test(cNF)) return true;
  return '01234567890123456789'.includes(cNF);
}

/**
 * Random 8-digit cNF from a CSPRNG. It is never equal to the nNF (the MOC forbids it) and never a
 * trivial pattern. `rnd(max)` returns an integer in [0, max) and is injectable for tests.
 */
export function randomCnf(
  nNF: number,
  rnd: (max: number) => number = (max) => randomInt(0, max),
): string {
  for (;;) {
    const value = rnd(CNF_SPACE);
    const cNF = String(value).padStart(8, '0');
    if (value !== nNF && !isPredictable(cNF)) return cNF;
  }
}
