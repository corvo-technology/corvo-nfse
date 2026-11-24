"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Building2, Eye, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { CompanyForm } from "@/components/dashboard/company-form";
import { useAuth } from "@/lib/auth";
import { companies as companiesApi } from "@/lib/api";
import { useCursorPagination } from "@/lib/use-cursor-pagination";
import type { Company, CompanyStatus } from "@/lib/types";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, DataTableSkeleton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate } from "@/lib/i18n-helpers";

const STATUS_VARIANT: Record<CompanyStatus, BadgeVariant> = {
  ready: "accent",
  pending_setup: "info",
  blocked: "danger",
};

function formatCNPJ(taxId: string): string {
  return taxId.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

/** ?new=1 (from the getting-started banner) opens the form once; the param is dropped so refresh/back do not reopen it. */
function useOpenOnNewParam(allowed: boolean, open: () => void) {
  const router = useRouter();
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; });
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("new")) return;
    if (allowed) openRef.current();
    router.replace("/app/companies");
  }, [allowed, router]);
}

export default function CompaniesPage() {
  const router = useRouter();
  const t = useTranslations("Companies");
  const { can } = useAuth();
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const [showForm, setShowForm] = useState(false);
  const { items: companies, setItems: setCompanies, loading, loadingMore: moreLoading, hasMore, error, loadMore } = useCursorPagination((cursor, signal) => companiesApi.list({ limit: 50, cursor }, signal), []);
  const canManage = can("nfse.companies.manage");
  useOpenOnNewParam(canManage, () => setShowForm(true));
  const failed = error !== null;
  const moreFailed = false;

  const columns: Column<Company>[] = [
    {
      id: "name",
      header: t("table.name"),
      primary: true,
      cell: (c) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-text"><Link href={`/app/companies/${c.id}`} className="hover:text-accent">{c.tradeName || c.legalName}</Link></span>
          <span className="truncate text-[12px] font-normal text-text-4">{c.legalName}</span>
        </div>
      ),
    },
    {
      id: "taxId",
      header: t("table.taxId"),
      cell: (c) => <span className="font-mono text-[12.5px] text-text-3">{formatCNPJ(c.taxId)}</span>,
    },
    {
      id: "city",
      header: t("table.city"),
      cell: (c) => (
        <span className="text-[13px] text-text-3">
          {[c.address.city, c.address.state].filter(Boolean).join(", ") || "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: t("table.status"),
      cell: (c) => (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <Badge variant={STATUS_VARIANT[c.status]}>{t(`status.${c.status}`)}</Badge>
          {c.status === "pending_setup" && c.setupGaps && c.setupGaps.length > 0 && (
            <span className="text-[12px] font-normal text-text-4">{t("missing", { items: c.setupGaps.map((gap) => t(`gaps.${gap}`)).join(", ") })}</span>
          )}
        </div>
      ),
    },
    {
      id: "created",
      header: t("table.created"),
      hideOnMobile: true,
      cell: (c) => <span className="text-[13px] text-text-4">{formatDate(c.createdAt, locale)}</span>,
    },
    {
      id: "view",
      header: t("view"),
      action: true,
      align: "right",
      cell: (c) => (
        <Link
          href={`/app/companies/${c.id}`}
          aria-label={t("viewCompany", { name: c.tradeName || c.legalName })}
          title={t("view")}
          className="-my-1.5 inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-white/5 hover:text-text"
        >
          <Eye size={16} aria-hidden />
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          can("nfse.companies.manage") && <Button variant="accent" onClick={() => setShowForm(true)} aria-expanded={showForm} aria-controls="company-form">
            <Plus size={15} aria-hidden />
            {t("add")}
          </Button>
        }
      />

      <Modal open={showForm} onClose={() => setShowForm(false)} title={t("add")} wide>
        <CompanyForm
          onCancel={() => setShowForm(false)}
          onSave={async (input) => { if (!input.taxRegime || !input.taxId) throw new Error("taxRegime and taxId are required"); const created = await companiesApi.create({ ...input, taxRegime: input.taxRegime, taxId: input.taxId }); setCompanies((rows) => [created, ...(rows ?? [])]); return created; }}
          onFinish={(created) => { setShowForm(false); router.push(`/app/companies/${created.id}`); }}
        />
      </Modal>

      <Card className="dash-in dash-in-1 overflow-hidden" aria-live="polite">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3.5 sm:px-5">
          <h2 className="text-[14px] font-medium text-text">{t("listTitle")}</h2>
          {companies && <span className="font-mono text-[12px] text-text-4">{companies.length}</span>}
        </div>
        {loading ? (
          <DataTableSkeleton label={tCommon("loading")} />
        ) : failed ? (
          <EmptyState tone="danger" icon={AlertTriangle} title={t("loadFailed")} />
        ) : companies && companies.length === 0 ? (
          <EmptyState icon={Building2} title={t("empty")} />
        ) : (
          <DataTable columns={columns} rows={companies ?? []} rowKey={(c) => c.id} caption={t("title")} />
        )}
      </Card>
      {moreFailed && <p role="alert" className="text-danger">{t("loadFailed")}</p>}
      {hasMore && <Button loading={moreLoading} onClick={() => void loadMore()}>{tCommon("loadMore")}</Button>}
    </div>
  );
}
