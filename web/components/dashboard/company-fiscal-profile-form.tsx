"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { companies } from "@/lib/api";
import { mapIssues } from "@/lib/api-errors";
import { fiscalToday, isSimpleNational, regimeKind, SPECIAL_TAX_REGIME_CODES } from "@/lib/company-fiscal";
import type { Company, CompanyFiscalProfile, TaxRegimeKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";

export const FISCAL_REGIMES: TaxRegimeKind[] = ["MEI", "SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL", "OUTRO_REGIME"];
function nextDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function CompanyFiscalProfileForm({ company, profile, onSaved, onCancel }: {
  company: Company; profile: CompanyFiscalProfile | null; onSaved: (profile: CompanyFiscalProfile) => void; onCancel: () => void;
}) {
  const t = useTranslations("CompanyFiscal");
  const approved = profile?.reviewStatus === "approved";
  const minDate = approved && profile ? nextDate(profile.validFrom) : profile?.validFrom;
  const [regime, setRegime] = useState<TaxRegimeKind | "">(profile?.taxRegime ?? (company.taxRegime ? regimeKind(company.taxRegime) : ""));
  const [validFrom, setValidFrom] = useState(approved ? [fiscalToday(), minDate ?? ""].sort().at(-1) ?? fiscalToday() : profile?.validFrom ?? fiscalToday());
  const [specialTaxRegime, setSpecialTaxRegime] = useState(profile?.specialTaxRegime ?? "0");
  const [ibsOption, setIbsOption] = useState(profile?.ibsCbsRegularOption ?? false);
  const [ibsFrom, setIbsFrom] = useState(profile?.ibsCbsRegularFrom ?? "");
  const simple = regime !== "" && isSimpleNational(regime);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const busy = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (!regime) { setIssues({ taxRegime: t("required") }); return; }
    if (!validFrom || (minDate && validFrom < minDate)) { setError(t("invalidDate")); return; }
    busy.current = true; setSaving(true); setError(null); setIssues({});
    try {
      const result = await companies.saveFiscalProfile(company.id, {
        taxRegime: regime, simpleNational: simple, specialTaxRegime: specialTaxRegime === "0" ? null : specialTaxRegime,
        validFrom, ibsCbsRegularOption: simple && ibsOption,
        ibsCbsRegularFrom: simple && ibsOption ? ibsFrom || null : null,
        confirm: false,
      });
      onSaved(result);
    } catch (cause) {
      setIssues(mapIssues(cause, { taxRegime: "taxRegime", validFrom: "validFrom", specialTaxRegime: "specialTaxRegime", ibsCbsRegularFrom: "ibsCbsRegularFrom" }, (_code, fallback) => fallback));
      setError(cause instanceof Error ? cause.message : t("saveFailure"));
    } finally { busy.current = false; setSaving(false); }
  }
  return <form onSubmit={submit} className="flex flex-col gap-4 border-t border-border pt-5" aria-label={t("profileTitle")} aria-busy={saving}>
    {approved && <p className="fiscal-notice">{t("immutableProfile")}</p>}
    <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
      <Field label={t("regime")} required error={issues.taxRegime}>{props => <select {...props} className="field" value={regime} onChange={event => setRegime(event.target.value as TaxRegimeKind)}><option value="" disabled>{t("missing")}</option>{(regime === "UNKNOWN" ? [...FISCAL_REGIMES, "UNKNOWN" as const] : FISCAL_REGIMES).map(value => <option key={value} value={value}>{t(`regimes.${value}`)}</option>)}</select>}</Field>
      <Field label={t("validFrom")} required error={issues.validFrom}>{props => <input {...props} className="field" type="date" required min={minDate} value={validFrom} onChange={event => setValidFrom(event.target.value)} />}</Field>
      <Field label={t("specialRegime")} error={issues.specialTaxRegime}>{props => <select {...props} className="field" value={specialTaxRegime} onChange={event => setSpecialTaxRegime(event.target.value)}>{SPECIAL_TAX_REGIME_CODES.map(value => <option key={value} value={value}>{t(`specialRegimes.${value}`)}</option>)}</select>}</Field>
      <p className="self-end py-2 text-sm">{t("simpleNational")}: {t(simple ? "yes" : "no")}</p>
      {simple && <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ibsOption} onChange={event => setIbsOption(event.target.checked)} />{t("ibsOption")}</label>{ibsOption && <Field label={t("ibsFrom")} required error={issues.ibsCbsRegularFrom}>{props => <input {...props} type="date" required className="field" value={ibsFrom} onChange={event => setIbsFrom(event.target.value)} />}</Field>}</>}
    </fieldset>
    {error && <p role="alert" className="fiscal-notice">{error}</p>}
    <div className="flex flex-wrap justify-end gap-3"><Button disabled={saving} onClick={onCancel}>{t("cancel")}</Button><Button type="submit" variant="accent" loading={saving}>{t("saveProfile")}</Button></div>
  </form>;
}
