import type { CompanyFiscalProfile, CompanyServiceTaxProfile, TaxRegime, TaxRegimeKind } from "./types";

export function fiscalToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function isSimpleNational(regime: TaxRegime | TaxRegimeKind): boolean {
  return regime === "MEI" || regime === "Simples Nacional" || regime === "SIMPLES_NACIONAL";
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
