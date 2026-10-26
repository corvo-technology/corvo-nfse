import { TaxRegimeNotSupportedError } from './errors';
import type { TaxRegimeKind } from './fiscal-profile';

const SUPPORTED: readonly TaxRegimeKind[] = ['MEI', 'SIMPLES_NACIONAL'];

/**
 * Only MEI and Simples Nacional are accepted; any other regime is refused.
 */
export function assertRegimeSupported(regime: TaxRegimeKind): void {
  if (!SUPPORTED.includes(regime)) throw new TaxRegimeNotSupportedError(regime);
}
