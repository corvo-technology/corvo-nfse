"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { imports } from "@/lib/api";
import type { ImportJob } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Earlier imports, so one can be reopened later, for example to continue after topping up credits. */
export function RecentImports() {
  const t = useTranslations("Imports");
  const locale = useLocale();
  const [items, setItems] = useState<ImportJob[]>([]);

  useEffect(() => {
    const abort = new AbortController();
    imports.list(10, abort.signal).then(setItems).catch(() => undefined);
    return () => abort.abort();
  }, []);

  if (items.length === 0) return null;
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
    <section aria-labelledby="recent-imports" className="flex max-w-[620px] flex-col gap-3">
      <h2 id="recent-imports" className="text-[15px] font-medium text-text">{t("recent.title")}</h2>
      <ul className="flex flex-col divide-y divide-border rounded-[12px] border border-border">
        {items.map((job) => {
          const waiting = job.counters.awaitingCredits;
          return (
            <li key={job.id} className={cn("flex flex-wrap items-center justify-between gap-3 p-4", waiting > 0 && "bg-active")}>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-text">{job.fileName}</p>
                <p className="text-[12.5px] text-text-3">{date.format(new Date(job.createdAt))} · {summary(job)}</p>
                {waiting > 0 && <p className="mt-0.5 text-[12.5px] font-medium text-text">{t("recent.waiting", { count: waiting })}</p>}
              </div>
              <Link href={`/app/invoices/import?id=${encodeURIComponent(job.id)}`} className={cn("btn btn-sm", waiting > 0 ? "btn-accent" : "btn-secondary")}>
                {waiting > 0 ? t("recent.continue") : t("recent.open")}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
