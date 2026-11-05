/** One-off notes: R$ 0,99 each, at least 3 per purchase, never expire. */
export const AVULSO_UNIT_CENTS = 99;
export const AVULSO_MIN_UNITS = 3;

export function assertAvulsoUnits(units: number): void {
  if (!Number.isInteger(units) || units < AVULSO_MIN_UNITS) {
    throw new Error(
      `Minimum avulso purchase is ${AVULSO_MIN_UNITS} whole notes`,
    );
  }
}
