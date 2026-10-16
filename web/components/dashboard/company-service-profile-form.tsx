"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { companies } from "@/lib/api";
import { mapIssues } from "@/lib/api-errors";
import type { Company, CompanyServiceTaxProfile, ServiceTaxProfileInput, WithholdingTax } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { ServiceCodeCombobox } from "@/components/ui/service-code-combobox";
import { FISCAL_REGIMES } from "./company-fiscal-profile-form";

const RATE_KEYS: WithholdingTax[] = ["irrf", "pis", "cofins", "csll", "inss"];
const TEXT_FIELDS = ["name", "municipalServiceCode", "nbsCode", "cst", "classCode", "operationIndicator", "incidenceMunicipalityCode", "issRate", "effectiveFrom", "effectiveUntil", "classificationSource", "catalogVersion"] as const;
type TextField = (typeof TEXT_FIELDS)[number];
const asRate = (value: string) => value.trim().replace(",", ".");

export function CompanyServiceProfileForm({ company, profile, date, onSaved, onCancel }: {
  company: Company; profile: CompanyServiceTaxProfile | null; date: string;
  onSaved: (profile: CompanyServiceTaxProfile) => void; onCancel: () => void;
}) {
  const t = useTranslations("CompanyFiscal");
  const [values, setValues] = useState<Record<TextField, string>>(() => Object.fromEntries(TEXT_FIELDS.map(key => [key, profile?.[key] ?? (key === "effectiveFrom" ? date : key === "classificationSource" ? "manual" : "")])) as Record<TextField, string>);
  const [code, setCode] = useState(profile?.serviceCode ?? company.defaultServiceCode ?? "");
  const [operationNature, setOperationNature] = useState<CompanyServiceTaxProfile["operationNature"]>(profile?.operationNature ?? "SERVICE");
  const [issTaxation, setIssTaxation] = useState<CompanyServiceTaxProfile["issTaxation"]>(profile?.issTaxation ?? null);
  const [issWithholding, setIssWithholding] = useState(profile?.issWithholdingDefault ?? false);
  const [withholdingPolicy, setWithholdingPolicy] = useState<CompanyServiceTaxProfile["withholdingPolicy"]>(profile?.withholdingPolicy ?? "UNKNOWN");
  const [rates, setRates] = useState<Partial<Record<WithholdingTax, string>>>(profile?.withholdingRates ?? {});
  const [regimes, setRegimes] = useState(profile?.regimeApplicability ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const busy = useRef(false);
  const set = (key: TextField, value: string) => setValues(previous => ({ ...previous, [key]: value }));
  const field = (key: TextField, options: { type?: string; maxLength?: number; required?: boolean; inputMode?: "numeric" | "decimal" } = {}) => <Field key={key} label={t(key)} error={issues[key]} required={options.required}>{props => <input {...props} className="field" value={values[key]} {...options} onChange={event => set(key, event.target.value)} />}</Field>;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy.current) return;
    if (!values.name.trim() || !values.effectiveFrom) { setError(t("required")); return; }
    if (!/^\d{6}$/.test(code)) { setError(t("invalidCode")); return; }
    if (values.effectiveUntil && values.effectiveUntil <= values.effectiveFrom) { setError(t("invalidDate")); return; }
    if (values.incidenceMunicipalityCode && !/^\d{7}$/.test(values.incidenceMunicipalityCode)) { setError(t("invalidMunicipality")); return; }
    const withholdingRates = Object.fromEntries(RATE_KEYS.flatMap(key => rates[key]?.trim() ? [[key, asRate(rates[key] ?? "")]] : []));
    const percentages = [...Object.values(withholdingRates), ...(values.issRate.trim() ? [asRate(values.issRate)] : [])];
    if (percentages.some(value => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) { setError(t("invalidRate")); return; }
    if (withholdingPolicy === "CONFIGURED" && Object.keys(withholdingRates).length === 0) { setError(t("missingRates")); return; }
    const optional = (key: TextField) => values[key].trim() || null;
    const input: ServiceTaxProfileInput = {
      name: values.name.trim(), serviceCode: code, operationNature, municipalServiceCode: optional("municipalServiceCode"), nbsCode: optional("nbsCode"), cst: optional("cst"), classCode: optional("classCode"), operationIndicator: optional("operationIndicator"),
      incidenceMunicipalityCode: optional("incidenceMunicipalityCode"), issTaxation, issRate: values.issRate.trim() ? asRate(values.issRate) : null,
      issWithholdingDefault: issWithholding, withholdingPolicy, withholdingRates, regimeApplicability: regimes,
      effectiveFrom: values.effectiveFrom, effectiveUntil: optional("effectiveUntil"), classificationSource: values.classificationSource.trim() || "manual", catalogVersion: optional("catalogVersion"),
    };
    busy.current = true; setSaving(true); setError(null); setIssues({});
    try {
      const saved = profile ? await companies.updateServiceTaxProfile(company.id, profile.id, input) : await companies.createServiceTaxProfile(company.id, input);
      onSaved(saved);
    } catch (cause) {
      const mapping = Object.fromEntries([...TEXT_FIELDS, "serviceCode", "issTaxation", "withholdingPolicy", ...RATE_KEYS.map(key => `withholdingRates.${key}`)].map(key => [key, key]));
      setIssues(mapIssues(cause, mapping, (_code, fallback) => fallback));
      setError(cause instanceof Error ? cause.message : t("saveFailure"));
    } finally { busy.current = false; setSaving(false); }
  }
  return <form onSubmit={submit} className="flex flex-col gap-5 border-t border-border pt-5" aria-label={t("servicesTitle")} aria-busy={saving}>
    <p className="fiscal-notice">{t("classificationHint")}</p>
    <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
      {field("name", { required: true, maxLength: 120 })}
      <Field label={t("serviceCode")} required error={issues.serviceCode}>{props => <ServiceCodeCombobox {...props} value={code} onChange={setCode} />}</Field>
      {field("effectiveFrom", { required: true, type: "date" })}{field("effectiveUntil", { type: "date" })}
      <Field label={t("operationNature")}>{props => <select {...props} className="field" value={operationNature} onChange={event => setOperationNature(event.target.value as CompanyServiceTaxProfile["operationNature"])}>{(["SERVICE", "GOODS", "MIXED", "PARTNER_SALON"] as const).map(value => <option key={value} value={value}>{t(`operations.${value}`)}</option>)}</select>}</Field>
      {field("municipalServiceCode", { maxLength: 20 })}
      {field("nbsCode", { maxLength: 9, inputMode: "numeric" })}{field("cst", { maxLength: 3, inputMode: "numeric" })}
      {field("classCode", { maxLength: 6, inputMode: "numeric" })}{field("operationIndicator", { maxLength: 6, inputMode: "numeric" })}
      <Field label={t("issTaxation")} error={issues.issTaxation}>{props => <select {...props} className="field" value={issTaxation ?? ""} onChange={event => setIssTaxation((event.target.value || null) as CompanyServiceTaxProfile["issTaxation"])}><option value="">{t("missing")}</option>{(["NORMAL", "FIXED", "EXEMPT"] as const).map(value => <option key={value} value={value}>{t(`iss.${value}`)}</option>)}</select>}</Field>
      {field("issRate", { maxLength: 10, inputMode: "decimal" })}
      {field("incidenceMunicipalityCode", { maxLength: 7, inputMode: "numeric" })}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={issWithholding} onChange={event => setIssWithholding(event.target.checked)} />{t("issWithholdingDefault")}</label>
      <Field label={t("withholdingPolicy")} error={issues.withholdingPolicy}>{props => <select {...props} className="field" value={withholdingPolicy} onChange={event => setWithholdingPolicy(event.target.value as CompanyServiceTaxProfile["withholdingPolicy"])}>{(["UNKNOWN", "NONE_CONFIRMED", "CONFIGURED"] as const).map(value => <option key={value} value={value}>{t(`withholding.${value}`)}</option>)}</select>}</Field>
      {withholdingPolicy === "CONFIGURED" && <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3"><legend className="mb-3 text-sm">{t("withholdingRates")}</legend>{RATE_KEYS.map(key => <Field key={key} label={`${key.toUpperCase()} (%)`} error={issues[`withholdingRates.${key}`]}>{props => <input {...props} className="field" inputMode="decimal" maxLength={10} value={rates[key] ?? ""} onChange={event => setRates(previous => ({ ...previous, [key]: event.target.value }))} />}</Field>)}</fieldset>}
      <Field label={t("regimeApplicability")} hint={t("allRegimes")}>{props => <select {...props} className="field min-h-28" multiple value={regimes} onChange={event => setRegimes(Array.from(event.target.selectedOptions, option => option.value as CompanyServiceTaxProfile["regimeApplicability"][number]))}>{FISCAL_REGIMES.map(value => <option key={value} value={value}>{t(`regimes.${value}`)}</option>)}</select>}</Field>
    </fieldset>
    <details><summary className="cursor-pointer py-2 text-sm underline">{t("advanced")}</summary><fieldset disabled={saving} className="mt-3 grid gap-4 sm:grid-cols-2">{field("classificationSource", { maxLength: 30 })}{field("catalogVersion", { maxLength: 40 })}</fieldset></details>
    {error && <p role="alert" className="fiscal-notice">{error}</p>}
    <div className="flex flex-wrap justify-end gap-3"><Button disabled={saving} onClick={onCancel}>{t("cancel")}</Button><Button type="submit" variant="accent" loading={saving}>{t("saveService")}</Button></div>
  </form>;
}
