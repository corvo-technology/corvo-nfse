import type { CompanyFiscalProfile, CompanyServiceTaxProfile, TaxRegime, TaxRegimeKind } from "./types";

/** `regEspTrib` codes (RTC v1.01 `TSRegEspTrib`) the API accepts; keep in sync with the API's SPECIAL_TAX_REGIME_CODES. */
export const SPECIAL_TAX_REGIME_CODES = ["0", "1", "2", "3", "4", "5", "6"] as const;
export type SpecialTaxRegimeCode = (typeof SPECIAL_TAX_REGIME_CODES)[number];

export function fiscalToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function isSimpleNational(regime: TaxRegime | TaxRegimeKind): boolean {
  return regime === "MEI" || regime === "Simples Nacional" || regime === "SIMPLES_NACIONAL";
}
/** MEI and Simples Nacional always send regEspTrib=0 (E0174/E0175), so the choice is only offered to the other regimes. */
export function allowsSpecialTaxRegime(regime: TaxRegime | TaxRegimeKind | ""): boolean {
  return regime !== "" && !isSimpleNational(regime);
}
export function regimeKind(regime: TaxRegime): TaxRegimeKind {
  const kinds: Record<TaxRegime, TaxRegimeKind> = { MEI: "MEI", "Simples Nacional": "SIMPLES_NACIONAL", "Lucro Presumido": "LUCRO_PRESUMIDO", "Lucro Real": "LUCRO_REAL" };
  return kinds[regime];
}
export function effectiveFiscalProfiles(profiles: CompanyFiscalProfile[], date: string): CompanyFiscalProfile[] {
  return profiles.filter((profile) => profile.validFrom <= date && (profile.validUntil === null || date < profile.validUntil));
}
export function resolveServiceState(services: CompanyServiceTaxProfile[], code: string, date: string, regime: TaxRegimeKind): "missing" | "unreviewed" | "rejected" | "approved" | "ambiguous" {
  const matches = services.filter((service) => service.serviceCode === code && service.effectiveFrom <= date && (service.effectiveUntil === null || date < service.effectiveUntil) && (service.regimeApplicability.length === 0 || service.regimeApplicability.includes(regime)));
  if (matches.length > 1) return "ambiguous";
  return matches[0]?.reviewStatus ?? "missing";
}

/** Corvo serves only these regimes; the form offers nothing else. */
export const SUPPORTED_TAX_REGIMES: readonly TaxRegime[] = ["MEI", "Simples Nacional"];

/** Current competence month (YYYY-MM) in the fiscal timezone. */
export function fiscalMonth(now = new Date()): string {
  return fiscalToday(now).slice(0, 7);
}
const monthNumber = (month: string): number => { const [year, mon] = month.split("-").map(Number); return year * 12 + mon; };
/** A Simples rate is stale when the latest informed month is more than one month behind. */
export function isSimplesRateStale(latestMonth: string, currentMonth: string): boolean {
  return monthNumber(currentMonth) - monthNumber(latestMonth) > 1;
}
/** Null when valid; otherwise the reason key. A percentage from 0 to 100 with at most two decimals. */
export function simplesRateError(value: string): "invalid" | "range" | "decimals" | null {
  const text = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return "invalid";
  if (Number(text) < 0 || Number(text) > 100) return "range";
  if ((text.split(".")[1]?.length ?? 0) > 2) return "decimals";
  return null;
}
