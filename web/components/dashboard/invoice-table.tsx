"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Copy, Eye, FileText } from "lucide-react";
import type { Invoice } from "@/lib/types";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { DataTable, DataTableSkeleton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/lib/auth";
import { copyInvoiceHref } from "@/lib/invoice-copy";
import { timeAgo } from "@/lib/i18n-helpers";
import { formatScheduledDate, isScheduled } from "@/lib/invoice-schedule";
import { useInvoiceErrorText } from "@/lib/use-api-error";

type TimeAgoT = ReturnType<typeof import("next-intl").useTranslations>;

interface InvoiceTableProps {
  invoices: Invoice[];
  emptyText: string;
  loading?: boolean;
  maxRows?: number;
  timeAgoT: TimeAgoT;
}

const STATUS_VARIANT: Record<Invoice["status"], BadgeVariant> = {
  authorized: "accent",
  processing: "info",
  queued: "gray",
  rejected: "danger",
  reconciliation_required: "warn",
  retry_pending: "warn",
  manual_review: "warn",
  failed: "danger",
  cancelling: "warn",
  cancelled: "gray",
};

export function InvoiceTable({ invoices, emptyText, loading, maxRows, timeAgoT }: InvoiceTableProps) {
  const t = useTranslations("Invoices");
  const invoiceError = useInvoiceErrorText();
  const locale = useLocale();
  const { can } = useAuth();
  const rows = maxRows ? invoices.slice(0, maxRows) : invoices;

  if (loading) return <DataTableSkeleton label={timeAgoT("loading")} rows={maxRows ?? 4} />;
  if (rows.length === 0) return <EmptyState icon={FileText} title={emptyText} />;

  const currency = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: "BRL",
  });

  const columns: Column<Invoice>[] = [
    {
      id: "customer",
      header: t("table.customer"),
      primary: true,
      cell: (inv) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-text"><Link href={`/app/invoices/${inv.id}`} className="hover:text-accent">{inv.customerName || t("anonymousCustomer")}</Link></span>
          {(inv.status === "rejected" || inv.status === "failed") && (inv.lastErrorMessage || inv.lastErrorCode) ? (
            <span className="truncate text-[12px] font-normal text-danger">{invoiceError(inv.lastErrorCode, inv.lastErrorMessage)}</span>
          ) : (
            <span className="truncate font-mono text-[12px] font-normal text-text-4">
              {inv.externalId ?? inv.id.slice(0, 12)}
            </span>
          )}
        </div>
      ),
      className: "max-w-[320px]",
    },
    {
      id: "number",
      header: t("table.number"),
      align: "right",
      cell: (inv) => <span className="font-mono text-[13px] text-text-3">{inv.nfseNumber ?? "—"}</span>,
    },
    {
      id: "amount",
      header: t("table.amount"),
      align: "right",
      cell: (inv) => <span className="font-mono text-[13px] text-text-2">{currency.format(inv.amount)}</span>,
    },
    {
      id: "status",
      header: t("table.status"),
      cell: (inv) =>
        isScheduled(inv) ? (
          <div className="flex flex-col items-start gap-1">
            <Badge variant="info" dot={false}>
              <CalendarClock size={12} aria-hidden />
              {t("status.scheduled")}
            </Badge>
            <span className="text-[12px] text-text-3">{t("scheduledFor", { date: formatScheduledDate(inv.scheduledFor!, locale) })}</span>
          </div>
        ) : (
          <Badge variant={STATUS_VARIANT[inv.status]}>{t(`status.${inv.status}`)}</Badge>
        ),
    },
    {
      id: "created",
      header: t("table.created"),
      align: "right",
      cell: (inv) => <span className="text-[13px] text-text-3">{timeAgo(inv.createdAt, timeAgoT)}</span>,
    },
    ...(can("nfse.invoices.issue") ? [{
      id: "copy",
      header: t("copyAction"),
      action: true,
      align: "right" as const,
      cell: (inv: Invoice) => (
        <Link
          href={copyInvoiceHref(inv.id)}
          aria-label={t("copyInvoice", { name: inv.customerName || t("anonymousCustomer") })}
          title={t("copyAction")}
          className="-my-1.5 inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-white/5 hover:text-text"
        >
          <Copy size={16} aria-hidden />
        </Link>
      ),
    }] : []),
    {
      id: "view",
      header: t("view"),
      action: true,
      align: "right",
      cell: (inv) => (
        <Link
          href={`/app/invoices/${inv.id}`}
          aria-label={t("viewInvoice", { name: inv.customerName || t("anonymousCustomer") })}
          title={t("view")}
          className="-my-1.5 inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-white/5 hover:text-text"
        >
          <Eye size={16} aria-hidden />
        </Link>
      ),
    },
  ];

  return <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("title")} />;
}
