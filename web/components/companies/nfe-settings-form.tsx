"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import { fieldIssues, errorCodeKey } from "@/lib/api-errors";
import { getNfeSettings, updateNfeSettings, type NfeSettings } from "@/lib/nfe";
import { ieExample } from "@/lib/nfe-form";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

interface NfeSettingsFormProps {
  companyId: string;
  /** State (UF) of the company, to show an IE example. */
  state?: string;
  /** Can the member change the settings (`nfe.documents.manage`)? */
  canManage: boolean;
}

/** The NF-e data of a company: state registration (IE), tax regime (CRT), series and the Simples defaults. */
export function NfeSettingsForm({ companyId, state: uf = "", canManage }: NfeSettingsFormProps) {
  const t = useTranslations("Nfe.settings");
  const apiError = useApiErrorText();
  const [settings, setSettings] = useState<NfeSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stateRegistration, setStateRegistration] = useState("");
  const [series, setSeries] = useState("1");
  const [natOp, setNatOp] = useState("");
  const [csosn, setCsosn] = useState<"102" | "400">("102");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ieError, setIeError] = useState<string | null>(null);

  function fill(value: NfeSettings) {
    setSettings(value);
    setStateRegistration(value.stateRegistration ?? "");
    setSeries(String(value.defaultSeries));
    setNatOp(value.defaultNatOp);
    setCsosn(value.defaultCsosn === "400" ? "400" : "102");
  }

  useEffect(() => {
    const abort = new AbortController();
    getNfeSettings(companyId, abort.signal)
      .then((value) => { if (!abort.signal.aborted) { fill(value); setLoadError(null); } })
      .catch((cause) => { if (!abort.signal.aborted) setLoadError(apiError(cause, t("loadFailed"))); });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apiError changes identity with the messages, not with the data
  }, [companyId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setSaved(false); setError(null); setIeError(null);
    try {
      fill(await updateNfeSettings(companyId, { stateRegistration: stateRegistration.trim(), defaultSeries: Number(series), defaultNatOp: natOp.trim() || undefined, defaultCsosn: csosn }));
      setSaved(true);
    } catch (cause) {
      const text = apiError(cause, t("saveFailed"));
      const invalidIe = cause instanceof ApiError && (cause.code ? errorCodeKey(cause.code) === "state_registration_invalid" : false);
      const ieIssue = fieldIssues(cause).some((issue) => issue.field.includes("stateRegistration") || issue.field === "state_registration");
      if (invalidIe || ieIssue) setIeError(text); else setError(text);
    } finally { setSaving(false); }
  }

  if (loadError) return <p role="alert" className="banner banner-danger">{loadError}</p>;
  if (!settings) return <p className="text-sm text-text-3" role="status">{t("loading")}</p>;
  const missing = settings.missing;
  // The CRT is not asked: it follows the tax regime of the company (Simples Nacional is 1, MEI is 4).
  const regime = settings.taxRegime === "MEI" ? "mei" : settings.taxRegime === "Simples Nacional" ? "simples" : null;
  return (
    <Card className="flex flex-col gap-4 p-5" aria-labelledby="nfe-settings-title">
      <div>
        <h2 id="nfe-settings-title" className="text-base font-medium">{t("title")}</h2>
        <p className="mt-0.5 text-[13px] text-text-3">{t("subtitle")}</p>
      </div>
      {missing.length === 0 ? (
        <p className="banner banner-ok"><Check size={16} aria-hidden className="mt-0.5 flex-none text-accent" />{t("ready")}</p>
      ) : (
        <div role="status" className="banner banner-warn flex flex-col gap-1">
          <p>{t("missingTitle")}</p>
          <ul className="list-disc pl-5">{missing.map((field) => <li key={field}>{t.has(`missing.${field}`) ? t(`missing.${field}`) : field}</li>)}</ul>
        </div>
      )}
      <form noValidate onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label={t("stateRegistration")} hint={t("stateRegistrationHint")} error={ieError ?? undefined} required>
          {(control) => <Input {...control} value={stateRegistration} disabled={!canManage} inputMode="numeric" autoComplete="off" placeholder={t("stateRegistrationPlaceholder", { example: ieExample(uf) })} onChange={(event) => setStateRegistration(event.target.value)} />}
        </Field>
        <div className="flex flex-col gap-1.5" data-testid="nfe-regime">
          <span className="field-label">{t("crt")}</span>
          {regime ? <p className="field text-text-2">{t(regime === "mei" ? "crt4" : "crt1")}</p> : <p role="status" className="banner banner-warn">{t("crtUnsupported")}</p>}
          <p className="field-hint">{t("crtFollows")} <Link href={`/app/companies/${companyId}#fiscal`} className="underline">{t("crtEdit")}</Link></p>
        </div>
        <Field label={t("series")} hint={t("seriesHint")}>
          {(control) => <Input {...control} type="number" min={0} max={999} placeholder="1" value={series} disabled={!canManage} onChange={(event) => setSeries(event.target.value)} />}
        </Field>
        <Field label={t("natOp")} hint={t("natOpHint")}>
          {(control) => <Input {...control} maxLength={60} placeholder={t("natOpPlaceholder")} value={natOp} disabled={!canManage} onChange={(event) => setNatOp(event.target.value)} />}
        </Field>
        <Field label={t("csosn")} hint={t("csosnHint")}>
          {(control) => (
            <select {...control} className="field" value={csosn} disabled={!canManage} onChange={(event) => setCsosn(event.target.value as "102" | "400")}>
              <option value="102">{t("csosn102")}</option>
              <option value="400">{t("csosn400")}</option>
            </select>
          )}
        </Field>
        <div className="flex flex-col justify-end gap-2 sm:col-span-2">
          {error && <p role="alert" className="banner banner-danger">{error}</p>}
          {saved && <p role="status" className="banner banner-ok">{t("saved")}</p>}
          {canManage ? <div><Button type="submit" loading={saving} disabled={stateRegistration.trim() === ""}>{t("save")}</Button></div> : <p className="text-sm text-text-3">{t("readOnly")}</p>}
        </div>
      </form>
    </Card>
  );
}
