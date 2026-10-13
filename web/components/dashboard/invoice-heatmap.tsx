"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Invoice } from "@/lib/types";

const INTENSITY_STOPS = [0.15, 0.35, 0.55, 0.75, 0.95];

interface InvoiceHeatmapProps {
  invoices: Invoice[];
  days: number;
  locale: string;
}

function getIntensity(count: number, max: number): number {
  if (count === 0 || max === 0) return 0;
  const ratio = count / max;
  if (ratio >= 0.8) return 0.95;
  if (ratio >= 0.6) return 0.75;
  if (ratio >= 0.4) return 0.55;
  if (ratio >= 0.2) return 0.35;
  return 0.15;
}

interface HeatmapCell {
  date: Date;
  count: number;
  inRange: boolean;
}

function buildHeatmapGrid(invoices: Invoice[], days: number): HeatmapCell[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Align start to Monday so rows are Mon→Sun
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - days + 1);
  const dayOfWeek = (startDate.getDay() + 6) % 7; // 0 = Monday
  startDate.setDate(startDate.getDate() - dayOfWeek);

  // Count authorized invoices per day
  const buckets = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status !== "authorized" || !inv.authorizedAt) continue;
    const d = new Date(inv.authorizedAt);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const rangeStart = new Date(today);
  rangeStart.setDate(today.getDate() - days + 1);

  const totalDays = days + dayOfWeek;
  const weeksCount = Math.ceil(totalDays / 7);

  const grid: HeatmapCell[][] = [];
  for (let w = 0; w < weeksCount; w++) {
    const col: HeatmapCell[] = [];
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(startDate.getDate() + w * 7 + d);
      const key = cellDate.toISOString().slice(0, 10);
      const count = buckets.get(key) ?? 0;
      const inRange = cellDate >= rangeStart && cellDate <= today;
      col.push({ date: cellDate, count, inRange });
    }
    grid.push(col);
  }
  return grid;
}

export function InvoiceHeatmap({ invoices, days, locale }: InvoiceHeatmapProps) {
  const t = useTranslations("Overview");
  const [tip, setTip] = useState<{ x: number; y: number; date: Date; count: number } | null>(null);

  const grid = useMemo(() => buildHeatmapGrid(invoices, days), [invoices, days]);

  const max = useMemo(() => Math.max(1, ...grid.flat().filter((c) => c.inRange).map((c) => c.count)), [grid]);
  const hasAnyData = grid.some((col) => col.some((c) => c.inRange && c.count > 0));

  const intl = locale === "pt" ? "pt-BR" : "en-US";
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(intl, { weekday: "short", month: "short", day: "numeric" }),
    [intl]
  );
  const dayLabels = useMemo(() => {
    const f = new Intl.DateTimeFormat(intl, { weekday: "short" });
    const mon = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      return f.format(d).slice(0, 3);
    });
  }, [intl]);

  const visibleDayIndices = [0, 2, 4];

  if (!hasAnyData) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-center text-[13px] text-text-4">
        {t("heatmap.empty")}
      </div>
    );
  }

  const showTip = (e: { clientX: number; clientY: number }, cell: HeatmapCell) =>
    setTip({ x: e.clientX, y: e.clientY, date: cell.date, count: cell.count });

  const activeCells = grid.flat().filter((c) => c.inRange && c.count > 0);

  return (
    <div className="relative">
      <div className="overflow-x-auto pb-1">
        <div role="img" aria-label={t("heatmap.aria")} className="flex w-max gap-2">
          <div aria-hidden className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex h-[16px] items-center font-mono text-[10px] leading-[16px] text-text-4">
                {visibleDayIndices.includes(i) ? dayLabels[i] : ""}
              </div>
            ))}
          </div>

          <div aria-hidden className="flex gap-[3px]">
            {grid.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[3px]">
                {col.map((cell, ri) => {
                  const hasActivity = cell.count > 0;
                  const intensity = cell.inRange ? getIntensity(cell.count, max) : 0;
                  return (
                    <div
                      key={ri}
                      onPointerEnter={(e) => cell.inRange && showTip(e, cell)}
                      onPointerMove={(e) => cell.inRange && showTip(e, cell)}
                      onPointerDown={(e) => cell.inRange && showTip(e, cell)}
                      onPointerLeave={() => setTip(null)}
                      className={`h-[16px] w-[16px] rounded-[3px] transition-transform duration-150 ${
                        cell.inRange ? "cursor-pointer hover:scale-110" : "opacity-25"
                      }`}
                      style={{
                        backgroundColor: hasActivity ? `oklch(0.82 0.14 165 / ${intensity})` : "#0d0d0d",
                        border: hasActivity ? "none" : "1px solid #1a1a1a",
                        boxShadow: hasActivity ? `0 0 8px oklch(0.82 0.14 165 / ${intensity * 0.5})` : "none",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Same data for screen readers */}
      <ul className="sr-only">
        {activeCells.map((c) => (
          <li key={c.date.toISOString()}>
            {dateFormatter.format(c.date)}: {t("heatmap.note", { count: c.count })}
          </li>
        ))}
      </ul>

      <div aria-hidden className="mt-4 flex items-center gap-2 font-mono text-[11px] text-text-4">
        <span>{t("heatmap.legendLess")}</span>
        <div className="flex gap-[3px]">
          {INTENSITY_STOPS.map((alpha, i) => (
            <div key={i} className="h-[12px] w-[12px] rounded-[2px]" style={{ backgroundColor: `oklch(0.82 0.14 165 / ${alpha})` }} />
          ))}
        </div>
        <span>{t("heatmap.legendMore")}</span>
      </div>

      {tip && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 rounded-md border border-border-strong bg-[#161616] px-2.5 py-1.5 shadow-xl"
          style={{
            left: Math.max(8, Math.min(tip.x + 12, (typeof window === "undefined" ? 9999 : window.innerWidth) - 150)),
            top: tip.y + 14,
            fontFamily: "var(--font-jetbrains-mono), monospace",
          }}
        >
          <div className="text-[11px] font-medium leading-tight text-text">{dateFormatter.format(tip.date)}</div>
          <div className="mt-1 text-[10.5px] leading-tight text-text-3">
            <span className="text-accent">{t("heatmap.note", { count: tip.count })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
