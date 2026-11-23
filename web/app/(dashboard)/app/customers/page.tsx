"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Contact } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableSkeleton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { customers as customersApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/i18n-helpers";
import { maskTaxId } from "@/lib/masks";
import type { SavedCustomer } from "@/lib/types";
import { useApiErrorText } from "@/lib/use-api-error";

const PAGE_SIZE = 50;
const TYPING_PAUSE_MS = 300;

/** Customers saved from accepted invoices. Here the person corrects a name or forgets a customer. */
export default function CustomersPage() {
  const t = useTranslations("Customers");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const apiError = useApiErrorText();
  const { can, fiscalEnvironment } = useAuth();
  const canEdit = can("nfse.invoices.issue");

  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<SavedCustomer[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedCustomer | null>(null);
  const [form, setForm] = useState({ name: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SavedCustomer | null>(null);
  const [revision, setRevision] = useState(0);

  // The search runs when the typing stops, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    customersApi.list({ limit: PAGE_SIZE, ...(term ? { search: term } : {}) }, controller.signal)
      .then((page) => { setRows(page.items); setNextCursor(page.hasMore ? page.nextCursor : null); setError(null); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(apiError(cause, t("loadFailed"))); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // The saved customers belong to the environment in use: reload when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, fiscalEnvironment, revision]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await customersApi.list({ limit: PAGE_SIZE, cursor: nextCursor, ...(term ? { search: term } : {}) });
      setRows((current) => [...current, ...page.items]);
      setNextCursor(page.hasMore ? page.nextCursor : null);
    } catch (cause) { setError(apiError(cause, t("loadFailed"))); }
    finally { setLoadingMore(false); }
  }, [nextCursor, term, apiError, t]);

  function openEdit(customer: SavedCustomer) {
    setForm({ name: customer.name, email: customer.email ?? "" });
    setFormError(null);
    setEditing(customer);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const name = form.name.trim();
    if (!name) { setFormError(t("edit.nameRequired")); return; }
    setSaving(true);
    try {
      const updated = await customersApi.update(editing.taxId, { name, email: form.email.trim() || null });
      setRows((current) => current.map((row) => (row.taxId === updated.taxId ? updated : row)));
      setEditing(null);
    } catch (cause) { setFormError(apiError(cause, t("edit.failed"))); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!removing) return;
    setSaving(true);
    try {
      await customersApi.remove(removing.taxId);
      setRemoving(null);
      setRevision((value) => value + 1);
    } catch (cause) { setError(apiError(cause, t("remove.failed"))); setRemoving(null); }
    finally { setSaving(false); }
  }

  const columns: Column<SavedCustomer>[] = [
    { id: "name", header: t("columns.name"), primary: true, cell: (c) => <span className="font-medium text-text">{c.name}</span> },
    { id: "taxId", header: t("columns.taxId"), cell: (c) => <span className="font-mono text-[13px] tabular-nums text-text-2">{maskTaxId(c.taxId)}</span> },
    { id: "email", header: t("columns.email"), hideOnMobile: true, cell: (c) => <span className="text-[13px] text-text-3">{c.email ?? "—"}</span> },
    { id: "lastUsed", header: t("columns.lastUsed"), cell: (c) => <span className="text-[13px] text-text-4">{formatDate(c.lastUsedAt, locale)}</span> },
    ...(canEdit ? [{
      id: "actions", header: t("columns.actions"), action: true, align: "right" as const,
      cell: (c: SavedCustomer) => (
        <span className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => openEdit(c)} aria-label={t("edit.open", { name: c.name })}>{t("edit.action")}</Button>
          <Button variant="ghost" onClick={() => setRemoving(c)} aria-label={t("remove.open", { name: c.name })}>{tc("delete")}</Button>
        </span>
      ),
    }] : []),
  ];

  const empty = !loading && rows.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Field label={t("search.label")}>
        {(c) => (
          <input {...c} type="search" className="field max-w-[420px]" placeholder={t("search.placeholder")} value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" spellCheck={false} />
        )}
      </Field>

      {error && <p role="alert" className="banner banner-danger">{error}</p>}

      {loading ? <DataTableSkeleton label={tc("loading")} /> : empty ? (
        <EmptyState
          icon={Contact}
          title={term ? t("empty.noMatch") : t("empty.title")}
          description={term ? undefined : t("empty.body")}
          action={term ? undefined : <Link href="/app/invoices/new" className="btn">{t("empty.action")}</Link>}
        />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} rowKey={(c) => c.taxId} caption={t("title")} />
          {nextCursor && <Button variant="ghost" onClick={() => void loadMore()} loading={loadingMore}>{t("loadMore")}</Button>}
        </>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={t("edit.title")}>
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
          <p className="font-mono text-[13px] tabular-nums text-text-3">{editing ? maskTaxId(editing.taxId) : ""}</p>
          <Field label={t("columns.name")} required error={formError ?? undefined}>
            {(c) => <input {...c} type="text" className="field" maxLength={300} value={form.name} onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))} autoComplete="off" required />}
          </Field>
          <Field label={t("columns.email")} optionalLabel={t("edit.optional")} hint={t("edit.emailHint")}>
            {(c) => <input {...c} type="email" inputMode="email" className="field" maxLength={255} value={form.email} onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))} autoComplete="off" spellCheck={false} />}
          </Field>
          <p className="text-[13px] text-text-3">{t("edit.note")}</p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{tc("cancel")}</Button>
            <Button type="submit" loading={saving}>{t("edit.save")}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title={t("remove.title")}>
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-text-2">{t("remove.body", { name: removing?.name ?? "" })}</p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setRemoving(null)}>{tc("cancel")}</Button>
            <Button variant="danger" onClick={() => void remove()} loading={saving}>{t("remove.confirm")}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
