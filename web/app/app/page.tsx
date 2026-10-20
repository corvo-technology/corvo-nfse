"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { InvoiceTable } from "@/components/dashboard/invoice-table";
import { InvoiceHeatmap } from "@/components/dashboard/invoice-heatmap";
import { billing as billingApi, invoices as invoicesApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { BillingPlan } from "@/lib/types";
import type { InvoiceOverview, OverviewPeriod } from "@/lib/api";
import { AlertTriangle } from "lucide-react";

export default function OverviewPage() {
  const t = useTranslations("Overview");
  const { can, tenantId, fiscalEnvironment } = useAuth();
  const invoiceView = can("nfse.invoices.view");
  const billingView = can("billing.view");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const [period, setPeriod] = useState<OverviewPeriod>("7d");
  const scope = `${tenantId}:${fiscalEnvironment}`;
  const overviewKey = `${scope}:${period}`;
  const [overviewState, setOverviewState] = useState<{ key: string; data?: InvoiceOverview; error?: boolean } | null>(null);
  const [billingState, setBillingState] = useState<{ key: string; data?: BillingPlan; error?: boolean } | null>(null);
  const overview = overviewState?.key === overviewKey ? overviewState : null;
  const billing = billingState?.key === scope ? billingState : null;
  const loading = invoiceView && !overview;
  const billingLoading = billingView && !billing;
  const error = overview?.error;

  useEffect(() => {
    if (!invoiceView || !tenantId) return;
    const controller = new AbortController();
    invoicesApi.overview(period, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setOverviewState({ key: overviewKey, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setOverviewState({ key: overviewKey, error: true });
      });
    return () => controller.abort();
  }, [period, invoiceView, tenantId, overviewKey]);

  useEffect(() => {
    if (!billingView || !tenantId) return;
    let cancelled = false;
    billingApi.plan().then((data) => {
      if (!cancelled) setBillingState({ key: scope, data });
    }).catch(() => {
      if (!cancelled) setBillingState({ key: scope, error: true });
    });
    return () => { cancelled = true; };
  }, [billingView, tenantId, scope]);

  const counts = overview?.data?.counts;
  const used = billing?.data?.usage.creditsUsed ?? 0;
  const allowance = billing?.data?.usage.monthlyAllowance ?? 0;

  const kpis = [
    ...(invoiceView ? [
      { label: t("kpi.authorized"), value: counts?.authorized ?? "—", tone: "text-accent", loading },
      { label: t("kpi.rejected"), value: counts?.rejected ?? "—", tone: (counts?.rejected ?? 0) > 0 ? "text-danger" : "text-text", loading },
      { label: t("kpi.processing"), value: counts?.processing ?? "—", tone: "text-text", loading },
    ] : []),
    ...(billingView ? [{ label: t("kpi.credits"), value: billing?.error ? "—" : `${used}`, suffix: billing?.data ? `/${allowance}` : undefined, tone: "text-text", loading: billingLoading, hint: t("monthlyCycle") }] : []),
  ];

  const recent = overview?.data?.recentInvoices ?? [];
  const periodLabel = period === "7d" ? t("last7days") : t("last30days");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={periodLabel}
        actions={
          <>
            {invoiceView && <div role="group" aria-label={t("period")} className="flex rounded-[9px] border border-border-strong p-0.5">
              {(["7d", "30d"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={period === p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "min-h-9 flex-1 cursor-pointer rounded-[7px] px-3.5 text-[13px] transition-colors",
                    period === p ? "bg-active text-text" : "text-text-3 hover:text-text"
                  )}
                >
                  {p === "7d" ? t("days7") : t("days30")}
                </button>
              ))}
            </div>}
            {can("nfse.invoices.issue") && <Link href="/app/invoices/new" className="btn btn-accent">
              <Plus size={15} aria-hidden />
              {t("newInvoice")}
            </Link>}
          </>
        }
      />

      {error && (
        <div role="alert" className="banner banner-danger dash-in">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-none" />
          {t("loadFailed")}
        </div>
      )}

      {billing?.error && billingView && <div role="alert" className="banner banner-danger">{t("creditsLoadFailed")}</div>}
      {kpis.length > 0 && <section aria-label={t("title")} className="dash-in dash-in-1">
        <dl className={cn("grid overflow-hidden rounded-[12px] border border-border bg-surface", kpis.length === 4 ? "grid-cols-2 lg:grid-cols-4" : kpis.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1")}>
          {kpis.map((kpi, i) => (
            <div
              key={kpi.label}
              className={cn(
                "kpi-tile flex flex-col gap-2 p-4 sm:p-5",
                "border-border",
                kpis.length === 4 && i % 2 === 0 && "border-r",
                kpis.length === 4 && i < 2 && "border-b lg:border-b-0",
                kpis.length === 4 && i < 3 && "lg:border-r",
                kpis.length === 3 && i < 2 && "border-b sm:border-b-0 sm:border-r"
              )}
            >
              <dt className="eyebrow">{kpi.label}</dt>
              <dd className={cn("font-mono text-[32px] font-medium leading-none tracking-tight tabular-nums", kpi.tone)}>
                {kpi.loading ? (
                  <>
                    <Skeleton className="h-7 w-14" />
                    <span className="sr-only">{tc("loading")}</span>
                  </>
                ) : (
                  <>
                    {kpi.value}
                    {"suffix" in kpi && kpi.suffix && <span className="text-[16px] text-text-4">{kpi.suffix}</span>}
                  </>
                )}
              </dd>
              {"hint" in kpi && <p className="text-[11px] text-text-4">{kpi.hint}</p>}
            </div>
          ))}
        </dl>
      </section>}

      {invoiceView && <Card className="premium-card dash-in dash-in-2 p-5 sm:p-6">
        <div className="mb-7 flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow mb-1.5">{periodLabel}</p>
            <h2 className="text-[17px] font-medium tracking-tight">{t("invoicesPerDay")}</h2>
          </div>
          <span className="rounded-full border border-accent-border bg-accent-surface px-2.5 py-1 font-mono text-[12px] text-accent">{period === "7d" ? t("days7") : t("days30")}</span>
        </div>
        {loading ? (
          <Skeleton className="h-[240px]" />
        ) : (
          error ? <EmptyState tone="danger" icon={AlertTriangle} title={t("loadFailed")} /> :
          <InvoiceHeatmap dailyActivity={overview?.data?.dailyActivity ?? []} locale={locale} recentInvoices={recent} timezone={overview?.data?.timezone} />
        )}
      </Card>}

      {invoiceView && <Card className="dash-in dash-in-3 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <h2 className="text-[15px] font-medium">{t("recentInvoices")}</h2>
          <Link href="/app/invoices" className="rounded-md py-1 text-[13px] text-text-3 transition-colors hover:text-text">
            {t("viewAllInvoices")} →
          </Link>
        </div>
        <div className="border-t border-border">
          {error && !loading ? (
            <EmptyState tone="danger" icon={AlertTriangle} title={t("loadFailed")} />
          ) : (
            <InvoiceTable invoices={recent} loading={loading} emptyText={t("noData")} timeAgoT={tc} maxRows={5} />
          )}
        </div>
      </Card>}
    </div>
  );
}
