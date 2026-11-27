"use client";

import { Select } from "@/components/ui/select";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ListChecks, Package, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { collectAll, companies as companiesApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { listNfe, listNfeAndNfce, NFE_STATUSES, type NfeDocument, type NfeKind, type NfeStatus } from "@/lib/nfe";
import { useCursorPagination } from "@/lib/use-cursor-pagination";
import type { Company } from "@/lib/types";
import { NfeStatusBadge } from "@/components/nfe/nfe-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, DataTableSkeleton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/** Notes of goods (NF-e): newest first, filtered by company and state. */
export default function NfeListPage() {
  const t = useTranslations("Nfe");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const { can } = useAuth();
  const [model, setModel] = useState<NfeKind | "all">("nfe");
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState<NfeStatus | "">("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const { items, loading, loadingMore, hasMore, error, loadMore } = useCursorPagination(
    (cursor, signal) => {
      const params = { limit: 50, cursor, ...(companyId ? { companyId } : {}), ...(status ? { status } : {}) };
      return model === "all" ? listNfeAndNfce(params, signal) : listNfe({ ...params, type: model }, signal);
    },
    [companyId, status, model],
  );

  useEffect(() => {
    const abort = new AbortController();
    collectAll((cursor) => companiesApi.list({ cursor, limit: 100 }, abort.signal))
      .then((rows) => { if (!abort.signal.aborted) setCompanies(rows); })
      .catch(() => undefined);
    return () => abort.abort();
  }, []);

  const money = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL" });
  const companyName = (id: string) => { const found = companies.find((company) => company.id === id); return found ? (found.tradeName || found.legalName) : id.slice(0, 8); };
  const columns: Column<NfeDocument>[] = [
    {
      id: "recipient", header: t("table.recipient"), primary: true, className: "max-w-[320px]",
      cell: (nfe) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-text"><Link href={`/app/nfe/${nfe.id}`} className="hover:text-accent">{nfe.recipient?.name || t("table.consumerAnonymous")}</Link></span>
          {nfe.status === "rejected" && nfe.lastError ? <span className="truncate text-[12px] font-normal text-danger">{nfe.lastError.message}</span> : <span className="truncate font-mono text-[12px] font-normal text-text-4">{companyName(nfe.companyId)}</span>}
        </div>
      ),
    },
    { id: "model", header: t("table.model"), cell: (nfe) => <span className="text-[13px] text-text-3">{nfe.type === "nfce" ? "NFC-e" : "NF-e"}</span> },
    { id: "number", header: t("table.number"), align: "right", cell: (nfe) => <span className="font-mono text-[13px] text-text-3">{nfe.number ? `${nfe.number} / ${nfe.series}` : "—"}</span> },
    { id: "amount", header: t("table.amount"), align: "right", cell: (nfe) => <span className="font-mono text-[13px] text-text-2">{money.format(Number(nfe.totals.vNF))}</span> },
    { id: "status", header: t("table.status"), cell: (nfe) => <NfeStatusBadge status={nfe.status} /> },
    { id: "created", header: t("table.created"), align: "right", cell: (nfe) => <span className="text-[13px] text-text-3">{new Date(nfe.createdAt).toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US")}</span> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <Link href="/app/nfe/number-gaps" className="btn btn-secondary"><ListChecks size={15} aria-hidden />{t("gaps.open")}</Link>
            {can("nfe.documents.issue") && <Link href="/app/nfe/new" className="btn btn-accent"><Plus size={15} aria-hidden />{t("new.open")}</Link>}
          </>
        }
      />
      <p role="note" className="banner">{t("homologationNotice")}</p>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-text-3">
          <span>{t("filters.model")}</span>
          <Select value={model} onChange={(event) => setModel(event.target.value as NfeKind | "all")}>
            <option value="nfe">NF-e</option>
            <option value="nfce">NFC-e</option>
            <option value="all">{t("filters.allModels")}</option>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm text-text-3">
          <span>{t("filters.company")}</span>
          <Select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="">{t("filters.allCompanies")}</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.tradeName || company.legalName}</option>)}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm text-text-3">
          <span>{t("filters.status")}</span>
          <Select value={status} onChange={(event) => setStatus(event.target.value as NfeStatus | "")}>
            <option value="">{t("filters.allStatuses")}</option>
            {NFE_STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
          </Select>
        </label>
      </div>
      <Card className="overflow-hidden" aria-live="polite">
        {error !== null ? (
          <EmptyState tone="danger" icon={AlertTriangle} title={t("loadFailed")} />
        ) : loading ? (
          <DataTableSkeleton label={tc("loading")} rows={4} />
        ) : (items ?? []).length === 0 ? (
          <EmptyState icon={Package} title={t("empty")} />
        ) : (
          <DataTable columns={columns} rows={items ?? []} rowKey={(nfe) => nfe.id} caption={t("title")} />
        )}
      </Card>
      {hasMore && <Button loading={loadingMore} onClick={() => void loadMore()}>{t("loadMore")}</Button>}
    </div>
  );
}
