"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableSkeleton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { collectAll, companies as companiesApi, productFavorites } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { importLocalProducts, filterProducts } from "@/lib/nfe-products";
import { maskNcm } from "@/lib/nfe-form";
import type { Company, ProductFavorite } from "@/lib/types";
import { useApiErrorText } from "@/lib/use-api-error";

/** The products saved for NF-e and NFC-e items, by company. Here the person looks for one or removes it. */
export default function ProductsPage() {
  const t = useTranslations("Products");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const apiError = useApiErrorText();
  const { can, fiscalEnvironment } = useAuth();
  const canEdit = can("nfe.documents.issue");
  const money = (value: number) => new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);

  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [rows, setRows] = useState<ProductFavorite[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ProductFavorite | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    collectAll((cursor) => companiesApi.list({ cursor, limit: 100 }, controller.signal))
      .then((list) => { setCompanies(list); setCompanyId((current) => current || list[0]?.id || ""); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setCompanies([]); setError(apiError(cause, t("loadFailed"))); } });
    return () => controller.abort();
    // The companies belong to the environment in use: reload when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiscalEnvironment]);

  useEffect(() => {
    if (!companyId) return;
    const controller = new AbortController();
    void (async () => {
      try { await importLocalProducts(companyId); } catch { /* kept in the browser: tried again next time */ }
      try {
        const list = await productFavorites.list(companyId, controller.signal);
        if (!controller.signal.aborted) { setRows(list); setError(null); }
      } catch (cause) { if (!controller.signal.aborted) { setRows([]); setError(apiError(cause, t("loadFailed"))); } }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await productFavorites.remove(companyId, removing.id);
      setRows((current) => (current ?? []).filter((row) => row.id !== removing.id));
      setRemoving(null);
    } catch (cause) { setError(apiError(cause, t("remove.failed"))); setRemoving(null); }
    finally { setBusy(false); }
  }

  const columns: Column<ProductFavorite>[] = [
    { id: "description", header: t("columns.description"), primary: true, cell: (p) => <span className="font-medium text-text">{p.description}</span> },
    { id: "code", header: t("columns.code"), hideOnMobile: true, cell: (p) => <span className="font-mono text-[13px] text-text-3">{p.code || "—"}</span> },
    { id: "ncm", header: t("columns.ncm"), hideOnMobile: true, cell: (p) => <span className="font-mono text-[13px] tabular-nums text-text-2">{maskNcm(p.ncm)}</span> },
    { id: "unitPrice", header: t("columns.unitPrice"), cell: (p) => <span className="text-[13px] tabular-nums text-text-2">{money(p.unitPrice)} / {p.unit}</span> },
    ...(canEdit ? [{
      id: "actions", header: t("columns.actions"), action: true, align: "right" as const,
      cell: (p: ProductFavorite) => <Button variant="ghost" onClick={() => setRemoving(p)} aria-label={t("remove.open", { name: p.description })}>{tc("delete")}</Button>,
    }] : []),
  ];

  const shown = filterProducts(rows ?? [], search);
  const loading = companies === null || (companyId !== "" && rows === null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {companies && companies.length > 1 && (
        <Field label={t("company")}>
          {(c) => (
            <Select {...c} className="max-w-[420px]" value={companyId} onChange={(event) => { setRows(null); setCompanyId(event.target.value); }}>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.tradeName || company.legalName}</option>)}
            </Select>
          )}
        </Field>
      )}

      <Field label={t("search.label")}>
        {(c) => <input {...c} type="search" className="field max-w-[420px]" placeholder={t("search.placeholder")} value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" spellCheck={false} />}
      </Field>

      {error && <p role="alert" className="banner banner-danger">{error}</p>}

      {loading ? <DataTableSkeleton label={tc("loading")} /> : shown.length === 0 ? (
        <EmptyState
          icon={Package}
          title={search ? t("empty.noMatch") : t("empty.title")}
          description={search ? undefined : t("empty.body")}
          action={search ? undefined : <Link href="/app/nfe/new" className="btn">{t("empty.action")}</Link>}
        />
      ) : (
        <DataTable columns={columns} rows={shown} rowKey={(p) => p.id} caption={t("title")} />
      )}

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title={t("remove.title")}>
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-text-2">{t("remove.body", { name: removing?.description ?? "" })}</p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setRemoving(null)}>{tc("cancel")}</Button>
            <Button variant="danger" onClick={() => void remove()} loading={busy}>{t("remove.confirm")}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
