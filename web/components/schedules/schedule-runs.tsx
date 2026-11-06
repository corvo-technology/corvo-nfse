"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { schedules as schedulesApi } from "@/lib/api";
import type { ScheduleRun } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/components/schedules/schedule-list";

/** The log of every attempt to run a schedule, newest first. */
export function ScheduleRuns({ scheduleId }: { scheduleId: string }) {
  const t = useTranslations("Schedules.runs");
  const locale = useLocale();
  const [runs, setRuns] = useState<ScheduleRun[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    controller.current = ctl;
    schedulesApi
      .runs(scheduleId, {}, ctl.signal)
      .then((page) => { if (!ctl.signal.aborted) { setRuns(page.items); setNext(page.hasMore ? page.nextCursor : null); } })
      .catch(() => { if (!ctl.signal.aborted) setFailed(true); });
    return () => ctl.abort();
  }, [scheduleId]);

  const loadMore = async () => {
    if (!next || !controller.current) return;
    setMore(true);
    try {
      const page = await schedulesApi.runs(scheduleId, { cursor: next }, controller.current.signal);
      setRuns((rows) => [...(rows ?? []), ...page.items]);
      setNext(page.hasMore ? page.nextCursor : null);
    } catch {
      setFailed(true);
    } finally {
      setMore(false);
    }
  };

  if (failed) return <p role="alert" className="text-[13px] text-warn">{t("loadFailed")}</p>;
  if (!runs) return <p className="text-[13px] text-text-3" aria-busy="true">…</p>;
  if (runs.length === 0) return <p className="text-[13px] text-text-3">{t("empty")}</p>;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-text-2">{t("title")}</h3>
      <ul className="divide-y divide-border overflow-hidden rounded-[10px] border border-border">
        {runs.map((run) => (
          <li key={run.id} data-testid="schedule-run" className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
            <Badge variant={run.outcome === "issued" ? "accent" : "danger"}>{t(run.outcome)}</Badge>
            <span className="text-text-2">{t("due", { date: formatDay(run.occurrenceOn, locale) })}</span>
            <span className="text-text-3">{t("ranOn", { date: formatDay(run.ranOn, locale) })}</span>
            <span className="text-text-3">{t("attempt", { n: run.attempt })}</span>
            {run.invoiceId ? (
              <Link href={`/app/invoices/${run.invoiceId}`} className="text-accent underline-offset-4 hover:underline">{t("viewNote")}</Link>
            ) : (
              <span className="min-w-0 text-warn">{run.errorMessage ?? run.errorCode}</span>
            )}
          </li>
        ))}
      </ul>
      {next && <div><Button variant="ghost" loading={more} onClick={() => void loadMore()}>{t("loadMore")}</Button></div>}
    </div>
  );
}
