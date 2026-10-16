"use client";
import { useEffect, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { companies, certificates, collectAll } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Company, Certificate } from "@/lib/types";
import { CompanyForm } from "@/components/dashboard/company-form";
import { CertificateUpload } from "@/components/dashboard/certificate-upload";
import { CompanyFiscalSetup } from "@/components/dashboard/company-fiscal-setup";
import { companySetup } from "@/lib/company-setup";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const t = useTranslations("CompanyDetail"); const tc = useTranslations("Companies"); const locale = useLocale();
  const { can } = useAuth();
  const [company, setCompany] = useState<Company | null>(null); const [certs, setCerts] = useState<Certificate[]>([]);
  const [error, setError] = useState<string | null>(null); const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false); const [uploading, setUploading] = useState(false);
  const [confirmation, setConfirmation] = useState<{ kind: "company" | "certificate"; id: string } | null>(null); const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const certificateView = can("nfse.certificates.view");
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([companies.get(id, abort.signal), certificateView ? collectAll((cursor) => certificates.list(id, { cursor, limit: 1000 }, abort.signal)) : Promise.resolve([])])
      .then(([value, certificates]) => { if (!abort.signal.aborted) { setCompany(value); setCerts(certificates); setNow(Date.now()); setError(null); } })
      .catch((cause) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, [id, certificateView, revision]);
  async function remove() {
    if (!confirmation || busy) return;
    setBusy(true); setError(null);
    try {
      if (confirmation.kind === "company") { await companies.delete(id); router.replace("/app/companies"); }
      else { await certificates.delete(id, confirmation.id); setCerts((rows) => rows.filter((item) => item.id !== confirmation.id)); setRevision((value) => value + 1); }
      setConfirmation(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("failed")); }
    finally { setBusy(false); }
  }
  if (!company || company.id !== id) return <div className="flex flex-col gap-4"><p role={error ? "alert" : "status"}>{error || t("loading")}</p>{error && <Button onClick={() => setRevision((value) => value + 1)}>{t("retry")}</Button>}</div>;
  const setup = companySetup(company);
  const date = (value: string) => new Date(value).toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US");
  return <div className="flex max-w-[900px] flex-col gap-6">
    <PageHeader title={company.tradeName || company.legalName} subtitle={`${company.taxId} · ${tc(`status.${company.status}`)}`} actions={can("nfse.companies.manage") && <><Button onClick={() => setEditing(true)}>{t("edit")}</Button><Button variant="danger" onClick={() => setConfirmation({ kind: "company", id })}>{t("delete")}</Button></>} />
    {error && <p role="alert" className="banner banner-danger">{error}</p>}
    <Card className="grid gap-4 p-5 sm:grid-cols-2"><div><p className="eyebrow">{t("legalName")}</p><p>{company.legalName}</p></div><div><p className="eyebrow">{t("taxRegime")}</p><p>{company.taxRegime ?? "—"}</p></div><div><p className="eyebrow">{t("municipalReg")}</p><p>{company.municipalReg || "—"}</p></div><div><p className="eyebrow">{t("municipality")}</p><p>{company.municipalityCode || "—"} · {company.address.city} {company.address.state}</p></div><div><p className="eyebrow">{t("defaultServiceCode")}</p><p className="font-mono">{company.defaultServiceCode || "—"}</p></div><div><p className="eyebrow">{t("environment")}</p><p>{t(`env.${company.environment}`)}</p></div></Card>
    {company.status === "ready" && <p className="banner banner-ok"><Check size={16} aria-hidden className="mt-0.5 flex-none text-accent" />{t("setup.complete")}</p>}
    {company.status === "blocked" && <p role="alert" className="banner banner-danger">{t("blocked")}</p>}
    {company.status !== "blocked" && !setup.allDone && (
      <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-base font-medium">{t("setup.title")}</h2><p className="mt-0.5 text-[13px] text-text-3">{t("setup.subtitle")}</p></div>
            <span className="flex-none font-mono text-xs text-text-3">{t("setup.progress", { done: setup.done, total: setup.total })}</span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={setup.total} aria-valuenow={setup.done} aria-label={t("setup.title")} className="h-1 overflow-hidden rounded-full bg-track"><div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(setup.done / setup.total) * 100}%` }} /></div>
          <ul className="flex flex-col">
            {setup.items.map((item) => {
              const canAct = item.key === "certificate" ? can("nfse.certificates.manage") : can("nfse.companies.manage");
              return <li key={item.key} className="flex items-center gap-3.5 border-t border-border-soft py-3.5 first:border-t-0">
                <span aria-hidden className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border ${item.done ? "border-accent bg-accent text-bg" : "border-border-strong text-text-4"}`}>{item.done ? <Check size={13} strokeWidth={3} /> : null}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[14px] ${item.done ? "text-text-3 line-through decoration-text-5" : "text-text"}`}>{t(`setup.items.${item.key}.title`)}{!item.done && <span className={`ml-2 rounded-full border px-2 py-px font-mono text-[10px] uppercase tracking-wider ${item.blocking ? "border-warn/40 text-warn" : "border-border-strong text-text-4"}`}>{t(item.blocking ? "setup.required" : "setup.recommended")}</span>}</p>
                  {!item.done && <p className="text-[12.5px] text-text-4">{t(`setup.items.${item.key}.hint`)}</p>}
                </div>
                {!item.done && canAct && <Button variant="ghost" onClick={() => (item.key === "certificate" ? setUploading(true) : setEditing(true))}>{t(`setup.items.${item.key}.action`)}<ChevronRight size={14} aria-hidden /></Button>}
              </li>;
            })}
          </ul>
          {company.environment === "test" && !setup.allDone && !company.setupGaps?.includes("municipality_code") && <p className="text-[12.5px] text-text-4">{t("setup.testNote")}</p>}
        </Card>
    )}
    <details className="group"><summary className="cursor-pointer text-sm underline">{t("fiscalAdvanced")}</summary><div className="mt-4"><CompanyFiscalSetup company={company} /></div></details>
    {certificateView && <Card className="flex flex-col gap-4 p-5"><div className="flex items-center justify-between gap-4"><h2 className="text-base font-medium">{t("certificates")}</h2>{can("nfse.certificates.manage") && <Button onClick={() => setUploading(true)}>{t("upload")}</Button>}</div>{certs.length === 0 ? <p className="text-sm text-text-3">{t("noCertificates")}</p> : certs.map((cert) => <div key={cert.id} className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4"><div><p>{cert.subject}</p><p className="font-mono text-xs text-text-3">{cert.serialNumber}</p><p className="text-sm text-text-3">{t("validUntil")}: {date(cert.validUntil)} · {t(new Date(cert.validUntil).getTime() < now ? "expired" : cert.status)}</p>{new Date(cert.validUntil).getTime() >= now && new Date(cert.validUntil).getTime() - now < 30 * 86400000 && <p className="text-[12.5px] text-warn">{t("expiresSoon")}</p>}</div>{can("nfse.certificates.manage") && <Button variant="danger" onClick={() => setConfirmation({ kind: "certificate", id: cert.id })}>{t("revoke")}</Button>}</div>)}</Card>}
    <Modal open={editing} onClose={() => setEditing(false)} title={t("edit")} wide><CompanyForm company={company} onCancel={() => setEditing(false)} onSave={async (input) => { setCompany(await companies.update(id, input)); setEditing(false); }} /></Modal>
    <Modal open={uploading} onClose={() => setUploading(false)} title={t("upload")}><CertificateUpload companyId={id} onUploaded={(cert) => { setCerts([cert]); setUploading(false); setRevision((value) => value + 1); }} /></Modal>
    <Modal open={confirmation !== null} onClose={() => { if (!busy) setConfirmation(null); }} title={t("confirmTitle")}><p className="mb-5 text-sm text-text-3">{t(confirmation?.kind === "company" ? "confirmCompany" : "confirmCertificate")}</p><Button variant="danger" loading={busy} onClick={remove}>{t("confirm")}</Button></Modal>
  </div>;
}
