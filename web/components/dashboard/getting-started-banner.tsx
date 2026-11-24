"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useGettingStarted } from "@/lib/use-getting-started";

/** One thin line: how many setup steps are done and only the next one. Hidden when everything is done. */
export function GettingStartedBanner() {
  const t = useTranslations("GettingStarted");
  const state = useGettingStarted();
  if (!state) return null;
  const { done, total, next, skipDps } = state;

  return (
    <div data-testid="getting-started" className="dash-in flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3.5 py-2 text-[13px]">
      <span className="flex items-center gap-2">
        <span className="h-1.5 w-10 overflow-hidden rounded-full bg-border-strong" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <span className="block h-full rounded-full bg-accent" style={{ width: `${(done / total) * 100}%` }} />
        </span>
        <span className="font-medium tabular-nums text-text-2">{t("progress", { done, total })}</span>
      </span>
      <span className="min-w-0 flex-1 text-text-3">{t("next", { step: t(`steps.${next.key}`) })}</span>
      {next.key === "dps" && (
        <button type="button" className="text-text-3 underline-offset-2 hover:text-text-2 hover:underline" onClick={skipDps}>{t("skip")}</button>
      )}
      <Link href={next.href} className="btn btn-sm btn-accent">
        {t("go")}
        <ArrowRight size={13} aria-hidden />
      </Link>
    </div>
  );
}
