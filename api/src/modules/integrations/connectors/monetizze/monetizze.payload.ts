import { normalizeTaxID } from '@/shared/tax-id';
import {
  ConnectorDataError,
  type CustomerAddress,
  type NormalizedCustomer,
} from '../../domain/connector';

/**
 * Readers for the Monetizze postback. Monetizze documents the fields with PHP's `$_POST`
 * (github.com/Monetizze/ExemploPOSTCallback), so the body may arrive form-encoded with brackets
 * (`venda[valor]=97.00`) or as JSON; both are accepted. Values are text or numbers.
 */
export type MonetizzeBody = Record<string, unknown>;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_FIELDS = 400;
const MAX_DEPTH = 6;

const asObject = (value: unknown): MonetizzeBody | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as MonetizzeBody)
    : null;

export const text = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

/** `a[b][0][c]` -> ['a', 'b', '0', 'c']; null when the key is malformed or unsafe. */
function keyPath(key: string): string[] | null {
  const head = /^([^[\]]+)((?:\[[^[\]]*\])*)$/.exec(key);
  if (!head) return null;
  const path = [head[1]];
  for (const part of head[2].matchAll(/\[([^[\]]*)\]/g)) path.push(part[1]);
  if (path.length > MAX_DEPTH || path.some((p) => FORBIDDEN_KEYS.has(p)))
    return null;
  return path;
}

/** Form-encoded body with PHP-style brackets into nested objects (numeric keys stay object keys). */
function parseForm(raw: string): MonetizzeBody {
  const root: MonetizzeBody = Object.create(null) as MonetizzeBody;
  let fields = 0;
  for (const [key, value] of new URLSearchParams(raw)) {
    if (++fields > MAX_FIELDS) break;
    const path = keyPath(key);
    if (!path) continue;
    let node = root;
    for (const part of path.slice(0, -1)) {
      const next = asObject(node[part]);
      if (next) node = next;
      else {
        const created = Object.create(null) as MonetizzeBody;
        node[part] = created;
        node = created;
      }
    }
    node[path[path.length - 1]] = value;
  }
  return root;
}

export function readBody(rawBody: Buffer): MonetizzeBody {
  const raw = rawBody.toString('utf8').trim();
  if (!raw) throw new ConnectorDataError('Monetizze postback body is empty');
  if (raw.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConnectorDataError('Monetizze postback is not valid JSON');
    }
    const body = asObject(parsed);
    if (!body)
      throw new ConnectorDataError('Monetizze postback is not an object');
    return body;
  }
  return parseForm(raw);
}

export const section = (body: MonetizzeBody, key: string): MonetizzeBody =>
  asObject(body[key]) ?? {};

/** The postback "code" fields come as number or text ("2"); null when absent. */
export function codeOf(value: unknown): number | null {
  const raw = text(value);
  return raw !== null && /^\d{1,4}$/.test(raw) ? Number(raw) : null;
}

/** Reais as "97.00", 97, or Brazilian "1.457,00"; integer cents, null when unreadable. */
export function moneyCents(value: unknown): number | null {
  let raw = text(value);
  if (!raw) return null;
  raw = raw.replace(/\s|R\$/g, '');
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  if (comma > dot) raw = raw.replaceAll('.', '').replace(',', '.');
  else raw = raw.replaceAll(',', '');
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  return Math.round(Number(raw) * 100);
}

/** "yyyy-mm-dd H:i:s" in Brasilia time (documented format); ISO strings with an offset are accepted. */
export function brasiliaDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/.exec(raw);
  const parsed = new Date(
    local ? `${local[1]}T${local[2]}${local[3] ?? ':00'}-03:00` : raw,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * `cnpj_cpf` is documented as "integer, without dots": the leading zeros may be gone, so a 9-11 digit
 * value is a CPF and a 12-14 digit one a CNPJ, padded back. Anything else is left for the client.
 */
function taxIdOf(value: unknown): string | null {
  const digits = normalizeTaxID(text(value)) ?? '';
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length >= 9 && digits.length <= 11)
    return digits.padStart(11, '0');
  if (digits.length >= 12 && digits.length <= 14)
    return digits.padStart(14, '0');
  return null;
}

const BRAZIL = /^(br|bra|brasil|brazil)$/i;

function addressOf(buyer: MonetizzeBody): CustomerAddress | undefined {
  const street = [text(buyer.endereco), text(buyer.numero)]
    .filter(Boolean)
    .join(', ');
  const extra = [text(buyer.complemento), text(buyer.bairro)]
    .filter(Boolean)
    .join(' - ');
  const zipDigits = (text(buyer.cep) ?? '').replace(/\D/g, '');
  const city = text(buyer.cidade);
  const state = text(buyer.estado);
  const country = text(buyer.pais);
  const address: CustomerAddress = {
    ...(street ? { street: extra ? `${street} - ${extra}` : street } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(zipDigits ? { zip: zipDigits.padStart(8, '0').slice(0, 8) } : {}),
    ...(country ? { country } : {}),
  };
  return Object.keys(address).length > 0 ? address : undefined;
}

/** A tax ID counts only for a Brazilian buyer (or one with no country); a foreigner is completed by hand. */
export function readCustomer(body: MonetizzeBody): NormalizedCustomer | null {
  const buyer = asObject(body.comprador);
  if (!buyer) return null;
  const country = text(buyer.pais);
  const brazilian = !country || BRAZIL.test(country);
  const address = addressOf(buyer);
  return {
    name: text(buyer.nome),
    email: text(buyer.email),
    taxId: brazilian ? taxIdOf(buyer.cnpj_cpf) : null,
    taxIdMasked: false,
    ...(address ? { address } : {}),
  };
}
