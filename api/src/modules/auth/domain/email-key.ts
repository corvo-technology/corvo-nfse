const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Identity key for "same person" checks: lower-cased, `+tag` removed, and for
 * Gmail also dots removed and googlemail.com folded into gmail.com.
 * The SQL backfill in the FirstFreeNote migration mirrors this logic.
 */
export function normalizeEmailKey(email: string): string {
  const [rawLocal = '', rawDomain = ''] = email.trim().toLowerCase().split('@');
  let local = rawLocal.split('+')[0] ?? '';
  let domain = rawDomain;
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replaceAll('.', '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}
