import type { TaxRegime } from './company';

export const TAX_REGIME_KINDS = [
  'MEI',
  'SIMPLES_NACIONAL',
  'LUCRO_PRESUMIDO',
  'LUCRO_REAL',
  'OUTRO_REGIME',
  'UNKNOWN',
] as const;
export type TaxRegimeKind = (typeof TAX_REGIME_KINDS)[number];

/**
 * `regEspTrib` codes (RTC v1.01 `TSRegEspTrib`) this engine maps today: 0
 * Nenhum, 1 Ato Cooperado, 2 Estimativa, 3 Microempresa Municipal, 4 Notário
 * ou Registrador, 5 Profissional Autônomo, 6 Sociedade de Profissionais. "9
 * Outros" also exists in the layout but is free-text and not modelled.
 */
export const SPECIAL_TAX_REGIME_CODES = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
] as const;
export type SpecialTaxRegimeCode = (typeof SPECIAL_TAX_REGIME_CODES)[number];
export type ProfileReviewStatus = 'unreviewed' | 'approved' | 'rejected';

export interface CompanyFiscalProfile {
  id: string;
  tenantId: string;
  companyId: string;
  taxRegime: TaxRegimeKind;
  simpleNational: boolean;
  specialTaxRegime: string | null;
  ibsCbsRegularOption: boolean;
  ibsCbsRegularFrom: string | null; // YYYY-MM-DD
  /**
   * Effective ISS rate (%) of the Simples Nacional bracket of the previous
   * month (LC 123/2006, art. 21, §4º, I). Required to withhold ISS for
   * Simples Nacional ME/EPP.
   */
  simplesIssRate: string | null;
  validFrom: string; // YYYY-MM-DD, inclusive
  validUntil: string | null; // exclusive; null = open
  source: string;
  reviewStatus: ProfileReviewStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export function isEffectiveOn(
  profile: Pick<CompanyFiscalProfile, 'validFrom' | 'validUntil'>,
  date: string,
): boolean {
  return (
    profile.validFrom <= date &&
    (profile.validUntil === null || date < profile.validUntil)
  );
}

const LEGACY_TO_KIND: Record<TaxRegime, TaxRegimeKind> = {
  MEI: 'MEI',
  'Simples Nacional': 'SIMPLES_NACIONAL',
  'Lucro Presumido': 'LUCRO_PRESUMIDO',
  'Lucro Real': 'LUCRO_REAL',
};

export const regimeKindFromLegacy = (legacy: TaxRegime): TaxRegimeKind =>
  LEGACY_TO_KIND[legacy];

export function legacyFromRegimeKind(kind: TaxRegimeKind): TaxRegime | null {
  const entry = Object.entries(LEGACY_TO_KIND).find(
    ([, value]) => value === kind,
  );
  return entry ? (entry[0] as TaxRegime) : null;
}
