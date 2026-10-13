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
import type { BillingPlan, Invoice } from "@/lib/types";
import { AlertTriangle } from "lucide-react";

type Period = "7d" | "30d";

export default function OverviewPage() {
  const t = useTranslations("Overview");
  const { can } = useAuth();
  const invoiceView = can("nfse.invoices.view");
  const billingView = can("billing.view");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const [period, setPeriod] = useState<Period>("7d");
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [billing, setBilling] = useState<BillingPlan | null>(null);
  const [error, setError] = useState(false);
  const [loadedPeriod, setLoadedPeriod] = useState<Period | null>(null);
  const loading = loadedPeriod !== period;

  useEffect(() => {
    let cancelled = false;
    const from = new Date();
    from.setDate(from.getDate() - (period === "7d" ? 7 : 30));

    Promise.all([invoiceView ? invoicesApi.list({ from: from.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10), limit: 1000 }) : Promise.resolve({ items: [] as Invoice[], hasMore: false, nextCursor: null }), billingView ? billingApi.plan() : Promise.resolve(null)])
      .then(([invRes, billRes]) => {
        if (cancelled) return;
        setInvoices(invRes.items);
        setBilling(billRes);
        setError(false);
        setLoadedPeriod(period);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoadedPeriod(period);
      });
    return () => {
      cancelled = true;
    };
  }, [period, invoiceView, billingView]);

  const days = period === "7d" ? 7 : 30;
  const all = invoices ?? [];
  const count = (...s: Invoice["status"][]) => all.filter((i) => s.includes(i.status)).length;
  const used = billing?.usage.creditsUsed ?? 0;
  const allowance = billing?.usage.monthlyAllowance ?? 0;

  const kpis = [
    { label: t("kpi.authorized"), value: count("authorized"), tone: "text-accent" },
    { label: t("kpi.rejected"), value: count("rejected"), tone: count("rejected") > 0 ? "text-danger" : "text-text" },
    { label: t("kpi.processing"), value: count("processing", "queued"), tone: "text-text" },
    { label: t("kpi.credits"), value: `${used}`, suffix: `/${allowance}`, tone: "text-text" },
  ];

  const recent = [...all].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const periodLabel = period === "7d" ? t("last7days") : t("last30days");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={periodLabel}
        actions={
          <>
            <div role="group" aria-label={t("period")} className="flex rounded-[9px] border border-border-strong p-0.5">
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
            </div>
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

      <p className="text-sm text-text-3">{t("loadedRecords", { count: all.length })}</p>
      <section aria-label={t("title")} className="dash-in dash-in-1">
        <dl className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-border bg-surface lg:grid-cols-4">
          {kpis.map((kpi, i) => (
            <div
              key={kpi.label}
              className={cn(
                "flex flex-col gap-2 p-4 sm:p-5",
                i % 2 === 0 && "border-r border-border",
                i < 2 && "border-b border-border lg:border-b-0",
                i < 3 && "lg:border-r"
              )}
            >
              <dt className="eyebrow">{kpi.label}</dt>
              <dd className={cn("font-mono text-[28px] font-medium leading-none tracking-tight tabular-nums", kpi.tone)}>
                {loading ? (
                  <>
                    <Skeleton className="h-7 w-14" />
                    <span className="sr-only">{tc("loading")}</span>
                  </>
                ) : (
                  <>
                    {kpi.value}
                    {kpi.suffix && <span className="text-[16px] text-text-4">{kpi.suffix}</span>}
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <Card className="dash-in dash-in-2 p-4 sm:p-5">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium">{t("invoicesPerDay")}</h2>
          <span className="font-mono text-[12px] text-text-4">{period === "7d" ? t("days7") : t("days30")}</span>
        </div>
        {loading ? (
          <Skeleton className="h-[120px]" />
        ) : (
          <InvoiceHeatmap invoices={all} days={days} locale={locale} />
        )}
      </Card>

      <Card className="dash-in dash-in-3 overflow-hidden">
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
      </Card>
    </div>
  );
}
