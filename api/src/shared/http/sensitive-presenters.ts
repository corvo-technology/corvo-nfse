export function maskTaxID(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[.\s/-]/g, '');
  if (!cleaned) return null;
  if (cleaned.length <= 4) return '*'.repeat(cleaned.length);
  return `${'*'.repeat(cleaned.length - 4)}${cleaned.slice(-4)}`;
}

export function maskPixKey(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    const [local, domain] = trimmed.split('@');
    const visibleLocal = local.slice(0, 2);
    return `${visibleLocal}${'*'.repeat(Math.max(3, local.length - 2))}@${domain}`;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 6) {
    return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
  }

  if (trimmed.length <= 8) return `${trimmed.slice(0, 1)}***`;
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}
