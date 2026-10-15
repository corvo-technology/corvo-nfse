import type { NFSe } from 'open-nfse';
import type { FiscalCalculationResult } from '../fiscal-calculation-result';
import { Decimal, toDecimal } from '../money';

export type ReconciliationStatus = 'matched' | 'within_tolerance' | 'divergent';

export interface ReconciliationDifference {
  readonly field: string;
  readonly local: string | null;
  readonly authorized: string | null;
  readonly delta: string | null;
  readonly kind: 'amount' | 'missing_in_authorized' | 'missing_locally';
}

export interface ReconciliationOutcome {
  readonly status: ReconciliationStatus;
  readonly differences: readonly ReconciliationDifference[];
  readonly localValues: Readonly<Record<string, string | null>>;
  readonly authorizedValues: Readonly<Record<string, string | null>>;
  readonly toleranceAbsolute: string;
}

interface ComparedField {
  readonly field: string;
  readonly local: string | null;
  /** SDK numbers stay as numbers until the Decimal conversion below. */
  readonly authorized: number | null;
}

const SEVERITY: Record<ReconciliationStatus, number> = {
  matched: 0,
  within_tolerance: 1,
  divergent: 2,
} as const;

const worst = (a: ReconciliationStatus, b: ReconciliationStatus): ReconciliationStatus =>
  SEVERITY[b] > SEVERITY[a] ? b : a;

/**
 * Reconciles the fiscal engine's immutable snapshot against the values the
 * Sefin consolidated in the authorized NFS-e. Pure comparison — it never
 * mutates either side; `net_value` (vLiq) is recorded but not compared.
 */
export function reconcile(
  local: FiscalCalculationResult,
  authorized: NFSe,
  toleranceAbsolute: Decimal,
): ReconciliationOutcome {
  const valores = authorized.infNFSe.valores;
  const ibscbs = authorized.infNFSe.IBSCBS;
  const gIbs = ibscbs?.totCIBS.gIBS;

  const fields: readonly ComparedField[] = [
    {
      field: 'iss',
      local: local.taxes.iss?.amount ?? null,
      authorized: valores.vISSQN ?? null,
    },
    {
      field: 'iss_base',
      local: local.taxes.iss?.base ?? null,
      authorized: valores.vBC ?? null,
    },
    {
      field: 'cbs',
      local: local.taxes.cbs?.amount ?? null,
      authorized: ibscbs?.totCIBS.gCBS.vCBS ?? null,
    },
    {
      field: 'ibs_total',
      local: local.taxes.ibsTotal?.amount ?? null,
      authorized: gIbs?.vIBSTot ?? null,
    },
    {
      field: 'ibs_state',
      local: local.taxes.ibsState?.amount ?? null,
      authorized: gIbs?.gIBSUFTot.vIBSUF ?? null,
    },
    {
      field: 'ibs_city',
      local: local.taxes.ibsCity?.amount ?? null,
      authorized: gIbs?.gIBSMunTot.vIBSMun ?? null,
    },
    {
      field: 'ibs_cbs_base',
      local: local.taxableAmounts.ibsCbs ?? null,
      authorized: ibscbs?.valores.vBC ?? null,
    },
  ];

  const differences: ReconciliationDifference[] = [];
  const localValues: Record<string, string | null> = {};
  const authorizedValues: Record<string, string | null> = {};
  let status: ReconciliationStatus = 'matched';

  for (const { field, local: localAmount, authorized: authorizedAmount } of fields) {
    const authorizedString =
      authorizedAmount === null ? null : new Decimal(String(authorizedAmount)).toString();
    localValues[field] = localAmount;
    authorizedValues[field] = authorizedString;
    if (localAmount === null && authorizedString === null) continue;
    if (localAmount === null || authorizedString === null) {
      differences.push({
        field,
        local: localAmount,
        authorized: authorizedString,
        delta: null,
        kind: localAmount === null ? 'missing_locally' : 'missing_in_authorized',
      });
      status = worst(status, 'divergent');
      continue;
    }
    const delta = toDecimal(authorizedString).sub(toDecimal(localAmount));
    if (delta.isZero()) continue;
    differences.push({
      field,
      local: localAmount,
      authorized: authorizedString,
      delta: delta.toFixed(2),
      kind: 'amount',
    });
    status = worst(
      status,
      delta.abs().lte(toleranceAbsolute) ? 'within_tolerance' : 'divergent',
    );
  }

  localValues.net_value = local.netReceivableAmount;
  authorizedValues.net_value = new Decimal(String(valores.vLiq)).toString();

  return {
    status,
    differences,
    localValues,
    authorizedValues,
    toleranceAbsolute: toleranceAbsolute.toString(),
  };
}
