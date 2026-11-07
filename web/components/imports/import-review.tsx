"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Download, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ApiError, imports } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { rowFields, rowPatch, type RowFields } from "@/lib/imports";
import type { ImportJob, ImportRow } from "@/lib/types";
import { useCursorPagination } from "@/lib/use-cursor-pagination";
import { cn } from "@/lib/utils";

const PAGE = 50;
type Filter = "all" | "invalid";

interface Props {
  job: ImportJob;
  /** Id of an earlier import of the very same file, when there is one. */
  duplicateOf: string | null;
  /** Counters changed (a row was fixed): read the import again. */
  onChanged: () => Promise<unknown>;
  onEmitted: () => void;
  onDiscarded: () => void;
}

/** Step three: look at the rows, fix or download the ones with errors, then issue. All optional but "issue". */
export function ImportReview({ job, duplicateOf, onChanged, onEmitted, onDiscarded }: Props) {
  const t = useTranslations("Imports");
  const locale = useLocale();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState<"emit" | "discard" | null>(null);
  const inFlight = useRef(false);
  const { counters } = job;

  const list = useCursorPagination<ImportRow>(
    (cursor, signal) => imports.rows(job.id, { status: filter === "invalid" ? "invalid" : undefined, cursor, limit: PAGE }, signal),
    [job.id, filter],
  );
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" });

  const problem = (row: ImportRow) => rowProblem(row, t);

  async function run(kind: "emit" | "discard", action: () => Promise<unknown>, done: () => void, failure: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(kind);
    try { await action(); done(); }
    catch (cause) { toast.error(cause instanceof ApiError && cause.message ? cause.message : failure); }
    finally { inFlight.current = false; setBusy(null); }
  }

  async function downloadErrors() {
    try { saveBlob(await imports.errorsCsv(job.id), "erros-importacao.csv"); }
    catch { toast.error(t("review.downloadFailed")); }
  }

  const saved = (row: ImportRow) => {
    list.setItems((rows) => (rows ?? []).map((current) => (current.line === row.line ? row : current)));
    void onChanged();
    if (row.status === "valid") { setEditing(null); toast.success(t("edit.saved")); return false; }
    setEditing(row);
    return true;
  };

  const columns: Column<ImportRow>[] = [
    { id: "line", header: t("review.colLine"), cell: (r) => <span className="font-mono text-text-3">{r.line}</span> },
    { id: "customer", header: t("review.colCustomer"), primary: true, cell: (r) => rowFields(r).customerName || <span className="text-text-4">{t("review.noCustomer")}</span> },
    { id: "description", header: t("review.colDescription"), cell: (r) => rowFields(r).description || "—" },
    { id: "amount", header: t("review.colAmount"), align: "right", cell: (r) => { const n = Number(r.data.amount); return Number.isFinite(n) ? <span className="tabular-nums">{money.format(n)}</span> : <span className="text-text-3">{String(r.data.amount ?? "—")}</span>; } },
    {
      id: "status", header: t("review.colStatus"),
      cell: (r) => r.status === "invalid" || r.status === "rejected"
        ? <span className="flex items-start gap-1.5 text-danger"><AlertTriangle size={14} aria-hidden className="mt-0.5 flex-none" />{problem(r)}</span>
        : <span className="text-ok">{t("review.ok")}</span>,
    },
    { id: "fix", header: t("review.fix"), action: true, align: "right", cell: (r) => (r.status === "invalid" ? <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>{t("review.fix")}</Button> : null) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[15px] text-text">{t("review.summary", { total: counters.total, valid: counters.valid, invalid: counters.invalid })}</p>
      {duplicateOf && <p className="rounded-[10px] border border-border p-3 text-[13.5px] text-text-3">{t("review.duplicate")}</p>}

      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="accent" loading={busy === "emit"} disabled={counters.valid === 0 || busy !== null} onClick={() => run("emit", () => imports.emit(job.id), onEmitted, t("review.emitFailed"))}>
          {counters.valid === 0 ? t("review.emitNone") : t("review.emit", { count: counters.valid })}
        </Button>
        {counters.invalid > 0 && <Button variant="secondary" onClick={downloadErrors}><Download size={15} aria-hidden />{t("review.downloadErrors")}</Button>}
        {confirmDiscard ? (
          <span role="group" aria-label={t("review.discard")} className="flex items-center gap-2">
            <Button variant="danger" size="sm" loading={busy === "discard"} onClick={() => run("discard", () => imports.discard(job.id), onDiscarded, t("review.discardFailed"))}>{t("review.discard")}</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(false)}>{t("edit.cancel")}</Button>
          </span>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmDiscard(true)}><Trash2 size={15} aria-hidden />{t("review.discard")}</Button>
        )}
      </div>

      {editing && <RowEditor key={editing.line} row={editing} problem={editing.status === "invalid" ? problem(editing) : null} importId={job.id} onSaved={saved} onCancel={() => setEditing(null)} />}

      <div role="group" aria-label={t("review.table")} className="flex gap-2">
        {(["all", "invalid"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
            className={cn("btn btn-sm", filter === value ? "btn-primary" : "btn-secondary")}>
            {value === "all" ? t("review.filterAll") : t("review.filterInvalid")}
          </button>
        ))}
      </div>

      {list.items && list.items.length === 0 ? <p className="py-8 text-center text-[14px] text-text-3">{t("review.empty")}</p> : list.items && <DataTable columns={columns} rows={list.items} rowKey={(r) => String(r.line)} caption={t("review.table")} />}
      {list.hasMore && <div><Button variant="secondary" loading={list.loadingMore} onClick={() => void list.loadMore()}>{t("review.loadMore")}</Button></div>}
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations<"Imports">>;
/** The problem of a row in plain words: our wording for the codes we know, the API's message otherwise. */
function rowProblem(row: ImportRow, t: Translate): string {
  const key = `rowError.${row.errorCode}` as Parameters<Translate["has"]>[0];
  return row.errorCode && t.has(key) ? t(key as never) : row.errorMessage || t("rowError.fallback");
}

function RowEditor({ row, problem, importId, onSaved, onCancel }: { row: ImportRow; problem: string | null; importId: string; onSaved: (row: ImportRow) => boolean; onCancel: () => void }) {
  const t = useTranslations("Imports");
  const [fields, setFields] = useState<RowFields>(() => rowFields(row));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(problem);
  const set = (key: keyof RowFields) => (event: React.ChangeEvent<HTMLInputElement>) => setFields((current) => ({ ...current, [key]: event.target.value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const updated = await imports.updateRow(importId, row.line, rowPatch(fields));
      if (onSaved(updated)) setMessage(`${t("edit.stillInvalid")} ${rowProblem(updated, t)}`);
    } catch (cause) {
      setMessage(cause instanceof ApiError && cause.status === 409 ? t("edit.locked") : cause instanceof ApiError ? cause.message : t("edit.failed"));
    } finally { setBusy(false); }
  }

  const text = (key: keyof RowFields, label: string, optional = false, type = "text") => (
    <Field label={label} optionalLabel={optional ? t("edit.optional") : undefined}>
      {(control) => <Input {...control} type={type} value={fields[key]} onChange={set(key)} />}
    </Field>
  );

  return (
    <form onSubmit={save} className="flex flex-col gap-4 rounded-[12px] border border-border-strong p-5">
      <h2 className="text-[16px] font-semibold text-text">{t("edit.title", { line: row.line })}</h2>
      {message && <p role="alert" className="text-[13px] text-danger">{message}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {text("customerName", t("edit.customerName"), true)}
        {text("customerTaxId", t("edit.customerTaxId"), true)}
        {text("customerEmail", t("edit.customerEmail"), true)}
        {text("description", t("edit.description"))}
        {text("serviceCode", t("edit.serviceCode"), true)}
        {text("amount", t("edit.amount"))}
        {text("competenceDate", t("edit.competenceDate"), false, "date")}
      </div>
      <div className="flex gap-2.5">
        <Button type="submit" variant="accent" loading={busy}>{t("edit.save")}</Button>
        <Button variant="ghost" onClick={onCancel}>{t("edit.cancel")}</Button>
      </div>
    </form>
  );
}
