"use client";

import { useLocale, useTranslations } from "next-intl";
import type { NfeTimelineEntry } from "@/lib/nfe";

/** The cancellation event of the SEFAZ; any other event shown here is a correction letter (110110). */
const CANCELLATION = "110111";

/** What happened to the note, oldest first: the states it went through and the fiscal events. */
export function NfeTimeline({ entries }: { entries: NfeTimelineEntry[] }) {
  const t = useTranslations("Nfe.timeline");
  const ts = useTranslations("Nfe.status");
  const locale = useLocale();
  const date = (value: string) => new Date(value).toLocaleString(locale === "pt" ? "pt-BR" : "en-US");
  if (entries.length === 0) return <p className="text-sm text-text-3">{t("empty")}</p>;
  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => {
        const last = index === entries.length - 1;
        const isEvent = entry.kind === "event";
        const title = isEvent
          ? entry.tpEvento === CANCELLATION ? t("cancellation") : t("correction", { sequence: entry.sequence ?? 1 })
          : ts.has(entry.status) ? ts(entry.status) : entry.status;
        const detail = isEvent ? (t.has(`eventStatus.${entry.status}`) ? t(`eventStatus.${entry.status}`) : entry.status) : null;
        return (
          <li key={`${entry.kind}-${entry.eventId ?? index}-${entry.at}`} className="relative flex gap-4 pb-6 last:pb-0">
            {!last && <span aria-hidden className="absolute left-[7px] top-5 h-[calc(100%-1.25rem)] w-px bg-border-strong" />}
            <span aria-hidden className={`relative mt-1 size-[15px] shrink-0 rounded-full border-2 border-bg ${isEvent ? "bg-info" : "bg-accent"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className={last ? "font-medium text-text" : "text-text-2"}>{title}</p>
                <time dateTime={entry.at} className="text-[12.5px] text-text-4">{date(entry.at)}</time>
              </div>
              {detail && <p className="text-sm text-text-3">{detail}</p>}
              {entry.xMotivo && <p className="text-sm text-text-3">{entry.cStat ? `${entry.cStat} · ` : ""}{entry.xMotivo}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
