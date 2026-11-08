"use client";

import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ImportJob } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ImportLiveStatus } from "./import-live-status";
import type { ImportLive } from "./import-progress";

/** The wait between sending the file and reviewing it, with the real advance: how many rows are already checked. */
export function ImportReading({ job, live }: { job: ImportJob | null; live?: ImportLive }) {
  const t = useTranslations("Imports");
  const total = job?.rowsExpected ?? null;
  const done = job?.counters.total ?? 0;
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const steps = [
    { label: t("reading.step1"), state: total === null ? "active" : "done" },
    { label: t("reading.step2"), state: total === null ? "todo" : "active" },
    { label: t("reading.step3"), state: "todo" },
  ] as const;

  return (
    <div role="status" className="flex max-w-[640px] flex-col gap-6 rounded-[14px] border border-border p-6 sm:p-8">
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight text-text">{t("reading.title")}</h2>
        {job && <p className="mt-1 truncate text-[13.5px] text-text-3">{t("reading.file", { name: job.fileName })}</p>}
      </div>
      {job && live && <ImportLiveStatus updatedAt={live.updatedAt} changedAt={live.changedAt} reconnecting={live.reconnecting} />}
      <ol className="flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.label} data-state={step.state} aria-current={step.state === "active" ? "step" : undefined} className={cn("flex items-center gap-3 text-[14.5px]", step.state === "todo" ? "text-text-4" : "text-text")}>
            <span aria-hidden className="flex h-5 w-5 flex-none items-center justify-center">
              {step.state === "done" ? <Check size={16} className="text-ok" /> : step.state === "active" ? <Loader2 size={16} className="text-text-3 motion-safe:animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-track" />}
            </span>
            {step.label}
          </li>
        ))}
      </ol>
      {total !== null && (
        <div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("reading.count", { done, total })} className="h-2 overflow-hidden rounded-full bg-track">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 font-mono text-xs text-text-3">{t("reading.count", { done, total })}</p>
        </div>
      )}
    </div>
  );
}
