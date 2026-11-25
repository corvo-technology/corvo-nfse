import type { AuditMetadata } from './account-audit';

const SECRET_KEY =
  /pass|secret|token|pfx|private|authorization|cookie|api_?key|cert(ificate)?_?(file|data)/i;
const MAX_KEYS = 20;
const MAX_STRING = 200;

function safeValue(
  value: unknown,
): string | number | boolean | null | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, MAX_STRING);
  return undefined;
}

/** Audit metadata never holds secrets: primitives only, risky keys dropped, size capped. */
export function sanitizeAuditMetadata(input: unknown): AuditMetadata {
  const out: AuditMetadata = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (SECRET_KEY.test(key)) continue;
    const safe = safeValue(value);
    if (safe !== undefined) out[key] = safe;
  }
  return out;
}
