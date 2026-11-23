"use client";

import Link from "next/link";
import { PauseCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import type { ImportJob } from "@/lib/types";
import type { RecentImportsState } from "@/lib/use-recent-imports";
import { useBillingEnabled } from "@/lib/deployment-config-context";
import { cn } from "@/lib/utils";

const href = (job: ImportJob) => `/app/invoices/import?id=${encodeURIComponent(job.id)}`;

/** On top of the upload: imports that stopped for lack of credits, with the way back in. */
export function PendingCreditsBanner({ recent }: { recent: RecentImportsState }) {
  const t = useTranslations("Imports");
  const locale = useLocale();
  const billingEnabled = useBillingEnabled();
  const waiting = recent.items.filter((job) => job.counters.awaitingCredits > 0);
  if (!billingEnabled || waiting.length === 0) return null;
  const notes = waiting.reduce((sum, job) => sum + job.counters.awaitingCredits, 0);
  const amount = waiting.reduce((sum, job) => sum + job.counters.awaitingAmount, 0);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(amount);
  return (
    <section data-testid="pending-credits-banner" className="flex max-w-[640px] flex-wrap items-center justify-between gap-4 rounded-[12px] border-2 border-border-strong bg-active p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <PauseCircle size={20} aria-hidden className="mt-0.5 flex-none text-text-3" />
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-text">{t("recent.pendingBanner", { count: waiting.length })}</p>
          <p className="mt-0.5 text-[13.5px] text-text-3">{t("recent.pendingHint", { notes, amount: money })}</p>
        </div>
      </div>
      <Link href={href(waiting[0]!)} className="btn btn-accent">{t("recent.continue")}</Link>
    </section>
  );
}

/** Earlier imports of this environment, always visible, so one can be reopened later. */
export function RecentImports({ recent }: { recent: RecentImportsState }) {
  const t = useTranslations("Imports");
  const locale = useLocale();
  const { fiscalEnvironment } = useAuth();
  const env = t(`recent.env_${fiscalEnvironment}`);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });

  const summary = (job: ImportJob): string => {
    const { counters } = job;
    if (job.status === "processing") return t("recent.reading");
    if (job.status === "failed") return t("recent.failed");
    if (job.status === "ready") return `${t("recent.ready")} · ${t("recent.rows", { count: counters.total })}`;
    if (job.status === "emitting") return `${t("recent.emitting")} · ${t("recent.authorized", { count: counters.authorized })}`;
    return [t("recent.authorized", { count: counters.authorized }), counters.failed > 0 ? t("recent.errors", { count: counters.failed }) : null].filter(Boolean).join(" · ");
  };

  return (
    <section aria-labelledby="recent-imports" className="flex max-w-[640px] flex-col gap-3">
      <h2 id="recent-imports" className="text-[15px] font-medium text-text">{t("recent.title")} · {env}</h2>
      {recent.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-border p-4 text-[14px] text-text-3">
          {t("recent.loadError")}
          <Button variant="secondary" size="sm" onClick={recent.reload}>{t("recent.retry")}</Button>
        </div>
      ) : recent.status === "loading" ? (
        <div className="skeleton h-[72px] rounded-[12px]" aria-hidden />
      ) : recent.items.length === 0 ? (
        <div className="rounded-[12px] border border-border p-4">
          <p className="text-[14px] text-text">{t("recent.empty", { env })}</p>
          <p className="mt-1 text-[13px] text-text-3">{t("recent.emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[12px] border border-border">
          {recent.items.map((job) => {
            const waiting = job.counters.awaitingCredits;
            return (
              <li key={job.id} className={cn("flex flex-wrap items-center justify-between gap-3 p-4", waiting > 0 && "bg-active")}>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-text">{job.fileName}</p>
                  <p className="text-[12.5px] text-text-3">{date.format(new Date(job.createdAt))} · {summary(job)}</p>
                  {waiting > 0 && <p className="mt-0.5 text-[12.5px] font-medium text-text">{t("recent.waiting", { count: waiting })}</p>}
                </div>
                <Link href={href(job)} className={cn("btn btn-sm", waiting > 0 ? "btn-accent" : "btn-secondary")}>
                  {waiting > 0 ? t("recent.continue") : t("recent.open")}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
