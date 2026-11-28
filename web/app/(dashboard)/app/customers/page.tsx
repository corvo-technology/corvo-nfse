"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Contact } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableSkeleton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { customers as customersApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/i18n-helpers";
import { maskState, maskTaxId, maskZip } from "@/lib/masks";
import type { CustomerAddress, SavedCustomer } from "@/lib/types";
import { useApiErrorText } from "@/lib/use-api-error";

const PAGE_SIZE = 50;
const TYPING_PAUSE_MS = 300;

/** What the person edits of a customer; the address is text until it is sent. */
const emptyForm = { name: "", email: "", zip: "", street: "", number: "", complement: "", district: "", city: "", state: "", cityCode: "", indIeDest: "" as "" | "1" | "2" | "9", stateRegistration: "" };
const formOf = (c: SavedCustomer): typeof emptyForm => ({
  name: c.name, email: c.email ?? "", zip: maskZip(c.address?.zip ?? ""), street: c.address?.street ?? "", number: c.address?.number ?? "", complement: c.address?.complement ?? "",
  district: c.address?.district ?? "", city: c.address?.city ?? "", state: c.address?.state ?? "", cityCode: c.address?.cityCode ?? "",
  indIeDest: c.indIeDest ? (String(c.indIeDest) as "1" | "2" | "9") : "", stateRegistration: c.stateRegistration ?? "",
});
/** The address of the form: null when all of it is empty, undefined while it is half filled. */
function addressOf(f: typeof emptyForm): CustomerAddress | null | undefined {
  const a = { street: f.street.trim(), number: f.number.trim(), complement: f.complement.trim() || null, district: f.district.trim(), zip: f.zip.replace(/\D/g, ""), cityCode: f.cityCode.trim(), city: f.city.trim(), state: f.state.trim().toUpperCase() };
  if (!a.street && !a.number && !a.district && !a.zip && !a.cityCode && !a.city && !a.state && !a.complement) return null;
  return a.street && a.number && a.district && a.city && /^\d{8}$/.test(a.zip) && /^\d{7}$/.test(a.cityCode) && /^[A-Z]{2}$/.test(a.state) ? a : undefined;
}

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
  const [form, setForm] = useState(emptyForm);
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
    setForm(formOf(customer));
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
      const address = addressOf(form);
      const indIeDest = form.indIeDest ? (Number(form.indIeDest) as 1 | 2 | 9) : null;
      const stateRegistration = form.stateRegistration.trim() || null;
      if (address === undefined) { setFormError(t("edit.addressIncomplete")); setSaving(false); return; }
      const updated = await customersApi.update(editing.taxId, {
        name, email: form.email.trim() || null,
        // Only what changed from what is saved: an address left empty is not sent for a customer that has none.
        ...(address || editing.address ? { address } : {}),
        ...(indIeDest !== (editing.indIeDest ?? null) ? { indIeDest } : {}),
        ...(stateRegistration !== (editing.stateRegistration ?? null) ? { stateRegistration } : {}),
      });
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
          <fieldset className="grid items-start gap-3 sm:grid-cols-6">
            <legend className="mb-1 text-[13px] text-text-3">{t("edit.addressTitle")}</legend>
            <Field className="sm:col-span-2" label={t("edit.zip")} optionalLabel={t("edit.optional")}>{(c) => <Input {...c} inputMode="numeric" autoComplete="off" placeholder="01001-000" value={form.zip} onChange={(event) => setForm((f) => ({ ...f, zip: maskZip(event.target.value) }))} />}</Field>
            <Field className="sm:col-span-3" label={t("edit.street")} optionalLabel={t("edit.optional")}>{(c) => <Input {...c} maxLength={60} value={form.street} onChange={(event) => setForm((f) => ({ ...f, street: event.target.value }))} />}</Field>
            <Field className="sm:col-span-1" label={t("edit.number")} optionalLabel={t("edit.optional")}>{(c) => <Input {...c} maxLength={60} value={form.number} onChange={(event) => setForm((f) => ({ ...f, number: event.target.value }))} />}</Field>
            <Field className="sm:col-span-3" label={t("edit.complement")} optionalLabel={t("edit.optional")}>{(c) => <Input {...c} maxLength={60} value={form.complement} onChange={(event) => setForm((f) => ({ ...f, complement: event.target.value }))} />}</Field>
            <Field className="sm:col-span-3" label={t("edit.district")} optionalLabel={t("edit.optional")}>{(c) => <Input {...c} maxLength={60} value={form.district} onChange={(event) => setForm((f) => ({ ...f, district: event.target.value }))} />}</Field>
            <Field className="sm:col-span-3" label={t("edit.city")} optionalLabel={t("edit.optional")}>{(c) => <Input {...c} maxLength={60} value={form.city} onChange={(event) => setForm((f) => ({ ...f, city: event.target.value }))} />}</Field>
            <Field className="sm:col-span-1" label={t("edit.state")} optionalLabel={t("edit.optional")}>{(c) => <Input {...c} maxLength={2} placeholder="SP" value={form.state} onChange={(event) => setForm((f) => ({ ...f, state: maskState(event.target.value) }))} />}</Field>
            <Field className="sm:col-span-2" label={t("edit.cityCode")} optionalLabel={t("edit.optional")} hint={t("edit.cityCodeHint")}>{(c) => <Input {...c} inputMode="numeric" maxLength={7} placeholder="3550308" value={form.cityCode} onChange={(event) => setForm((f) => ({ ...f, cityCode: event.target.value.replace(/\D/g, "") }))} />}</Field>
            <Field className="sm:col-span-3" label={t("edit.indIeDest")} optionalLabel={t("edit.optional")}>
              {(c) => (
                <Select {...c} value={form.indIeDest} onChange={(event) => setForm((f) => ({ ...f, indIeDest: event.target.value as typeof emptyForm.indIeDest }))}>
                  <option value="">—</option>
                  <option value="9">{t("edit.ie9")}</option>
                  <option value="1">{t("edit.ie1")}</option>
                  <option value="2">{t("edit.ie2")}</option>
                </Select>
              )}
            </Field>
            <Field className="sm:col-span-3" label={t("edit.stateRegistration")} optionalLabel={t("edit.optional")}>{(c) => <Input {...c} maxLength={20} autoComplete="off" value={form.stateRegistration} onChange={(event) => setForm((f) => ({ ...f, stateRegistration: event.target.value }))} />}</Field>
          </fieldset>
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
