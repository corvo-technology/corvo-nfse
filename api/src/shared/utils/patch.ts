export function omitUndefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(
      ([, value]) => value !== undefined,
    ),
  ) as Partial<T>;
}

export function omitNullish<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  ) as Partial<T>;
}
