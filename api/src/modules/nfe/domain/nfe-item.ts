/** Tax groups of one item: ICMSSN102 (CSOSN) and PISOutr/COFINSOutr (CST). Nothing is calculated. */
export interface NfeItemTax {
  origin: number;
  csosn: string;
  pisCst: string;
  cofinsCst: string;
}

/**
 * One stored item. Decimals are strings exactly as the database returns them, so they never go
 * through a float; `total` is `vProd` of the item, already rounded to 2 places.
 */
export interface NfeItem {
  nItem: number;
  code: string;
  gtin: string | null;
  description: string;
  ncm: string;
  cest: string | null;
  cfop: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  total: string;
  discount: string;
  freight: string;
  insurance: string;
  other: string;
  tax: NfeItemTax;
  ibsCbs: Record<string, unknown> | null;
}
