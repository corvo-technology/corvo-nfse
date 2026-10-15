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
