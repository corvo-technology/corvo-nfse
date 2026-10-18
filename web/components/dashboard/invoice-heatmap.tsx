"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import type { InvoiceOverview } from "@/lib/api";
import { cn } from "@/lib/utils";

// Date-only API values stay in UTC for display so the browser's timezone cannot shift a day.
function calendarDate(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

function barStyle(count: number, max: number, index: number) {
  const ratio = count === 0 ? 0 : Math.max(0.06, count / max);
  return {
    height: count === 0 ? "3px" : `${Math.round(ratio * 100)}%`,
    animationDelay: `${index * 18}ms`,
  };
}

export function InvoiceHeatmap({
  dailyActivity,
  locale,
  recentInvoices = [],
  timezone = "UTC",
}: {
  dailyActivity: InvoiceOverview["dailyActivity"];
  locale: string;
  recentInvoices?: InvoiceOverview["recentInvoices"];
  timezone?: string;
}) {
  const t = useTranslations("Overview");
  const detailId = useId();
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const intl = locale === "pt" ? "pt-BR" : "en-US";
  const formatter = new Intl.DateTimeFormat(intl, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const weekdayFormatter = new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" });
  const dayFormatter = new Intl.DateTimeFormat(intl, { day: "numeric", timeZone: "UTC" });
  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });

  const max = Math.max(1, ...dailyActivity.map((day) => day.count));
  const total = dailyActivity.reduce((sum, day) => sum + day.count, 0);
  const average = dailyActivity.length ? total / dailyActivity.length : 0;
  const peak = dailyActivity.reduce<InvoiceOverview["dailyActivity"][number] | null>((best, day) => (!best || day.count > best.count ? day : best), null);
  const first = dailyActivity[0];
  const last = dailyActivity.at(-1);
  const dense = dailyActivity.length > 14;

  const activeDate = hoverDate ?? pinnedDate;
  const selected = dailyActivity.find((day) => day.date === activeDate);
  const delta = selected && average > 0 ? Math.round(((selected.count - average) / average) * 100) : null;
  const share = selected && total > 0 ? Math.round((selected.count / total) * 100) : null;
  const dayInvoices = selected
    ? recentInvoices.filter((invoice) => {
        const stamp = invoice.authorizedAt ?? invoice.createdAt;
        return stamp ? localDay.format(new Date(stamp)) === selected.date : false;
      })
    : [];

  function move(index: number, step: number) {
    const target = buttons.current[index + step];
    if (target) target.focus();
  }

  function clear() {
    setPinnedDate(null);
    setHoverDate(null);
  }

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-0">
        <div className="min-w-0 lg:pr-6">
          <div
            role="group"
            aria-label={t("heatmap.aria")}
            onPointerLeave={() => setHoverDate(null)}
            className={cn("relative flex h-44 items-end sm:h-52", dense ? "gap-[3px] sm:gap-1" : "gap-2 sm:gap-3")}
          >
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
            {average > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-accent/50"
                style={{ bottom: `${Math.min(100, (average / max) * 100)}%` }}
              >
                <span className="absolute -top-4 right-0 bg-surface pl-1.5 font-mono text-[10px] text-accent">
                  {t("heatmap.average")} {average.toFixed(average < 10 ? 1 : 0)}
                </span>
              </div>
            )}
            <span aria-hidden className="pointer-events-none absolute -top-0.5 left-0 -translate-y-full font-mono text-[10px] text-text-4">{max}</span>

            {dailyActivity.map((day, index) => {
              const description = `${formatter.format(calendarDate(day.date))}: ${t("heatmap.note", { count: day.count })}`;
              const isActive = activeDate === day.date;
              const isPinned = pinnedDate === day.date;
              const isPeak = peak?.date === day.date && day.count > 0;
              return (
                <button
                  key={day.date}
                  ref={(node) => { buttons.current[index] = node; }}
                  type="button"
                  aria-label={description}
                  aria-pressed={isPinned}
                  aria-describedby={isActive ? detailId : undefined}
                  onPointerEnter={() => setHoverDate(day.date)}
                  onFocus={() => setHoverDate(day.date)}
                  onBlur={() => setHoverDate(null)}
                  onClick={() => { setPinnedDate(isPinned ? null : day.date); setHoverDate(day.date); }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") clear();
                    else if (event.key === "ArrowRight") { event.preventDefault(); move(index, 1); }
                    else if (event.key === "ArrowLeft") { event.preventDefault(); move(index, -1); }
                  }}
                  className="group relative flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-x-0 inset-y-0 rounded-[6px] transition-colors",
                      isActive ? "bg-hover" : "group-hover:bg-hover"
                    )}
                  />
                  {isPeak && !dense && (
                    <span aria-hidden className="relative z-10 mb-1 self-center font-mono text-[10px] text-accent">{day.count}</span>
                  )}
                  <span
                    aria-hidden
                    style={barStyle(day.count, max, index)}
                    className={cn(
                      "bar-grow relative z-10 w-full rounded-t-[5px] transition-[background-color,box-shadow] duration-200 motion-reduce:transition-none",
                      day.count === 0 && "rounded-[2px]",
                      isActive
                        ? "bg-accent shadow-[0_0_24px_-2px_color-mix(in_oklch,var(--accent)_55%,transparent)]"
                        : day.count === 0
                          ? "bg-border-strong"
                          : "bg-[color-mix(in_oklch,var(--accent)_38%,var(--surface))] group-hover:bg-[color-mix(in_oklch,var(--accent)_70%,var(--surface))]"
                    )}
                  />
                </button>
              );
            })}
          </div>

          <div aria-hidden className={cn("mt-2 flex", dense ? "gap-[3px] sm:gap-1" : "gap-2 sm:gap-3")}>
            {dailyActivity.map((day, index) => {
              const showLabel = !dense || index % 5 === 0 || index === dailyActivity.length - 1;
              const isActive = activeDate === day.date;
              return (
                <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center leading-tight">
                  {!dense && (
                    <span className={cn("font-mono text-[10px] uppercase", isActive ? "text-accent" : "text-text-4")}>
                      {weekdayFormatter.format(calendarDate(day.date))}
                    </span>
                  )}
                  <span className={cn("font-mono text-[11px] tabular-nums", showLabel ? (isActive ? "text-accent" : "text-text-3") : "invisible")}>
                    {dayFormatter.format(calendarDate(day.date))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div
          id={detailId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="flex min-w-0 flex-col gap-4 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
        >
          <div>
            <p className="mb-2 flex items-center gap-2 text-[12px] text-text-3">
              {selected ? formatter.format(calendarDate(selected.date)) : t("heatmap.periodTotal")}
              {selected && pinnedDate === selected.date && (
                <span className="rounded-full border border-accent-border bg-accent-surface px-1.5 py-px font-mono text-[10px] text-accent">{t("heatmap.pinned")}</span>
              )}
            </p>
            <p key={selected?.date ?? "total"} className="bar-fade font-mono text-[40px] leading-none tracking-tight tabular-nums text-accent">
              {selected ? selected.count : total}
            </p>
            <p className="mt-2 text-[12px] text-text-4">{t("heatmap.authorizedNotes")}</p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-[12px]">
            {selected ? (
              <>
                <div>
                  <dt className="text-text-4">{t("heatmap.vsAverage")}</dt>
                  <dd className={cn("mt-0.5 font-mono tabular-nums", delta === null ? "text-text-3" : delta >= 0 ? "text-accent" : "text-text-3")}>
                    {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}%`}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-4">{t("heatmap.ofPeriod")}</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-text-3">{share === null ? "—" : `${share}%`}</dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt className="text-text-4">{t("heatmap.dailyAverage")}</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-text-3">{average.toFixed(average < 10 ? 1 : 0)}</dd>
                </div>
                <div>
                  <dt className="text-text-4">{t("heatmap.bestDay")}</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-text-3">
                    {peak && peak.count > 0 ? `${dayFormatter.format(calendarDate(peak.date))} · ${peak.count}` : "—"}
                  </dd>
                </div>
              </>
            )}
          </dl>

          {selected ? (
            <div className="border-t border-border pt-4">
              {dayInvoices.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {dayInvoices.slice(0, 3).map((invoice) => (
                    <li key={invoice.id}>
                      <Link href={`/app/invoices/${invoice.id}`} className="flex items-center justify-between gap-3 rounded-md py-0.5 text-[12px] text-text-3 transition-colors hover:text-text">
                        <span className="truncate">{invoice.customerName || t("heatmap.anonymous")}</span>
                        <ArrowRight size={12} aria-hidden className="flex-none text-text-4" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-text-4">{selected.count === 0 ? t("heatmap.quietDay") : t("heatmap.seeInList")}</p>
              )}
              {selected.count > 0 && (
                <Link href="/app/invoices" className="mt-3 inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
                  {t("viewAllInvoices")} <ArrowRight size={12} aria-hidden />
                </Link>
              )}
            </div>
          ) : (
            <p className="text-[12px] leading-relaxed text-text-4">{t("heatmap.hint")}</p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-[11px] text-text-4">
          {first && last ? `${formatter.format(calendarDate(first.date))} – ${formatter.format(calendarDate(last.date))}` : ""}
        </p>
        <p aria-hidden className="hidden items-center gap-1.5 text-[11px] text-text-4 sm:flex">
          <span className="inline-block h-px w-4 border-t border-dashed border-accent/60" /> {t("heatmap.average")}
        </p>
      </div>
      {total === 0 && <p className="mt-3 text-[12px] text-text-3">{t("heatmap.empty")}</p>}
    </div>
  );
}
