import { Decimal } from '@/shared/types/money';

/** Money in whole cents: sums and comparisons never touch a float. */
export interface NfeItemAmounts {
  vProd: number;
  vDesc: number;
  vFrete: number;
  vSeg: number;
  vOutro: number;
}

export interface NfeTotals {
  vProd: number;
  vDesc: number;
  vFrete: number;
  vSeg: number;
  vOutro: number;
  vNF: number;
  items: NfeItemAmounts[];
}

export interface TotalsItem {
  quantity: number | string;
  unitPrice: number | string;
  discount?: number | string;
  freight?: number | string;
  insurance?: number | string;
  other?: number | string;
}

const dec = (value: number | string | undefined): Decimal =>
  new Decimal(value ?? 0);

/** Rounds half up (away from zero for positives) to whole cents. */
export function toCents(value: number | string | Decimal): number {
  return new Decimal(value)
    .times(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function centsToString(cents: number): string {
  return new Decimal(cents).dividedBy(100).toFixed(2);
}

/** `vProd` of an item is `quantity x unitPrice` rounded half up to 2 places. */
export function itemAmounts(item: TotalsItem): NfeItemAmounts {
  return {
    vProd: toCents(dec(item.quantity).times(dec(item.unitPrice))),
    vDesc: toCents(dec(item.discount)),
    vFrete: toCents(dec(item.freight)),
    vSeg: toCents(dec(item.insurance)),
    vOutro: toCents(dec(item.other)),
  };
}

/** The totals are the sum of the already rounded items; the customer never sends them. */
export function computeTotals(items: TotalsItem[]): NfeTotals {
  const amounts = items.map(itemAmounts);
  const sum = (pick: (a: NfeItemAmounts) => number): number =>
    amounts.reduce((total, a) => total + pick(a), 0);
  const vProd = sum((a) => a.vProd);
  const vDesc = sum((a) => a.vDesc);
  const vFrete = sum((a) => a.vFrete);
  const vSeg = sum((a) => a.vSeg);
  const vOutro = sum((a) => a.vOutro);
  return {
    vProd,
    vDesc,
    vFrete,
    vSeg,
    vOutro,
    vNF: vProd - vDesc + vFrete + vSeg + vOutro,
    items: amounts,
  };
}
