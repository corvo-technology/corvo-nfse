"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import { fieldIssues, errorCodeKey } from "@/lib/api-errors";
import { getNfeSettings, updateNfeSettings, type NfeReadiness, type NfeSettings } from "@/lib/nfe";
import { NfeFields, NFE_FIELD_DEFAULTS, type NfeFieldValues } from "@/components/companies/nfe-fields";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface NfeSettingsFormProps {
  companyId: string;
  /** State (UF) of the company, to show an IE example. */
  state?: string;
  /** Can the member change the settings (`nfe.documents.manage`)? */
  canManage: boolean;
  /** NFC-e is released for the account: the series of the consumer sales is then asked too. */
  nfce?: boolean;
  /** Called with the settings each time they are loaded or saved (the page shows the IE in its summary). */
  onSettings?: (settings: NfeSettings) => void;
}

/** The NF-e data of a company: state registration (IE), tax regime (CRT), series and the Simples defaults. */
export function NfeSettingsForm({ companyId, state: uf = "", canManage, nfce = false, onSettings }: NfeSettingsFormProps) {
  const t = useTranslations("Nfe.settings");
  const apiError = useApiErrorText();
  const [settings, setSettings] = useState<NfeSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<NfeFieldValues>(NFE_FIELD_DEFAULTS);
  const change = (patch: Partial<NfeFieldValues>) => setValues((current) => ({ ...current, ...patch }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ieError, setIeError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<NfeReadiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  /** Asks the SEFAZ cadastro. With `prefill`, an IE the SEFAZ found is put in the field (never saved by itself). */
  async function check(signal?: AbortSignal, prefill = false) {
    setChecking(true); setCheckFailed(false);
    try {
      const value = (await getNfeSettings(companyId, signal, true)).readiness;
      if (signal?.aborted) return;
      if (!value) { setCheckFailed(true); return; }
      setReadiness(value);
      const found = value.suggestedStateRegistration;
      if (found && (prefill || value.status === "ie_suggested")) setValues((current) => ({ ...current, stateRegistration: prefill || current.stateRegistration.trim() === "" ? found : current.stateRegistration }));
    } catch {
      if (!signal?.aborted) setCheckFailed(true);
    } finally {
      if (!signal?.aborted) setChecking(false);
    }
  }

  function fill(value: NfeSettings) {
    setSettings(value);
    setValues({ stateRegistration: value.stateRegistration ?? "", series: String(value.defaultSeries), nfceSeries: String(value.nfceDefaultSeries ?? 1), natOp: value.defaultNatOp, csosn: value.defaultCsosn === "400" ? "400" : "102" });
    onSettings?.(value);
  }

  useEffect(() => {
    const abort = new AbortController();
    getNfeSettings(companyId, abort.signal)
      .then((value) => { if (!abort.signal.aborted) { fill(value); setLoadError(null); void check(abort.signal); } })
      .catch((cause) => { if (!abort.signal.aborted) setLoadError(apiError(cause, t("loadFailed"))); });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apiError changes identity with the messages, not with the data
  }, [companyId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setSaved(false); setError(null); setIeError(null); setWarning(null);
    try {
      const result = await updateNfeSettings(companyId, { stateRegistration: values.stateRegistration.trim(), defaultSeries: Number(values.series), ...(nfce ? { nfceDefaultSeries: Number(values.nfceSeries) } : {}), defaultNatOp: values.natOp.trim() || undefined, defaultCsosn: values.csosn });
      fill(result);
      setWarning(result.registrationWarning ?? null);
      setSaved(true);
      void check();
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
  const sefaz = registrationText(t, readiness, checkFailed, uf);
  // One message at a time: a SEFAZ warning wins over "all set", and what is missing wins over a plain "found".
  const notice: Notice = sefaz && !sefaz.good ? { tone: "warn", text: sefaz.text }
    : missing.length > 0 ? (readiness?.status === "ie_suggested" && sefaz ? { tone: "ok", text: sefaz.text } : { tone: "list", missing })
    : warning ? null
    : checking && !readiness ? { tone: "checking" }
    : { tone: "ready" };
  return (
    <Card id="nfe" className="flex scroll-mt-24 flex-col gap-4 p-5" aria-labelledby="nfe-settings-title">
      <div>
        <h2 id="nfe-settings-title" className="text-base font-medium">{t("title")}</h2>
        <p className="mt-0.5 text-[13px] text-text-3">{t("subtitle")}</p>
      </div>
      <RegistrationStatus notice={notice} checking={checking} canManage={canManage} onCheck={() => void check(undefined, true)} />
      <form noValidate onSubmit={save} className="grid items-start gap-4 sm:grid-cols-2">
        <NfeFields values={values} onChange={change} uf={uf} disabled={!canManage} nfce={nfce} ieError={ieError ?? undefined} afterIe={
          <div className="flex flex-col gap-1.5" data-testid="nfe-regime">
            <span className="field-label">{t("crt")}</span>
            {regime ? <p className="field text-text-2">{t(regime === "mei" ? "crt4" : "crt1")}</p> : <p role="status" className="banner banner-warn">{t("crtUnsupported")}</p>}
            <p className="field-hint">{t("crtFollows")} <Link href={`/app/companies/${companyId}#fiscal`} className="underline">{t("crtEdit")}</Link></p>
          </div>
        } />
        <div className="flex flex-col justify-end gap-2 sm:col-span-2">
          {error && <p role="alert" className="banner banner-danger">{error}</p>}
          {saved && <p role="status" className="banner banner-ok">{t("saved")}</p>}
          {warning && <p role="alert" className="banner banner-warn">{warning}</p>}
          {canManage ? <div><Button type="submit" loading={saving} disabled={values.stateRegistration.trim() === ""}>{t("save")}</Button></div> : <p className="text-sm text-text-3">{t("readOnly")}</p>}
        </div>
      </form>
    </Card>
  );
}

type Notice = { tone: "ok" | "warn"; text: string } | { tone: "list"; missing: string[] } | { tone: "checking" } | { tone: "ready" } | null;

/** What the SEFAZ cadastro says about the IE, in plain words (`good` when it is no problem). */
function registrationText(t: ReturnType<typeof useTranslations>, readiness: NfeReadiness | null, failed: boolean, uf: string): { text: string; good: boolean } | null {
  if (failed) return { text: t("readiness.unavailable"), good: false };
  const status = readiness?.status;
  if (!readiness || !status || status === "company_incomplete") return null;
  const key = status === "sefaz_rejected" && readiness.sefazCStat === "257" ? "sefaz_not_issuer" : status;
  const text = t(`readiness.${key}`, { uf: uf || "?", ie: readiness.stateRegistration ?? "", suggested: readiness.suggestedStateRegistration ?? "", cstat: readiness.sefazCStat ?? "", reason: readiness.sefazReason ?? "", list: readiness.registrations.filter((item) => item.enabled).map((item) => item.stateRegistration).join(", ") });
  return { text, good: status === "ready" || status === "ie_suggested" };
}

/** The one notice about the company (all set, what is missing or what the SEFAZ said), with the button that asks the SEFAZ again and fills the IE in. */
function RegistrationStatus({ notice, checking, canManage, onCheck }: { notice: Notice; checking: boolean; canManage: boolean; onCheck: () => void }) {
  const t = useTranslations("Nfe.settings");
  return (
    <div data-testid="nfe-readiness" role="status" className="flex flex-col gap-2">
      {notice?.tone === "checking" ? <p className="text-sm text-text-3">{t("readiness.checking")}</p>
        : notice?.tone === "ready" ? <p className="banner banner-ok"><Check size={16} aria-hidden className="mt-0.5 flex-none text-accent" />{t("ready")}</p>
        : notice?.tone === "list" ? (
          <div className="banner banner-warn flex flex-col gap-1">
            <p>{t("missingTitle")}</p>
            <ul className="list-disc pl-5">{notice.missing.map((field) => <li key={field}>{t.has(`missing.${field}`) ? t(`missing.${field}`) : field}</li>)}</ul>
          </div>
        )
        : notice && <p className={notice.tone === "ok" ? "banner banner-ok" : "banner banner-warn"}>{notice.text}</p>}
      {canManage && <div><Button type="button" variant="secondary" loading={checking} onClick={onCheck}><Search size={14} aria-hidden />{t("readiness.button")}</Button></div>}
    </div>
  );
}
