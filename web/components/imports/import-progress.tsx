"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, PauseCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { credits, imports } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { percentDone } from "@/lib/imports";
import type { ImportJob } from "@/lib/types";
import { useCountUp } from "@/lib/use-count-up";
import { ImportLiveStatus } from "./import-live-status";

export type ImportLive = { updatedAt: number | null; changedAt: number | null; reconnecting: boolean };

/** Step four: the invoices going out, with the numbers moving while the page is open. */
export function ImportProgress({ job, onRefresh, onAnother, live }: { job: ImportJob; onRefresh: () => Promise<unknown>; onAnother: () => void; live?: ImportLive }) {
  const t = useTranslations("Imports");
  const locale = useLocale();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const { counters, id } = job;
  const waiting = counters.awaitingCredits;
  const done = job.status === "done" && waiting === 0;
  const paused = job.status === "done" && waiting > 0;
  const toEmit = Math.max(0, counters.total - counters.invalid);
  const final = percentDone(job);
  const flight = toEmit > 0 ? Math.min(100 - final, Math.round((counters.pending / toEmit) * 100)) : 0;
  const authorized = useCountUp(counters.authorized);
  const waitingShown = useCountUp(waiting);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" });
  // Counted in cents so the reais glide like the invoices do.
  const authorizedCents = useCountUp(Math.round(counters.authorizedAmount * 100));
  const pendingCents = useCountUp(Math.round(counters.pendingAmount * 100));
  const failedCents = useCountUp(Math.round(counters.failedAmount * 100));
  const running = job.status === "emitting";
  const amounts: Array<{ key: string; label: string; cents: number; tone: string }> = [
    { key: "authorized", label: t("progress.authorizedAmount"), cents: authorizedCents, tone: "text-text" },
    { key: "pending", label: t("progress.pendingAmount"), cents: pendingCents, tone: "text-text-2" },
    ...(counters.failedAmount > 0 ? [{ key: "failed", label: t("progress.failedAmount"), cents: failedCents, tone: "text-danger" }] : []),
  ];

  // The balance is read again whenever the person comes back to this tab (from Billing, after buying credits).
  const readBalance = useCallback(() => { credits.balance().then((b) => setBalance(b.balance)).catch(() => undefined); }, []);
  useEffect(() => {
    if (waiting === 0) return;
    readBalance();
    const onVisible = () => { if (document.visibilityState === "visible") readBalance(); };
    window.addEventListener("focus", readBalance);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", readBalance); document.removeEventListener("visibilitychange", onVisible); };
  }, [waiting, readBalance]);

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

  const stats: [string, number][] = [
    [t("progress.accepted"), counters.accepted],
    [t("progress.pending"), counters.pending],
    [t("progress.failed"), counters.failed],
    ...(waiting > 0 ? [[t("progress.awaiting"), waiting] as [string, number]] : []),
  ];
  const title = done ? t("progress.titleDone") : paused ? t("progress.titlePaused") : t("progress.titleRunning");
  const body = done ? t("progress.bodyDone") : paused ? t("progress.bodyPaused") : t("progress.bodyRunning");

  return (
    <div className="flex max-w-[680px] flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight text-text">{title}</h2>
          <p className="mt-1.5 text-[14.5px] text-text-3">{body}</p>
        </div>
        {running && live && <ImportLiveStatus updatedAt={live.updatedAt} changedAt={live.changedAt} reconnecting={live.reconnecting} />}
      </div>

      <div className="flex flex-col gap-4">
        <p data-testid="authorized-hero" className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-[64px] font-semibold leading-none tracking-tight tabular-nums text-text sm:text-[80px]">{authorized}</span>
          <span className="text-[15px] text-text-3">{t("progress.hero", { total: toEmit })}</span>
        </p>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={final} aria-label={t("progress.bar", { percent: final })} className="flex h-3 overflow-hidden rounded-full bg-track">
          <div data-testid="bar-final" className="h-full bg-accent transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${final}%` }} />
          <div data-testid="bar-flight" className="h-full bg-accent/35 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${flight}%` }} />
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[12.5px] text-text-3">{label}</dt>
              <dd className="text-[20px] font-medium tabular-nums text-text">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <section aria-label={t("progress.amountsLabel")} data-testid="amounts" className="grid gap-px overflow-hidden rounded-[14px] border border-border bg-border sm:grid-cols-3">
        {amounts.map((amount) => (
          <div key={amount.key} data-testid={`amount-${amount.key}`} className="flex flex-col gap-1.5 bg-surface px-5 py-4">
            <span className="text-[12.5px] text-text-3">{amount.label}</span>
            <span className={`font-mono text-[22px] font-medium leading-none tabular-nums tracking-tight ${amount.tone}`}>{money.format(amount.cents / 100)}</span>
          </div>
        ))}
      </section>

      {waiting > 0 && (
        <section role="status" aria-label={t("progress.awaiting")} className="flex flex-col gap-5 rounded-[14px] border-2 border-border-strong bg-active p-6 sm:p-8">
          <div>
            <p data-testid="waiting-hero" className="flex items-center gap-3 text-[44px] font-semibold leading-none tracking-tight tabular-nums text-text">
              <PauseCircle size={30} aria-hidden className="flex-none text-text-3" />{waitingShown}
            </p>
            <p className="mt-3 text-[15px] text-text">{t("progress.noCredits", { count: waiting })}</p>
            <p className="mt-1 text-[13.5px] text-text-3">{t("progress.waitingAmount", { amount: money.format(counters.awaitingAmount) })}</p>
            {balance !== null && <p className="mt-1 text-[13.5px] font-medium text-text">{t("progress.balance", { count: balance })}</p>}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link href="/app/billing" className="btn btn-secondary">{t("progress.buyCredits")}</Link>
            <Button variant="accent" loading={busy} onClick={reemit}>{t("progress.reemit", { count: waiting })}</Button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2.5">
        {job.status === "done" && <Link href="/app/invoices" className="btn btn-secondary">{t("progress.seeNotes")}</Link>}
        {counters.failed > 0 && <Button variant="secondary" onClick={downloadErrors}><Download size={15} aria-hidden />{t("progress.downloadErrors")}</Button>}
        {job.status === "done" && <Button variant="ghost" onClick={onAnother}>{t("progress.another")}</Button>}
      </div>
    </div>
  );
}
