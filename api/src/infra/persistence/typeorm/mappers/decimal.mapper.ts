import { Decimal } from '@/shared/types/money';

export function decimalFromDb(value: string | number | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export function decimalToDb(value: Decimal): string {
  return value.toFixed();
}

export function optionalDecimalFromDb(
  value: string | number | Decimal | null,
): Decimal | undefined {
  return value === null ? undefined : decimalFromDb(value);
}

export function optionalDecimalToDb(value: Decimal | undefined): string | null {
  return value ? decimalToDb(value) : null;
}
