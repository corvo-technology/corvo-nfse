"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { companies } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fiscalMonth, isSimplesRateStale, simplesRateError } from "@/lib/company-fiscal";
import type { Company, SimplesRate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";

type Loaded = { revision: number; rates: SimplesRate[]; error: string | null };

/** Monthly Simples Nacional rates: informed by the company, never computed by Corvo (no DAS). */
export function CompanySimplesRate({ company }: { company: Company }) {
  const { fiscalEnvironment, can } = useAuth();
  return <SimplesRateCard key={`${company.tenantId}:${company.id}:${fiscalEnvironment}`} company={company} canView={can("nfse.companies.view")} canManage={can("nfse.companies.manage")} />;
}

function SimplesRateCard({ company, canView, canManage }: { company: Company; canView: boolean; canManage: boolean }) {
  const t = useTranslations("CompanySimplesRate");
  const month = fiscalMonth();
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [totalRate, setTotalRate] = useState("");
  const [issRate, setIssRate] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    if (!canView) return;
    const abort = new AbortController();
    companies.simplesRates(company.id, abort.signal)
      .then((rates) => { if (!abort.signal.aborted) setLoaded({ revision, rates, error: null }); })
      .catch((cause: unknown) => { if (!abort.signal.aborted) setLoaded({ revision, rates: [], error: cause instanceof Error ? cause.message : t("failed") }); });
    return () => abort.abort();
  }, [company.id, revision, canView, t]);
  if (!canView) return null;
  const data = loaded?.revision === revision ? loaded : null;
  const latest = data?.rates[0] ?? null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const reasons = { invalid: t("rateInvalid"), range: t("rateRange"), decimals: t("rateDecimals") };
    const total = simplesRateError(totalRate);
    if (total) return setIssue(reasons[total]);
    const iss = issRate.trim() === "" ? null : simplesRateError(issRate);
    if (iss) return setIssue(reasons[iss]);
    busy.current = true; setSaving(true); setIssue(null);
    try {
      await companies.saveSimplesRate(company.id, month, { totalRate: totalRate.trim(), ...(issRate.trim() === "" ? {} : { issRate: issRate.trim() }) });
      setTotalRate(""); setIssRate(""); setRevision((value) => value + 1);
    } catch (cause) { setIssue(cause instanceof Error ? cause.message : t("saveFailed")); }
    finally { busy.current = false; setSaving(false); }
  }
  return <section className="flex flex-col gap-4" aria-labelledby="simples-rate-title" aria-busy={!data}>
    <div><h2 id="simples-rate-title" className="text-base font-medium">{t("title")}</h2><p className="mt-1 text-sm text-text-3">{t("intro")}</p></div>
    {data?.error && <p role="alert" className="fiscal-notice">{data.error}</p>}
    {data && !data.error && (latest
      ? <div className="flex flex-col gap-1 text-sm"><p>{t("inForce", { month: latest.month })}: <strong>{latest.totalRate}%</strong>{latest.issRate !== null && <> · {t("issRate")}: {latest.issRate}%</>}</p>{isSimplesRateStale(latest.month, month) && <p className="fiscal-notice">{t("stale", { month: latest.month, current: month })}</p>}</div>
      : <p className="fiscal-notice">{t("none")}</p>)}
    {canManage && <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" aria-label={t("formTitle", { month })}>
      <Field label={t("totalRate")} hint={t("totalRateHint")} required>{(props) => <input {...props} className="field" inputMode="decimal" placeholder="6.54" value={totalRate} disabled={saving} onChange={(event) => setTotalRate(event.target.value)} />}</Field>
      <Field label={t("issRate")} hint={t("issRateHint")}>{(props) => <input {...props} className="field" inputMode="decimal" placeholder="2.01" value={issRate} disabled={saving} onChange={(event) => setIssRate(event.target.value)} />}</Field>
      {issue && <p role="alert" className="fiscal-notice sm:col-span-2">{issue}</p>}
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="accent" loading={saving}>{t("save", { month })}</Button></div>
    </form>}
  </section>;
}
