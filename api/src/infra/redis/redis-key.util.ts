export function buildRedisKey(
  keyPrefix: string,
  namespace: string,
  key: string,
): string {
  return `${keyPrefix}:${namespace}:${key}`;
}

export function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}
