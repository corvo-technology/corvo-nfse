"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, FileSpreadsheet, Plus } from "lucide-react";
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
import { INVOICE_ORIGINS, type InvoiceOriginKind } from "@/lib/invoice-origin";
import { SchedulePanel } from "@/components/schedules/schedule-panel";
import { ManualReviewActions } from "@/components/invoices/manual-review-actions";
import { InvoicePackageButton } from "@/components/invoices/invoice-package-button";

const FILTERS = ["all", "scheduled", "authorized", "processing", "manual_review", "rejected", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

export default function InvoicesPage() {
  return <Suspense><InvoicesList /></Suspense>;
}

function InvoicesList() {
  const t = useTranslations("Invoices");
  const tImports = useTranslations("Imports");
  const { can } = useAuth();
  const tCommon = useTranslations("Common");
  const params = useSearchParams();
  const [filter, setFilter] = useState<Filter>(() => { const asked = params.get("filter"); return FILTERS.includes(asked as Filter) ? (asked as Filter) : "all"; });
  // Where the note came from is filtered by the API, so older pages are not missed either.
  const [origin, setOrigin] = useState<InvoiceOriginKind | "">("");
  const tOrigin = useTranslations("InvoiceOrigin");
  // Manual review is read from the API so older invoices waiting for a decision are not missed.
  const reviewing = filter === "manual_review";
  const { items: invoices, loading, loadingMore, hasMore, error, loadMore, reload } = useCursorPagination(
    (cursor, signal) => invoicesApi.list({ limit: 50, cursor, ...(reviewing ? { status: "manual_review" as const } : {}), ...(origin ? { origin } : {}) }, signal),
    [reviewing, origin],
  );
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
          <>
            {can("nfse.invoices.view") && <InvoicePackageButton />}
            {can("nfse.invoices.issue") && (
            <>
              <Link href="/app/invoices/import" className="btn btn-secondary">
                <FileSpreadsheet size={15} aria-hidden />
                {tImports("openButton")}
              </Link>
              <Link href="/app/invoices/new" className="btn btn-accent">
                <Plus size={15} aria-hidden />
                {t("new")}
              </Link>
            </>
            )}
          </>
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

      <label className="flex items-center gap-2 text-sm text-text-3">
        <span>{tOrigin("filterLabel")}</span>
        <select value={origin} onChange={(e) => setOrigin(e.target.value as InvoiceOriginKind | "")} className="min-h-10 rounded-md border border-border bg-transparent px-3 text-[13px] text-text">
          <option value="">{tOrigin("all")}</option>
          {INVOICE_ORIGINS.map((o) => <option key={o} value={o}>{tOrigin(`kind.${o}`)}</option>)}
        </select>
      </label>

      {filter === "scheduled" && <SchedulePanel />}
      {reviewing && !loading && can("nfse.invoices.issue") && <ManualReviewActions invoiceIds={filtered.map((i) => i.id)} onDone={reload} />}
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
