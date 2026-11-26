import { createHash } from 'node:crypto';

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
};

/** SHA-256 of the body with its keys sorted: the same request always has the same hash. */
export function nfeRequestHash(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(body)))
    .digest('hex');
}

/** `Idempotency-Key`: 1 to 200 characters. */
export function isValidIdempotencyKey(key: string): boolean {
  return key.length >= 1 && key.length <= 200;
}
