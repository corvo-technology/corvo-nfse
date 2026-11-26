import type { NfeSettings } from '@/modules/company/domain/nfe-settings';
import type { NfeItemTax } from './nfe-item';
import type { NfeItemInput } from './nfe-input';

export type TaxDefaults = Pick<
  NfeSettings,
  'defaultOrigin' | 'defaultCsosn' | 'defaultPisCst' | 'defaultCofinsCst'
>;

/**
 * Fills what the customer left out with the Simples defaults of the company (ICMSSN102 with the
 * CSOSN, PISOutr/COFINSOutr with CST 49). An item can override any of the four.
 */
export function applyTaxDefaults(
  items: Pick<NfeItemInput, 'tax'>[],
  settings: TaxDefaults,
): NfeItemTax[] {
  return items.map((item) => ({
    origin: item.tax?.origin ?? settings.defaultOrigin,
    csosn: item.tax?.csosn ?? settings.defaultCsosn,
    pisCst: item.tax?.pisCst ?? settings.defaultPisCst,
    cofinsCst: item.tax?.cofinsCst ?? settings.defaultCofinsCst,
  }));
}

/** 1 when the recipient is in the issuer's UF, otherwise 2 (interstate). */
export function deriveIdDest(
  issuerUf: string,
  recipientUf: string,
): 1 | 2 {
  return issuerUf.toUpperCase() === recipientUf.toUpperCase() ? 1 : 2;
}
