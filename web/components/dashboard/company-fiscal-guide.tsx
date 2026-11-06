"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { companies } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { effectiveFiscalProfiles, fiscalToday, isSimpleNational, resolveServiceState } from "@/lib/company-fiscal";
import { SERVICE_CODES } from "@/lib/service-codes";
import type { Company, CompanyFiscalProfile, CompanyServiceTaxProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/input";
import { ServiceCodeCombobox } from "@/components/ui/service-code-combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiErrorText } from "@/lib/use-api-error";

/** Mirrors the API rule `simples.ibscbs-effective`: from this date Simples Nacional invoices may need IBS/CBS classification. */
const SIMPLES_IBSCBS_FROM = "2027-01-01";
const asRate = (value: string) => value.trim().replace(",", ".");
const isRate = (value: string) => value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
function nextDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

type Loaded = { profiles: CompanyFiscalProfile[]; services: CompanyServiceTaxProfile[]; error: string | null };

/**
 * Plain-language fiscal setup: confirms what the company registration already declared and asks only for what the regime needs.
 * Saving here is the confirmation (`confirm: true`), so there is no separate review screen. The dated, per-field view stays in the advanced section.
 */
export function CompanyFiscalGuide({ company }: { company: Company }) {
  const { fiscalEnvironment, can } = useAuth();
  return <Guide key={`${company.tenantId}:${company.id}:${fiscalEnvironment}`} company={company} canView={can("nfse.companies.view")} canManage={can("nfse.companies.manage")} />;
}

function Guide({ company, canView, canManage }: { company: Company; canView: boolean; canManage: boolean }) {
  const t = useTranslations("CompanyFiscalGuide");
  const apiError = useApiErrorText();
  const today = fiscalToday();
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [code, setCode] = useState(company.defaultServiceCode ?? "");
  const [issRate, setIssRate] = useState("");
  const [retention, setRetention] = useState<"NONE_CONFIRMED" | "UNKNOWN">("NONE_CONFIRMED");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!canView) return;
    const abort = new AbortController();
    Promise.all([companies.fiscalProfiles(company.id, abort.signal), companies.serviceTaxProfiles(company.id, today, abort.signal)])
      .then(([profiles, services]) => { if (!abort.signal.aborted) setLoaded({ profiles, services, error: null }); })
      .catch((cause: unknown) => { if (!abort.signal.aborted) setLoaded({ profiles: [], services: [], error: apiError(cause, t("failed")) }); });
    return () => abort.abort();
  }, [company.id, today, revision, canView, t]);

  if (!canView) return null;
  if (!loaded) return <Card className="flex flex-col gap-3 p-5" aria-busy="true" aria-label={t("loading")}><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-full" /></Card>;
  if (loaded.error) return <Card className="flex flex-col gap-3 p-5"><p role="alert" className="banner banner-danger">{loaded.error}</p><Button onClick={() => { setLoaded(null); setRevision(value => value + 1); }}>{t("retry")}</Button></Card>;

  const active = effectiveFiscalProfiles(loaded.profiles, today).length === 1 ? effectiveFiscalProfiles(loaded.profiles, today)[0] : null;
  const run = async (action: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(null);
    try { await action(); setLoaded(null); setRevision(value => value + 1); }
    catch (cause) { setError(apiError(cause, t("saveFailure"))); }
    finally { busy.current = false; setSaving(false); }
  };
  const header = <div><h2 className="text-base font-medium">{t("title")}</h2><p className="mt-0.5 text-[13px] text-text-3">{t("subtitle")}</p></div>;
  if (!active) return <Card className="flex flex-col gap-3 p-5">{header}<p className="banner banner-warn">{t("noProfile")}</p></Card>;

  const simples = isSimpleNational(active.taxRegime);
  const needsService = !simples || today >= SIMPLES_IBSCBS_FROM;
  const approved = active.reviewStatus === "approved";
  const serviceState = code ? resolveServiceState(loaded.services, code, today, active.taxRegime) : "missing";
  const serviceName = SERVICE_CODES.find(item => item.code === code)?.description ?? code;
  const saveService = () => {
    const value = asRate(issRate);
    if (!/^\d{6}$/.test(code)) { setError(t("invalidCode")); return; }
    if (!isRate(value)) { setError(t("invalidRate")); return; }
    void run(async () => {
      const created = await companies.createServiceTaxProfile(company.id, {
        name: serviceName.slice(0, 120), serviceCode: code, operationNature: "SERVICE", effectiveFrom: today, issTaxation: "NORMAL", issRate: value,
        issWithholdingDefault: false, withholdingPolicy: retention, withholdingRates: {}, regimeApplicability: [], classificationSource: "manual",
      });
      await companies.approveServiceTaxProfile(company.id, created.id);
    });
  };
  const done = (label: string, detail?: string) => <li className="flex items-start gap-3 border-t border-border-soft py-3.5 first:border-t-0"><span aria-hidden className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border border-accent bg-accent text-bg"><Check size={13} strokeWidth={3} /></span><div><p className="text-[14px]">{label}</p>{detail && <p className="text-[12.5px] text-text-4">{detail}</p>}</div></li>;
  const todo = (label: string, hint: string, body: React.ReactNode) => <li className="flex flex-col gap-3 border-t border-border-soft py-3.5 first:border-t-0"><div><p className="text-[14px]">{label}</p><p className="text-[12.5px] text-text-4">{hint}</p></div>{canManage && body}</li>;

  return <Card className="flex flex-col gap-4 p-5" aria-busy={saving}>
    {header}
    <ul className="flex flex-col">
      {approved ? done(t("regimeDone", { regime: t(`regimes.${active.taxRegime}`) }), t("regimeDoneHint")) : todo(t("regimePending", { regime: t(`regimes.${active.taxRegime}`) }), t("regimePendingHint"), <div><Button variant="accent" loading={saving} onClick={() => void run(() => companies.approveFiscalProfile(company.id, active.id))}>{t("confirmRegime")}</Button></div>)}
      {!needsService ? done(t("serviceNotNeeded"), t("serviceNotNeededHint"))
        : serviceState === "approved" ? done(t("serviceDone", { service: serviceName }), t("serviceDoneHint"))
        : todo(t("serviceTitle"), t(serviceState === "missing" ? "serviceHint" : "serviceReviewHint"), serviceState === "missing" || serviceState === "unreviewed"
          ? <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("serviceLabel")} required>{props => <ServiceCodeCombobox {...props} value={code} onChange={setCode} />}</Field>
            <Field label={t("issRateLabel")} required hint={t("issRateHint")}>{props => <input {...props} className="field" inputMode="decimal" placeholder="5" value={issRate} disabled={saving} onChange={event => setIssRate(event.target.value)} />}</Field>
            <Field label={t("retentionLabel")} className="sm:col-span-2">{props => <select {...props} className="field" value={retention} disabled={saving} onChange={event => setRetention(event.target.value as typeof retention)}><option value="NONE_CONFIRMED">{t("retentionNone")}</option><option value="UNKNOWN">{t("retentionSome")}</option></select>}</Field>
            <div className="sm:col-span-2"><Button variant="accent" loading={saving} onClick={saveService}>{t("saveService")}</Button></div>
          </div>
          : <p className="text-[12.5px] text-text-3">{t("serviceAdvanced")}</p>)}
    </ul>
    {error && <p role="alert" className="banner banner-danger">{error}</p>}
  </Card>;
}
