"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, PauseCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { imports } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { percentDone } from "@/lib/imports";
import type { ImportJob } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Step four: the invoices going out, with the numbers moving while the page is open. */
export function ImportProgress({ job, onRefresh, onAnother }: { job: ImportJob; onRefresh: () => Promise<unknown>; onAnother: () => void }) {
  const t = useTranslations("Imports");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { counters, id } = job;
  const waiting = counters.awaitingCredits;
  const done = job.status === "done" && waiting === 0;
  const paused = job.status === "done" && waiting > 0;
  const percent = percentDone(job);

  async function downloadErrors() {
    try { saveBlob(await imports.errorsCsv(id), "erros-importacao.csv"); }
    catch { toast.error(t("review.downloadFailed")); }
  }
  async function reemit() {
    if (busy) return;
    setBusy(true);
    try { await imports.emit(id); await onRefresh(); }
    catch { toast.error(t("progress.reemitFailed")); }
    finally { setBusy(false); }
  }

  const numbers: [string, number, boolean][] = [
    [t("progress.accepted"), counters.accepted, false],
    [t("progress.authorized"), counters.authorized, false],
    [t("progress.pending"), counters.pending, false],
    [t("progress.failed"), counters.failed, false],
    ...(waiting > 0 ? [[t("progress.awaiting"), waiting, true] as [string, number, boolean]] : []),
  ];
  const title = done ? t("progress.titleDone") : paused ? t("progress.titlePaused") : t("progress.titleRunning");
  const body = done ? t("progress.bodyDone") : paused ? t("progress.bodyPaused") : t("progress.bodyRunning");

  return (
    <div className="flex max-w-[620px] flex-col gap-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-text">{title}</h2>
        <p className="mt-1.5 text-[14.5px] text-text-3">{body}</p>
      </div>

      <div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("progress.bar", { percent })} className="h-2 overflow-hidden rounded-full bg-track">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 font-mono text-xs text-text-3">{t("progress.bar", { percent })}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {numbers.map(([label, value, calm]) => (
          <div key={label} className={cn("rounded-[10px] border p-4", calm ? "border-border-strong bg-active" : "border-border")}>
            <dt className="text-[12.5px] text-text-3">{label}</dt>
            <dd className="mt-1 text-[26px] font-semibold tabular-nums text-text">{value}</dd>
          </div>
        ))}
      </dl>

      {waiting > 0 && (
        <div role="status" className="flex flex-col gap-3 rounded-[12px] border border-border-strong p-5">
          <p className="flex items-start gap-2 text-[14.5px] text-text"><PauseCircle size={18} aria-hidden className="mt-0.5 flex-none text-text-3" />{t("progress.noCredits", { count: waiting })}</p>
          <div className="flex flex-wrap gap-2.5">
            <Button variant="accent" loading={busy} onClick={reemit}>{t("progress.reemit", { count: waiting })}</Button>
            <Link href="/app/billing" className="btn btn-secondary">{t("progress.buyCredits")}</Link>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2.5">
        {job.status === "done" && <Link href="/app/invoices" className="btn btn-secondary">{t("progress.seeNotes")}</Link>}
        {counters.failed > 0 && <Button variant="secondary" onClick={downloadErrors}><Download size={15} aria-hidden />{t("progress.downloadErrors")}</Button>}
        {job.status === "done" && <Button variant="ghost" onClick={onAnother}>{t("progress.another")}</Button>}
      </div>
    </div>
  );
}
