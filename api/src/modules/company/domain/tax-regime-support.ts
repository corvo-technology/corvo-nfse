import type { RolloutFlagsService } from '@/shared/rollout/rollout-flags.service';
import { TaxRegimeNotSupportedError } from './errors';
import type { TaxRegimeKind } from './fiscal-profile';

const SUPPORTED: readonly TaxRegimeKind[] = ['MEI', 'SIMPLES_NACIONAL'];

/**
 * With `TAX_REGIME_RESTRICTION` on for the tenant only MEI and Simples
 * Nacional are accepted. Without flags (or with the flag off) nothing is refused.
 */
export function assertRegimeSupported(
  flags: RolloutFlagsService | undefined,
  tenantId: string,
  regime: TaxRegimeKind,
): void {
  if (!flags?.isOn('TAX_REGIME_RESTRICTION', tenantId)) return;
  if (!SUPPORTED.includes(regime)) throw new TaxRegimeNotSupportedError(regime);
}
