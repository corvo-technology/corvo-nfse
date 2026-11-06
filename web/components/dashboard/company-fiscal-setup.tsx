"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { companies } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { effectiveFiscalProfiles, fiscalToday, resolveServiceState } from "@/lib/company-fiscal";
import type { Company, CompanyFiscalProfile, CompanyServiceTaxProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyFiscalProfileForm } from "./company-fiscal-profile-form";
import { CompanyServiceProfileForm } from "./company-service-profile-form";
import { useApiErrorText } from "@/lib/use-api-error";

type Review = { kind: "profile"; value: CompanyFiscalProfile } | { kind: "service"; value: CompanyServiceTaxProfile };
type Editor = { kind: "profile"; value: CompanyFiscalProfile | null } | { kind: "service"; value: CompanyServiceTaxProfile | null };
type Loaded = { key: string; profiles: CompanyFiscalProfile[]; services: CompanyServiceTaxProfile[]; error: string | null };

/** Dated, saved configuration; issuance still runs the authoritative fiscal pipeline. */
export function CompanyFiscalSetup({ company }: { company: Company }) {
  const { fiscalEnvironment, can } = useAuth();
  // Reset review and edit state when the active company/environment changes.
  return <FiscalSetup key={`${company.tenantId}:${company.id}:${fiscalEnvironment}`} company={company} canView={can("nfse.companies.view")} canManage={can("nfse.companies.manage")} />;
}
function FiscalSetup({ company, canView, canManage }: { company: Company; canView: boolean; canManage: boolean }) {
  const t = useTranslations("CompanyFiscal");
  const apiError = useApiErrorText();
  const [date, setDate] = useState(fiscalToday);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const busy = useRef(false);
  const requestKey = `${date}:${revision}`;
  useEffect(() => {
    if (!canView || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const abort = new AbortController();
    Promise.all([companies.fiscalProfiles(company.id, abort.signal), companies.serviceTaxProfiles(company.id, date, abort.signal)])
      .then(([profiles, services]) => { if (!abort.signal.aborted) setLoaded({ key: requestKey, profiles, services, error: null }); })
      .catch((cause: unknown) => { if (!abort.signal.aborted) setLoaded({ key: requestKey, profiles: [], services: [], error: apiError(cause, t("failed")) }); });
    return () => abort.abort();
  }, [company.id, date, requestKey, canView, t]);
  const data = loaded?.key === requestKey ? loaded : null;
  const activeProfiles = effectiveFiscalProfiles(data?.profiles ?? [], date);
  const active = activeProfiles.length === 1 ? activeProfiles[0] : null;
  const startReview = (value: Review) => { setEditor(null); setReview(value); setAcknowledged(false); setApprovalError(null); };
  const refresh = (effectiveFrom?: string, effectiveUntil?: string | null) => {
    if (effectiveFrom && (date < effectiveFrom || (effectiveUntil && date >= effectiveUntil))) setDate(effectiveFrom);
    setEditor(null); setReview(null); setAcknowledged(false); setRevision(value => value + 1);
  };
  async function approve() {
    if (!review || !acknowledged || !canManage || busy.current) return;
    busy.current = true; setApproving(true); setApprovalError(null);
    try {
      if (review.kind === "profile") await companies.approveFiscalProfile(company.id, review.value.id);
      else await companies.approveServiceTaxProfile(company.id, review.value.id);
      refresh();
    } catch (cause) { setApprovalError(apiError(cause, t("approvalFailure"))); }
    finally { busy.current = false; setApproving(false); }
  }
  const display = (value: string | boolean | null) => value === null || value === "" ? t("missing") : typeof value === "boolean" ? t(value ? "yes" : "no") : value;
  const facts = (items: [string, string | boolean | null][]) => <dl className="fiscal-facts">{items.map(([label, value]) => <div key={label}><dt className="text-xs text-text-3">{t(label)}</dt><dd className="mt-1 break-words text-sm">{display(value)}</dd></div>)}</dl>;
  const profileFacts = (profile: CompanyFiscalProfile) => facts([
    ["regime", t(`regimes.${profile.taxRegime}`)], ["simpleNational", profile.simpleNational], ["specialRegime", profile.specialTaxRegime],
    ["validFrom", profile.validFrom], ["validUntil", profile.validUntil ?? t("noEnd")], ["ibsOption", profile.ibsCbsRegularOption],
    ["ibsFrom", profile.ibsCbsRegularFrom], ["source", profile.source], ["approvedAt", profile.reviewedAt],
  ]);
  const serviceFacts = (service: CompanyServiceTaxProfile) => facts([
    ["name", service.name], ["serviceCode", service.serviceCode], ["municipalServiceCode", service.municipalServiceCode],
    ["operationNature", t(`operations.${service.operationNature}`)], ["nbsCode", service.nbsCode], ["cst", service.cst], ["classCode", service.classCode],
    ["operationIndicator", service.operationIndicator], ["incidenceMunicipalityCode", service.incidenceMunicipalityCode],
    ["issTaxation", service.issTaxation ? t(`iss.${service.issTaxation}`) : null], ["issRate", service.issRate], ["issWithholdingDefault", service.issWithholdingDefault],
    ["withholdingPolicy", t(`withholding.${service.withholdingPolicy}`)], ["withholdingRates", Object.entries(service.withholdingRates).map(([key, value]) => `${key.toUpperCase()}: ${value}%`).join(" · ")],
    ["regimeApplicability", service.regimeApplicability.map(regime => t(`regimes.${regime}`)).join(" · ") || t("allRegimes")],
    ["effectiveFrom", service.effectiveFrom], ["effectiveUntil", service.effectiveUntil ?? t("noEnd")], ["classificationSource", service.classificationSource], ["catalogVersion", service.catalogVersion],
  ]);
  return <section className="company-sheet flex flex-col gap-6 border border-border bg-surface p-5 sm:p-7" aria-label={t("title")}>
    <header><h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2><p className="mt-2 max-w-[70ch] text-sm text-text-3">{t("intro")}</p></header>
    {!canView ? <p className="fiscal-notice">{t("noView")}</p> : <>
      <div className="max-w-sm"><Field label={t("date")} hint={t("dateHint")}>{props => <input {...props} type="date" required className="field" value={date} disabled={approving} onChange={event => { setDate(event.target.value); setEditor(null); setReview(null); }} />}</Field></div>
      {!data ? <div role="status" aria-busy="true" aria-label={t("loading")} className="flex flex-col gap-3"><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div> : data.error ? <div><p role="alert" className="fiscal-notice">{data.error}</p><Button className="mt-3" onClick={() => setRevision(value => value + 1)}>{t("retry")}</Button></div> : <>
        <section className="fiscal-section"><header className="fiscal-heading"><span className="fiscal-number" aria-hidden>01</span><div><h3 className="text-lg font-medium">{t("profileTitle")}</h3><p className="mt-1 text-sm">{t(activeProfiles.length > 1 ? "profileAmbiguous" : !active ? "profileMissing" : active.reviewStatus === "approved" ? "profileApproved" : active.reviewStatus === "rejected" ? "profileRejected" : "profilePending")}</p></div></header>
          {active && profileFacts(active)}
          {canManage && <div className="mt-4 flex flex-wrap gap-3">{active?.reviewStatus !== "approved" && active && <Button onClick={() => startReview({ kind: "profile", value: active })}>{t("reviewProfile")}</Button>}<Button onClick={() => { setReview(null); setEditor({ kind: "profile", value: active ?? data.profiles.toSorted((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null }); }}>{t(active ? active.reviewStatus === "approved" ? "newPeriod" : "editProfile" : "createProfile")}</Button></div>}
          {data.profiles.length > 0 && <details className="mt-5"><summary className="cursor-pointer text-sm underline">{t("history")}</summary><ul className="mt-3 divide-y divide-border">{data.profiles.toSorted((a, b) => b.validFrom.localeCompare(a.validFrom)).map(profile => <li key={profile.id} className="py-3 text-sm"><span>{profile.validFrom} → {profile.validUntil ?? t("noEnd")} · {t(`regimes.${profile.taxRegime}`)} · {t(`statuses.${profile.reviewStatus}`)}</span>{profile.validFrom > date && <span className="ml-2">({t("future")})</span>}<details className="mt-2"><summary className="cursor-pointer underline">{t("reviewTitle")}</summary>{profileFacts(profile)}</details></li>)}</ul></details>}
        </section>
        <section className="fiscal-section"><header className="fiscal-heading"><span className="fiscal-number" aria-hidden>02</span><div><h3 className="text-lg font-medium">{t("servicesTitle")}</h3><p className="mt-1 text-sm text-text-3">{t("serviceHint")}</p></div></header>
          <p className="mt-4 text-sm">{company.defaultServiceCode ? t("serviceDefault", { code: company.defaultServiceCode }) : t("noDefault")}</p>
          {active && company.defaultServiceCode && (() => { const status = resolveServiceState(data.services, company.defaultServiceCode, date, active.taxRegime); return status === "missing" || status === "ambiguous" ? <p className="fiscal-notice mt-3">{t(status === "missing" ? "serviceMissing" : "serviceAmbiguous")}</p> : null; })()}
          {canManage && <Button className="mt-4" onClick={() => { setReview(null); setEditor({ kind: "service", value: null }); }}>{t("addService")}</Button>}
          {data.services.length === 0 ? <p className="mt-4 text-sm text-text-3">{t("serviceEmpty")}</p> : <ul className="mt-4 divide-y divide-border">{data.services.map(service => <li key={service.id} className="py-5"><h4 className="font-medium">{service.name}</h4><p className="mt-1 text-sm">{service.serviceCode} · {t(`statuses.${service.reviewStatus}`)}</p><details className="mt-3"><summary className="cursor-pointer text-sm underline">{t("reviewTitle")}</summary>{serviceFacts(service)}</details>{service.reviewStatus === "approved" ? <p className="mt-3 text-sm text-text-3">{t("serviceImmutable")}</p> : canManage && <div className="mt-3 flex flex-wrap gap-3"><Button aria-label={t("reviewServiceFor", { name: service.name })} onClick={() => startReview({ kind: "service", value: service })}>{t("reviewService")}</Button><Button onClick={() => { setReview(null); setEditor({ kind: "service", value: service }); }}>{t("edit")}</Button></div>}</li>)}</ul>}
        </section>
        {canManage && editor?.kind === "profile" && <CompanyFiscalProfileForm key={editor.value?.id ?? "new-profile"} company={company} profile={editor.value} onSaved={saved => refresh(saved.validFrom, saved.validUntil)} onCancel={() => setEditor(null)} />}
        {canManage && editor?.kind === "service" && <CompanyServiceProfileForm key={editor.value?.id ?? "new-service"} company={company} profile={editor.value} date={date} onSaved={saved => refresh(saved.effectiveFrom, saved.effectiveUntil)} onCancel={() => setEditor(null)} />}
        {canManage && review && <section className="border-t-2 border-accent pt-5" aria-label={t("reviewTitle")} aria-busy={approving}><h3 className="text-lg font-medium">{t("reviewTitle")}</h3><p className="mt-2 text-sm text-text-3">{t("reviewHint")}</p>{review.kind === "profile" ? profileFacts(review.value) : serviceFacts(review.value)}<label className="mt-5 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" disabled={approving} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />{t("acknowledge")}</label>{approvalError && <p role="alert" className="fiscal-notice mt-3">{approvalError}</p>}<div className="mt-4 flex flex-wrap gap-3"><Button disabled={approving} onClick={() => setReview(null)}>{t("cancel")}</Button><Button variant="accent" disabled={!acknowledged} loading={approving} onClick={approve}>{t(review.kind === "profile" ? "approveProfile" : "approveService")}</Button></div></section>}
      </>}
      <p className="fiscal-notice">{t("continueLater")}</p>
    </>}
  </section>;
}
