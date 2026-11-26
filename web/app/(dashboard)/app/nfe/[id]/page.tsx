"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth";
import { errorCodeKey } from "@/lib/api-errors";
import { saveBlob } from "@/lib/download";
import { discardNfe, getNfe, isNfePending, listNfeEvents, nfeActions, nfeFile, syncNfe, type NfeDocument, type NfeTimelineEntry } from "@/lib/nfe";
import { useApiErrorText } from "@/lib/use-api-error";
import { NfeCancelDialog } from "@/components/nfe/nfe-cancel-dialog";
import { NfeCorrectionDialog } from "@/components/nfe/nfe-correction-dialog";
import { NfeTimeline } from "@/components/nfe/nfe-timeline";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DetailSkeleton } from "@/components/ui/detail-skeleton";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";

/** Looks again while the SEFAZ or Corvo is still working; slower when it is only waiting to check. */
const pollMs = (nfe: NfeDocument) => (nfe.status === "reconciliation_required" ? 30000 : 5000);

export default function NfeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("Nfe.detail");
  const tn = useTranslations("Nfe");
  const te = useTranslations("ApiErrors");
  const locale = useLocale();
  const { can } = useAuth();
  const apiError = useApiErrorText();
  const [nfe, setNfe] = useState<NfeDocument | null>(null);
  const [timeline, setTimeline] = useState<NfeTimelineEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let seen: string | null = null;
    async function load() {
      if (abort.signal.aborted || running) return;
      running = true;
      try {
        const value = await getNfe(id, abort.signal);
        // The timeline also carries the fiscal events, so it is read again whenever the note changed.
        const key = `${value.status}:${value.updatedAt}`;
        const entries = key !== seen ? await listNfeEvents(id, abort.signal) : null;
        if (abort.signal.aborted) return;
        seen = key;
        setNfe(value);
        if (entries) setTimeline(entries);
        setError(null);
        if (isNfePending(value.status) && !document.hidden) timer = setTimeout(load, pollMs(value));
      } catch (cause) { if (!abort.signal.aborted) setError(apiError(cause, t("failed"))); }
      finally { running = false; }
    }
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void load(); };
    void load();
    document.addEventListener("visibilitychange", visibility);
    return () => { abort.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the texts change with the language, not with the note
  }, [id, revision]);

  async function run(action: () => Promise<unknown>, done?: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(); if (done) setNotice(done); setRevision((value) => value + 1); }
    catch (cause) { setError(apiError(cause, t("failed"))); }
    finally { inFlight.current = false; setBusy(false); setDiscardOpen(false); }
  }

  if (!nfe || nfe.id !== id) return error ? <div className="flex flex-col gap-4"><p role="alert">{error}</p><Button onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></div> : <DetailSkeleton label={t("loading")} />;

  const actions = nfeActions(nfe, can);
  const date = (value: string | null) => (value ? new Date(value).toLocaleString(locale === "pt" ? "pt-BR" : "en-US") : "—");
  const money = (value: string) => new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL" }).format(Number(value));
  const last = nfe.lastError;
  const lastText = last ? (te.has(errorCodeKey(last.code)) ? te(errorCodeKey(last.code)) : last.message) : null;
  const showError = last !== null && nfe.status !== "authorized" && nfe.status !== "cancelled";

  return (
    <div className="flex max-w-[900px] flex-col gap-6">
      <PageHeader
        title={nfe.number ? `${t("title")} ${nfe.number}` : t("title")}
        subtitle={`${nfe.id} · ${tn(`status.${nfe.status}`)}`}
        actions={
          <>
            {actions.sync && <Button loading={busy} onClick={() => void run(() => syncNfe(id), t("syncDone"))}>{t("sync")}</Button>}
            {actions.resubmit && <Link href={`/app/nfe/new?resubmit=${nfe.id}`} className="btn btn-accent">{t("resubmit")}</Link>}
            {actions.discard && <Button variant="danger" onClick={() => setDiscardOpen(true)}>{t("discard")}</Button>}
            {actions.correct && <Button onClick={() => setCorrectOpen(true)}>{t("correct")}</Button>}
            {actions.cancel && <Button variant="danger" onClick={() => setCancelOpen(true)}>{t("cancel")}</Button>}
            <Button onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button>
          </>
        }
      />
      {error && <p role="alert" className="banner banner-danger">{error}</p>}
      {notice && <p role="status" className="banner banner-ok">{notice}</p>}
      {nfe.environment === "test" && <p role="note" className="banner">{tn("homologationNotice")}</p>}
      {showError && lastText && (
        <div role="alert" className="banner banner-danger flex flex-col gap-1">
          <p><strong>{t(`errorType.${last.type}`)}.</strong> {lastText}</p>
          {last.hint && <p className="text-sm">{t("hint")}: {last.hint}</p>}
          {last.issues && last.issues.length > 0 && <ul className="list-disc pl-5 text-sm">{last.issues.map((issue) => <li key={`${issue.field}-${issue.code}`}><span className="font-mono">{issue.field}</span>: {te.has(errorCodeKey(issue.code)) ? te(errorCodeKey(issue.code)) : issue.message}</li>)}</ul>}
        </div>
      )}
      {nfe.status === "reconciliation_required" && <p role="status" className="banner banner-warn">{t("reconciling")}</p>}
      {nfe.status === "manual_review" && <p role="status" className="banner banner-warn">{t("manualReview")}</p>}

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <div><p className="eyebrow">{t("recipient")}</p><p>{nfe.recipient.name}</p><p className="text-sm text-text-3">{nfe.recipient.taxId}</p></div>
        <div><p className="eyebrow">{t("amount")}</p><p>{money(nfe.totals.vNF)}</p></div>
        <div><p className="eyebrow">{t("natOp")}</p><p>{nfe.natOp}</p></div>
        <div><p className="eyebrow">{t("numberSeries")}</p><p className="font-mono">{nfe.number ? `${nfe.number} / ${nfe.series}` : "—"}</p></div>
        <div className="sm:col-span-2"><p className="eyebrow">{t("accessKey")}</p><p className="select-all break-all font-mono text-[13px]">{nfe.accessKey ?? "—"}</p></div>
        <div><p className="eyebrow">{t("protocol")}</p><p className="font-mono text-[13px]">{nfe.protocol ?? "—"}</p></div>
        <div><p className="eyebrow">{t("authorizedAt")}</p><p>{date(nfe.authorizedAt)}</p></div>
        {nfe.additionalInfo && <div className="sm:col-span-2"><p className="eyebrow">{t("additionalInfo")}</p><p className="whitespace-pre-line">{nfe.additionalInfo}</p></div>}
        {nfe.cancelReason && <div className="sm:col-span-2"><p className="eyebrow">{t("cancelReason")}</p><p>{nfe.cancelReason}</p></div>}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-medium">{t("items")}</h2>
        <ul className="flex flex-col divide-y divide-border">
          {nfe.items.map((item) => (
            <li key={item.nItem} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <div className="min-w-0"><p>{item.description}</p><p className="font-mono text-[12px] text-text-4">{item.code} · NCM {item.ncm} · CFOP {item.cfop}</p></div>
              <p className="font-mono text-sm text-text-2">{Number(item.quantity)} {item.unit} × {money(item.unitPrice)} = {money(item.total)}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-medium">{t("documents")}</h2>
        <div className="flex flex-wrap gap-3">
          <Button disabled={!actions.download || busy} onClick={() => void run(async () => saveBlob(await nfeFile(id, "pdf"), `nfe-${nfe.number ?? id}.pdf`))}>DANFE (PDF)</Button>
          <Button disabled={!actions.download || busy} onClick={() => void run(async () => saveBlob(await nfeFile(id, "xml"), `nfe-${nfe.number ?? id}.xml`))}>XML</Button>
        </div>
        {!actions.download && <p className="text-sm text-text-3">{t("documentsHint")}</p>}
        {nfe.emailStatus && t.has(`email.${nfe.emailStatus}`) && <p className="text-sm text-text-3">{t(`email.${nfe.emailStatus}`)}</p>}
      </Card>

      <Card className="flex flex-col gap-5 p-5">
        <h2 className="font-medium">{t("events")}</h2>
        <NfeTimeline entries={timeline} />
      </Card>

      {cancelOpen && actions.cancel && <NfeCancelDialog nfe={nfe} open onClose={() => setCancelOpen(false)} onCancelled={() => { setCancelOpen(false); setNotice(t("cancelRequested")); setRevision((value) => value + 1); }} />}
      {correctOpen && actions.correct && <NfeCorrectionDialog nfe={nfe} open onClose={() => setCorrectOpen(false)} onCorrected={() => { setCorrectOpen(false); setNotice(t("correctionSent")); setRevision((value) => value + 1); }} />}
      <Modal open={discardOpen} onClose={() => { if (!busy) setDiscardOpen(false); }} title={t("discardTitle")}>
        <p className="mb-5 text-sm text-text-3">{t("discardWarning")}</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDiscardOpen(false)} disabled={busy}>{t("back")}</Button>
          <Button variant="danger" loading={busy} onClick={() => void run(() => discardNfe(id), t("discarded"))}>{t("discardConfirm")}</Button>
        </div>
      </Modal>
    </div>
  );
}
