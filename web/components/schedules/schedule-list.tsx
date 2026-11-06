"use client";

import { useLocale, useTranslations } from "next-intl";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatBRL } from "@/components/pricing/plan-picker";
import type { InvoiceSchedule, ScheduleStatus } from "@/lib/types";

const STATUS_VARIANT: Record<ScheduleStatus, BadgeVariant> = { active: "accent", paused: "warn", completed: "gray", cancelled: "gray" };

/** YYYY-MM-DD as the locale writes it, without going through Date (no time-zone shift). */
export function formatDay(day: string, locale: string): string {
  const [y, m, d] = day.slice(0, 10).split("-");
  return locale === "pt" ? `${d}/${m}/${y}` : `${m}/${d}/${y}`;
}

export type ScheduleAction = "pause" | "resume" | "cancel";

interface Props {
  schedules: InvoiceSchedule[];
  companyNames: Record<string, string>;
  canManage: boolean;
  /** Id and action in flight, to disable that row. */
  busy: { id: string; action: ScheduleAction } | null;
  onAction: (schedule: InvoiceSchedule, action: ScheduleAction) => void;
  /** Extra controls of a row (edit, history), added by the page. */
  renderExtra?: (schedule: InvoiceSchedule) => React.ReactNode;
}

export function ScheduleList({ schedules, companyNames, canManage, busy, onAction, renderExtra }: Props) {
  const t = useTranslations("Schedules");
  const locale = useLocale();
  return (
    <ul className="flex flex-col gap-3">
      {schedules.map((s) => {
        const amount = typeof s.invoice.amount === "number" ? formatBRL(Math.round(s.invoice.amount * 100)) : null;
        const rowBusy = busy?.id === s.id;
        const open = s.status === "active" || s.status === "paused";
        return (
          <li key={s.id} data-testid={`schedule-${s.id}`}>
            <Card className="flex flex-col gap-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-text">{companyNames[s.companyId] ?? t("unknownCompany")}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-3">
                    <span>{s.frequency ? t(`frequency.${s.frequency}`) : t("kind.once")}</span>
                    {amount && <span className="tabular-nums text-text-2">{amount}</span>}
                    {s.nextRunOn && <span>{t("nextRun", { date: formatDay(s.nextRunOn, locale) })}</span>}
                    {s.kind === "recurring" && <span>{s.endsOn ? t("untilDate", { date: formatDay(s.endsOn, locale) }) : t("noEnd")}</span>}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[s.status]}>{t(`status.${s.status}`)}</Badge>
              </div>
              {s.status === "paused" && <p className="text-[13px] text-warn">{s.pauseReason === "failures" ? t("pausedByFailures") : t("pausedByYou")}</p>}
              {s.status === "active" && s.attempts > 0 && <p className="text-[13px] text-warn">{t("failures", { count: s.attempts })}</p>}
              {canManage && open && (
                <div className="flex flex-wrap items-center gap-2">
                  {s.status === "active" && <Button variant="secondary" disabled={rowBusy} loading={rowBusy && busy?.action === "pause"} onClick={() => onAction(s, "pause")}>{t("actions.pause")}</Button>}
                  {s.status === "paused" && <Button variant="secondary" disabled={rowBusy} loading={rowBusy && busy?.action === "resume"} onClick={() => onAction(s, "resume")}>{t("actions.resume")}</Button>}
                  <Button variant="ghost" disabled={rowBusy} onClick={() => onAction(s, "cancel")}>{t("actions.cancel")}</Button>
                  {renderExtra?.(s)}
                </div>
              )}
              {(!canManage || !open) && renderExtra?.(s)}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
