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
/**
 * How a ME/EPP apportions its federal and municipal taxes (DPS `regApTribSN`):
 * SN = 1 (all through the Simples), ISS_MUNICIPAL = 2 and REGULAR = 3 (above a
 * sublimit). Only SN is supported today.
 */
export const SIMPLES_APURACAO = ['SN', 'ISS_MUNICIPAL', 'REGULAR'] as const;
export type SimplesApuracao = (typeof SIMPLES_APURACAO)[number];

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
  /** ME/EPP only; absent or null means SN. Never set for MEI. */
  simplesApuracao?: SimplesApuracao | null;
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

/**
 * The profiles that apply on `date`. The first profile also applies backwards:
 * a company only gets its first profile when it is registered, but it existed
 * (and can issue invoices) before. A date inside a gap of the history gets
 * none, and overlapping profiles are all returned so the caller can refuse them.
 */
export function effectiveProfilesOn<
  T extends Pick<CompanyFiscalProfile, 'validFrom' | 'validUntil'>,
>(profiles: T[], date: string): T[] {
  const covering = profiles.filter((profile) => isEffectiveOn(profile, date));
  if (covering.length > 0 || profiles.length === 0) return covering;
  const first = profiles.reduce((a, b) => (b.validFrom < a.validFrom ? b : a));
  return date < first.validFrom ? [first] : [];
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

/** DPS `regApTribSN`: required for ME/EPP (E0166), forbidden for MEI and others (E0162). */
export function regApTribSNFor(
  profile: Pick<CompanyFiscalProfile, 'taxRegime' | 'simplesApuracao'>,
): 1 | 2 | 3 | null {
  if (profile.taxRegime !== 'SIMPLES_NACIONAL') return null;
  switch (profile.simplesApuracao ?? 'SN') {
    case 'ISS_MUNICIPAL':
      return 2;
    case 'REGULAR':
      return 3;
    default:
      return 1;
  }
}
