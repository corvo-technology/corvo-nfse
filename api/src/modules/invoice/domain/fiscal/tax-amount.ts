import type { DecimalString } from './money';

export interface TaxAmount {
  readonly base: DecimalString;
  readonly rate?: DecimalString;
  readonly effectiveRate?: DecimalString;
  readonly reductionRate?: DecimalString;
  readonly amount: DecimalString;
}
