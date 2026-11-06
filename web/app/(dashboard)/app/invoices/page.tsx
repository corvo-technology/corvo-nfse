"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { invoices as invoicesApi } from "@/lib/api";
import { useCursorPagination } from "@/lib/use-cursor-pagination";
import { InvoiceTable } from "@/components/dashboard/invoice-table";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { isScheduled } from "@/lib/invoice-schedule";
import { SchedulePanel } from "@/components/schedules/schedule-panel";

const FILTERS = ["all", "scheduled", "authorized", "processing", "rejected", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

export default function InvoicesPage() {
  return <Suspense><InvoicesList /></Suspense>;
}

function InvoicesList() {
  const t = useTranslations("Invoices");
  const { can } = useAuth();
  const tCommon = useTranslations("Common");
  const params = useSearchParams();
  const [filter, setFilter] = useState<Filter>(() => { const asked = params.get("filter"); return FILTERS.includes(asked as Filter) ? (asked as Filter) : "all"; });
  const { items: invoices, loading, loadingMore, hasMore, error, loadMore } = useCursorPagination((cursor, signal) => invoicesApi.list({ limit: 50, cursor }, signal), []);
  const failed = error !== null;

  const all = invoices ?? [];
  const scheduled = all.filter((i) => isScheduled(i));
  const matches = (i: (typeof all)[number], f: Exclude<Filter, "all">) => (f === "scheduled" ? isScheduled(i) : !isScheduled(i) && i.status === f);
  const filtered = filter === "all" ? all : all.filter((i) => matches(i, filter));
  const countOf = (f: Exclude<Filter, "all">) => (f === "scheduled" ? scheduled.length : all.filter((i) => matches(i, f)).length);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          can("nfse.invoices.issue") && <Link href="/app/invoices/new" className="btn btn-accent">
            <Plus size={15} aria-hidden />
            {t("new")}
          </Link>
        }
      />

      <div
        role="group"
        aria-label={t("filterLabel")}
        className="dash-in dash-in-1 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f)}
              className={cn(
                "inline-flex min-h-10 flex-none cursor-pointer items-center gap-2 rounded-full border px-4 text-[13px] transition-colors",
                active ? "border-border-strong bg-active text-text" : "border-transparent text-text-3 hover:text-text"
              )}
            >
              {t(`filters.${f}`)}
              {f !== "all" && !loading && (
                <span className="font-mono text-[11px] text-text-4">{countOf(f)}</span>
              )}
            </button>
          );
        })}
      </div>

      {filter === "scheduled" && <SchedulePanel />}
      {(filter !== "scheduled" || scheduled.length > 0) && <p className="text-sm text-text-3">{t("loadedRecords", { count: all.length })}</p>}
      {(filter !== "scheduled" || scheduled.length > 0) && <Card className="dash-in dash-in-2 overflow-hidden" aria-live="polite">
        {failed ? (
          <EmptyState tone="danger" icon={AlertTriangle} title={t("loadFailed")} />
        ) : (
          <InvoiceTable invoices={filtered} loading={loading} emptyText={t("noInvoices")} timeAgoT={tCommon} />
        )}
      </Card>}
      {hasMore && <Button loading={loadingMore} onClick={() => void loadMore()}>{t("loadMore")}</Button>}
    </div>
  );
}
