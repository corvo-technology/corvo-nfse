import type { NfeContent } from '@/modules/nfe/domain/nfe-document';
import type { NfeItem } from '@/modules/nfe/domain/nfe-item';

/**
 * What an off-line NFC-e rejected by the SEFAZ may still change. It was handed to the consumer
 * already, so the number, the series, `cNF`, `dhEmi`, `tpEmis` and `dhCont` stay (the key is the
 * same) and so does everything that carries value or tax (decision 16 of the plan; the MOC rule for
 * the NF-e is "same number and series, no change to tax, recipient or issue date").
 */
const FREE_ITEM_FIELDS: ReadonlySet<keyof NfeItem> = new Set([
  'description',
  'gtin',
  'ncm',
  'cest',
  'unit',
]);

/** `10.0000000000` and `10` are the same amount: the database pads, the request does not. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

function canonical(value: unknown): string {
  if (typeof value === 'string' && DECIMAL.test(value))
    return JSON.stringify(
      value.includes('.') ? value.replace(/\.?0+$/, '') || '0' : value,
    );
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

const differs = (a: unknown, b: unknown): boolean =>
  canonical(a) !== canonical(b);

/** The fields of the body, apart from the items, that no correction may change. */
const LOCKED_FIELDS = [
  'natOp',
  'idDest',
  'indFinal',
  'indPres',
  'finNfe',
  'tpImp',
  'recipient',
  'totals',
  'payment',
  'externalId',
  'sendEmail',
] as const satisfies readonly (keyof NfeContent)[];

/**
 * The paths that changed outside `items[].description|gtin|ncm|cest|unit` and `additionalInfo`
 * (`items[0].unitPrice`, `recipient`, `payment`...). Empty when the correction is allowed.
 */
export function lockedFieldsChanged(
  before: NfeContent,
  after: NfeContent,
): string[] {
  const changed: string[] = [];
  for (const field of LOCKED_FIELDS)
    if (differs(before[field], after[field])) changed.push(field);
  if (before.items.length !== after.items.length) {
    changed.push('items');
    return changed;
  }
  before.items.forEach((item, index) => {
    for (const field of Object.keys(item) as Array<keyof NfeItem>)
      if (
        !FREE_ITEM_FIELDS.has(field) &&
        differs(item[field], after.items[index][field])
      )
        changed.push(`items[${index}].${field}`);
  });
  return changed;
}
