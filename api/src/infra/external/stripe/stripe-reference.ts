export function stripeId(
  value: string | { id: string } | null | undefined,
): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null);
}
