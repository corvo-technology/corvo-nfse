"use client";

import { Bot, Clock, Eye, FilePlus2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { McpConnection } from "@/lib/api";
import { timeAgo } from "@/lib/i18n-helpers";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SCOPE_ICONS = { "nfse:read": Eye, "nfse:write": FilePlus2 } as const;

/** Short date; the year only shows when it is not the current one. */
function shortDate(iso: string, locale: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

function ScopeChips({ scopes }: { scopes: string[] }) {
  const t = useTranslations("Agents.connections");
  return (
    <ul className="flex flex-wrap gap-1.5">
      {scopes.map((scope) => {
        const Icon = SCOPE_ICONS[scope as keyof typeof SCOPE_ICONS] ?? ShieldCheck;
        const full = t.has(`scopes.${scope}`) ? t(`scopes.${scope}`) : scope;
        const short = t.has(`scopesShort.${scope}`) ? t(`scopesShort.${scope}`) : scope;
        return (
          <li key={scope} title={full} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] text-text-2">
            <Icon size={12} className="text-text-3" aria-hidden />
            {short}
            <span className="sr-only">: {full}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Column template shared by the header and the rows; the last column holds the status and the action. */
export const CONNECTION_GRID = "@4xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_190px]";

export function ConnectionRow({ row, isAdmin, locale, onRevoke }: { row: McpConnection; isAdmin: boolean; locale: string; onRevoke: (row: McpConnection) => void }) {
  const t = useTranslations("Agents.connections");
  const tc = useTranslations("Common");
  const who = row.mine ? (isAdmin ? t("you") : null) : row.owner_email ? t("owner", { email: row.owner_email }) : null;
  const where = [row.tenant_name, who].filter(Boolean).join(" · ");
  return (
    <li className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-3 px-5 py-4 @4xl:items-center", CONNECTION_GRID, row.revoked && "opacity-60")}>
      <div className="order-1 flex min-w-0 items-center gap-3 @4xl:order-none">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-border bg-surface text-text-3"><Bot size={17} /></span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-medium">
            <span className="truncate">{row.client_name}</span>
            <Badge variant={row.environment === "live" ? "warn" : "gray"} dot={false}>{t(row.environment === "live" ? "envLive" : "envTest")}</Badge>
          </p>
          {where && <p className="truncate text-[12.5px] text-text-3">{where}</p>}
        </div>
      </div>

      <div className="order-3 col-span-2 @4xl:order-none @4xl:col-span-1"><ScopeChips scopes={row.scopes} /></div>

      <div className="order-4 col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] @4xl:order-none @4xl:col-span-1 @4xl:flex-col @4xl:items-start @4xl:gap-y-0.5">
        <p className={cn("flex items-center gap-1.5", row.last_used_at ? "text-text" : "text-text-3")}>
          <Clock size={12} className="text-text-4" aria-hidden />
          {row.last_used_at ? timeAgo(row.last_used_at, tc) : t("neverUsed")}
        </p>
        <p className="text-[12.5px] text-text-3">{t("usageCompact", { calls: row.tool_calls, invoices: row.invoices_issued })}</p>
        <p className="text-[12px] text-text-4">{t("connectedOn", { date: shortDate(row.granted_at, locale) })}</p>
      </div>

      <div className="order-2 flex items-center justify-end gap-3 @4xl:order-none">
        <Badge variant={row.revoked ? "gray" : "accent"}>{row.revoked ? t("revoked") : t("active")}</Badge>
        {!row.revoked && <Button variant="danger" size="sm" onClick={() => onRevoke(row)}>{t("revoke")}</Button>}
      </div>
    </li>
  );
}
