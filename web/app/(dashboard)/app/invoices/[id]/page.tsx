"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { invoices, collectAll } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canCancelInvoice, showsCancellationRequested, showsCancellationReason } from "@/lib/invoice-cancellation";
import type { Invoice, InvoiceEvent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CancelInvoiceDialog } from "@/components/dashboard/cancel-invoice-dialog";
import { ManualReviewActions } from "@/components/invoices/manual-review-actions";
import { Card } from "@/components/ui/card";
import { FirstNoteBanner } from "@/components/onboarding/first-note-banner";
import { DetailSkeleton } from "@/components/ui/detail-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { copyInvoiceHref } from "@/lib/invoice-copy";
import { timeAgo } from "@/lib/i18n-helpers";
import { formatScheduledDate, isScheduled } from "@/lib/invoice-schedule";
import { useApiErrorText, useInvoiceErrorText } from "@/lib/use-api-error";

const pending = new Set(["queued", "processing", "retry_pending", "reconciliation_required", "cancelling"]);
/** Scheduled invoices wait for their day; reconciliation asks the portal again every few minutes. */
const pollMs = (invoice: Invoice) => (isScheduled(invoice) ? 60000 : invoice.status === "reconciliation_required" ? 30000 : 5000);
const TONE: Record<string, string> = { queued: "bg-text-4", processing: "bg-accent", retry_pending: "bg-warn", authorized: "bg-ok", rejected: "bg-danger", failed: "bg-danger", reconciliation_required: "bg-warn", manual_review: "bg-warn", cancelling: "bg-warn", cancelled: "bg-text-4" };
export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>(); const t = useTranslations("InvoiceDetail"); const ts = useTranslations("Invoices.status"); const tc = useTranslations("Common"); const locale = useLocale(); const { can } = useAuth(); const [cancelOpen, setCancelOpen] = useState(false);
  const apiError = useApiErrorText();
  const invoiceError = useInvoiceErrorText();
  const [invoice, setInvoice] = useState<Invoice | null>(null); const [events, setEvents] = useState<InvoiceEvent[]>([]);
  const [error, setError] = useState<string | null>(null); const [revision, setRevision] = useState(0); const [downloading, setDownloading] = useState(false); const downloadBusy = useRef(false);
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let running = false; let historyStatus: string | null = null;
    async function load() {
      if (abort.signal.aborted || running) return;
      running = true;
      try {
        // Poll only the invoice; the history is refetched when the status changes.
        const value = await invoices.get(id, abort.signal);
        const history = value.status !== historyStatus ? await collectAll((cursor) => invoices.events(id, { cursor, limit: 1000 }, abort.signal)) : null;
        if (abort.signal.aborted) return;
        historyStatus = value.status;
        setInvoice(value); if (history) setEvents(history); setError(null);
        if (pending.has(value.status) && !document.hidden) timer = setTimeout(load, pollMs(value));
      } catch (cause) { if (!abort.signal.aborted) setError(apiError(cause, t("failed"))); }
      finally { running = false; }
    }
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void load(); };
    void load(); document.addEventListener("visibilitychange", visibility);
    return () => { abort.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [id, revision, t]);
  async function download(kind: "pdf" | "xml") {
    if (downloadBusy.current) return;
    downloadBusy.current = true; setDownloading(true); setError(null);
    try {
      const blob = await invoices[kind](id); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `nfse-${id}.${kind}`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(apiError(cause, t("failed"))); }
    finally { downloadBusy.current = false; setDownloading(false); }
  }
  if (!invoice || invoice.id !== id) return error ? <div className="flex flex-col gap-4"><p role="alert">{error}</p><Button onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></div> : <DetailSkeleton label={t("loading")} />;
  const cancellable = canCancelInvoice(invoice.status, can("nfse.invoices.issue")); const hasDocuments = Boolean(invoice.authorizedAt); const scheduled = isScheduled(invoice);
  const date = (value: string) => new Date(value).toLocaleString(locale === "pt" ? "pt-BR" : "en-US");
  const brl = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL" });
  const money = brl.format(invoice.amount);
  return <div className="flex max-w-[900px] flex-col gap-6"><PageHeader title={invoice.nfseNumber ? `${t("title")} ${invoice.nfseNumber}` : t("title")} subtitle={`${invoice.id} · ${scheduled ? ts("scheduled") : ts(invoice.status)}`} actions={<>{can("nfse.invoices.issue") && <Link href={copyInvoiceHref(invoice.id)} className="btn">{t("copy")}</Link>}{cancellable && <Button variant="danger" onClick={() => setCancelOpen(true)}>{t("cancel.open")}</Button>}<Button onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></>} />
    {error && <p role="alert" className="banner banner-danger">{error}</p>}
    <FirstNoteBanner invoiceId={invoice.id} />
    {scheduled && <p role="status" className="banner banner-info">{t("scheduledBanner", { date: formatScheduledDate(invoice.scheduledFor!, locale, true) })}</p>}
    <Card className="grid gap-4 p-5 sm:grid-cols-2"><div><p className="eyebrow">{t("customer")}</p><p>{invoice.customerName || t("anonymousCustomer")}</p><p className="text-sm text-text-3">{invoice.customerTaxId}</p></div><div><p className="eyebrow">{t("amount")}</p><p>{money}</p></div>{invoice.deduction ? <div><p className="eyebrow">{t("deduction")}</p><p>{brl.format(invoice.deduction)}</p></div> : null}{invoice.serviceSnapshot?.purchaseOrder ? <div><p className="eyebrow">{t("purchaseOrder")}</p><p>{invoice.serviceSnapshot.purchaseOrder}</p></div> : null}{invoice.serviceSnapshot?.notes ? <div className="sm:col-span-2"><p className="eyebrow">{t("notes")}</p><p className="whitespace-pre-line">{invoice.serviceSnapshot.notes}</p></div> : null}<div><p className="eyebrow">{t("reference")}</p><p>{invoice.externalId || "—"}</p></div><div><p className="eyebrow">{t("competence")}</p><p>{invoice.competenceDate.slice(0, 10)}</p></div><div className="sm:col-span-2"><p className="eyebrow">{t("service")}</p><p>{invoice.serviceDescription}</p><p className="text-sm text-text-3">{invoice.serviceSnapshot.code} · {invoice.serviceSnapshot.municipalityCode}</p></div>{invoice.cancellationReason && showsCancellationReason(invoice.status) && <div className="sm:col-span-2"><p className="eyebrow">{t("cancel.reasonLabel")}</p><p>{t(`cancel.reasons.${invoice.cancellationReason}`)}</p>{invoice.cancellationDescription && <p className="text-sm text-text-3">{invoice.cancellationDescription}</p>}</div>}</Card>
    {invoice.lastErrorMessage && <p role="alert" className="banner banner-danger">{invoice.lastErrorCode}: {invoiceError(invoice.lastErrorCode, invoice.lastErrorMessage)}</p>}
    {showsCancellationRequested(invoice.status, invoice.cancellationRequestedAt) && <p className="banner">{t("cancel.requested")}</p>}
    {invoice.status === "manual_review" && can("nfse.invoices.issue") && <ManualReviewActions invoiceIds={[invoice.id]} onDone={() => setRevision((value) => value + 1)} />}
    <Card className="flex flex-col gap-4 p-5"><h2 className="font-medium">{t("documents")}</h2><div className="flex gap-3"><Button disabled={!hasDocuments || downloading} onClick={() => void download("pdf")}>PDF</Button><Button disabled={!hasDocuments || downloading} onClick={() => void download("xml")}>XML</Button></div>{!hasDocuments && <p className="text-sm text-text-3">{t("documentsHint")}</p>}</Card>
    <Card className="flex flex-col gap-5 p-5"><h2 className="font-medium">{t("events")}</h2>{events.length === 0 && <p className="text-sm text-text-3">{t("noEvents")}</p>}
      <ol className="flex flex-col">{events.map((event, index) => {
        const last = index === events.length - 1; const waiting = last && pending.has(event.to); const tone = TONE[event.to];
        return <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
          {(!last || waiting) && <span aria-hidden className="absolute left-[7px] top-5 h-[calc(100%-1.25rem)] w-px bg-border-strong" />}
          <span aria-hidden className={`relative mt-1 size-[15px] shrink-0 rounded-full border-2 border-bg ${tone} ${waiting ? "animate-pulse" : ""}`} />
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-3"><p className={last ? "font-medium text-text" : "text-text-2"}>{last && scheduled && event.to === "queued" ? ts("scheduled") : ts(event.to)}</p><time dateTime={event.at} title={date(event.at)} className="text-[12.5px] text-text-4">{timeAgo(event.at, tc)}</time></div><p className="text-sm text-text-3">{last && scheduled && event.to === "queued" ? t("timeline.scheduled", { date: formatScheduledDate(invoice.scheduledFor!, locale, true) }) : t(`timeline.${event.to}`)}</p></div>
        </li>;
      })}</ol>
    </Card>
    {cancelOpen && cancellable && <CancelInvoiceDialog invoice={invoice} open={cancelOpen} onClose={() => setCancelOpen(false)} onCancelled={(updated) => { setCancelOpen(false); setInvoice(updated); setRevision((value) => value + 1); }} />}
  </div>;
}
