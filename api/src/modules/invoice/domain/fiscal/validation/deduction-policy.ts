import type { TaxRegimeKind } from '@/modules/company/domain/fiscal-profile';
import { DEDUCTION_ALLOWED_CTRIBNAC } from '../dps/anexo1-rules';

export type DeductionDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Whether the issuer may declare a deduction from the ISS base (`vDedRed`).
 * Anexo I – SEFIN/ADN – DPS NFS-e v1.01: E0436 forbids it to the MEI;
 * E0441/E0442 forbid it to ME/EPP that apportion the ISS by the Simples
 * (`regApTribSN = 1`) outside the listed national service codes. The Sefin also
 * checks the municipal parameters: being on the list is necessary, not sufficient.
 */
export function deductionAllowed(input: {
  taxRegime: TaxRegimeKind;
  cTribNac: string;
  regApTribSN: 1 | 2 | 3 | null;
}): DeductionDecision {
  if (input.taxRegime === 'MEI')
    return {
      allowed: false,
      reason: 'MEI cannot declare a deduction from the ISS base (E0436)',
    };
  if (
    input.taxRegime === 'SIMPLES_NACIONAL' &&
    input.regApTribSN === 1 &&
    !DEDUCTION_ALLOWED_CTRIBNAC.has(input.cTribNac)
  )
    return {
      allowed: false,
      reason: `Simples Nacional cannot declare a deduction for service code ${input.cTribNac} (E0441/E0442)`,
    };
  return { allowed: true };
}
