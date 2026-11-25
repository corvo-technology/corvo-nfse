"use client";

import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { auditItemText, type AuditEvent } from "@/lib/audit";

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "há 6 h" in the page's locale. */
export function relativeTime(iso: string, locale: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.trunc(seconds / size), unit);
  }
  return formatter.format(seconds, "second");
}

export function AuditList({ events }: { events: AuditEvent[] }) {
  const t = useTranslations("Audit");
  const locale = useLocale();

  const columns: Column<AuditEvent>[] = [
    {
      id: "when",
      header: t("columns.when"),
      cell: (event) => (
        <span className="whitespace-nowrap text-text-3" title={new Date(event.occurredAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "medium" })}>
          {relativeTime(event.occurredAt, locale)}
        </span>
      ),
    },
    {
      id: "who",
      header: t("columns.who"),
      primary: true,
      cell: (event) => {
        if (event.actor.type === "system") return <span className="text-text-3">{t("system")}</span>;
        return (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-text">{event.actor.label}</span>
            {event.actor.type === "agent" && <Badge variant="info" dot={false}>{t("agentBadge")}</Badge>}
            {event.actor.type === "agent" && event.actor.onBehalfOf && <span className="text-text-3">{`· ${event.actor.onBehalfOf}`}</span>}
          </span>
        );
      },
    },
    {
      id: "action",
      header: t("columns.action"),
      // "invoice.issued" reads as the nested message path actions.invoice.issued.
      cell: (event) => <span>{t.has(`actions.${event.action}`) ? t(`actions.${event.action}`) : event.action}</span>,
    },
    {
      id: "item",
      header: t("columns.item"),
      cell: (event) => <span className="break-all text-text-2">{auditItemText(event, t)}</span>,
    },
  ];

  return <DataTable columns={columns} rows={events} rowKey={(event) => event.id} caption={t("caption")} />;
}
