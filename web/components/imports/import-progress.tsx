"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { imports } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { LIMIT_CODES, percentDone } from "@/lib/imports";
import type { ImportJob } from "@/lib/types";

/** Step four: the invoices going out, with the numbers moving while the page is open. */
export function ImportProgress({ job, onRefresh, onAnother }: { job: ImportJob; onRefresh: () => Promise<unknown>; onAnother: () => void }) {
  const t = useTranslations("Imports");
  const toast = useToast();
  const [turnedAway, setTurnedAway] = useState(0);
  const [busy, setBusy] = useState(false);
  const { counters } = job;
  const done = job.status === "done";
  const percent = percentDone(job);
  const { id } = job;

  // Rows the plan limit stopped can be issued again after a top-up: look for them whenever the failures change.
  useEffect(() => {
    if (counters.failed === 0) return;
    const abort = new AbortController();
    imports.rows(id, { status: "rejected", limit: 200 }, abort.signal)
      .then((page) => setTurnedAway(page.items.filter((row) => row.errorCode && LIMIT_CODES.includes(row.errorCode)).length))
      .catch(() => undefined);
    return () => abort.abort();
  }, [id, counters.failed, job.status]);

  async function downloadErrors() {
    try { saveBlob(await imports.errorsCsv(id), "erros-importacao.csv"); }
    catch { toast.error(t("review.downloadFailed")); }
  }
  async function reemit() {
    if (busy) return;
    setBusy(true);
    try { await imports.emit(id); setTurnedAway(0); await onRefresh(); }
    catch { toast.error(t("progress.reemitFailed")); }
    finally { setBusy(false); }
  }

  const numbers: [string, number][] = [
    [t("progress.accepted"), counters.accepted],
    [t("progress.authorized"), counters.authorized],
    [t("progress.failed"), counters.failed],
    [t("progress.pending"), counters.pending],
  ];

  return (
    <div className="flex max-w-[620px] flex-col gap-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-text">{done ? t("progress.titleDone") : t("progress.titleRunning")}</h2>
        <p className="mt-1.5 text-[14.5px] text-text-3">{done ? t("progress.bodyDone") : t("progress.bodyRunning")}</p>
      </div>

      <div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("progress.bar", { percent })} className="h-2 overflow-hidden rounded-full bg-track">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 font-mono text-xs text-text-3">{t("progress.bar", { percent })}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {numbers.map(([label, value]) => (
          <div key={label} className="rounded-[10px] border border-border p-4">
            <dt className="text-[12.5px] text-text-3">{label}</dt>
            <dd className="mt-1 text-[26px] font-semibold tabular-nums text-text">{value}</dd>
          </div>
        ))}
      </dl>

      {turnedAway > 0 && (
        <div role="status" className="flex flex-col gap-3 rounded-[10px] border border-border-strong p-4">
          <p className="text-[14px] text-text">{t("progress.noCredits", { count: turnedAway })}</p>
          <div><Button variant="accent" loading={busy} onClick={reemit}>{t("progress.reemit")}</Button></div>
        </div>
      )}

      <div className="flex flex-wrap gap-2.5">
        {done && <Link href="/app/invoices" className="btn btn-accent">{t("progress.seeNotes")}</Link>}
        {counters.failed > 0 && <Button variant="secondary" onClick={downloadErrors}><Download size={15} aria-hidden />{t("progress.downloadErrors")}</Button>}
        {done && <Button variant="ghost" onClick={onAnother}>{t("progress.another")}</Button>}
      </div>
    </div>
  );
}
