"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Info, Trash2 } from "lucide-react";
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
  const [filter, setFilter] = useState<Filter>(job.counters.invalid > 0 ? "invalid" : "all");
  const [flash, setFlash] = useState<number | null>(null);
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState<"emit" | "discard" | null>(null);
  const inFlight = useRef(false);
  const { counters } = job;

  const list = useCursorPagination<ImportRow>(
    (cursor, signal) => imports.rows(job.id, { status: filter === "invalid" ? "invalid" : undefined, cursor, limit: PAGE }, signal),
    [job.id, filter],
  );
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" });
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(timer);
  }, [flash]);

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
    if (row.status === "valid") { setEditing(null); setFlash(row.line); toast.success(t("edit.saved")); return false; }
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

  const stat = (testId: string, label: string, value: string, tone?: "danger") => (
    <div data-testid={testId} className="flex flex-col gap-0.5">
      <dt className="text-[12.5px] text-text-3">{label}</dt>
      <dd className={cn("text-[22px] font-semibold leading-none tracking-tight tabular-nums", tone === "danger" ? "text-danger" : "text-text")}>{value}</dd>
    </div>
  );
  const emptyText = filter === "invalid" ? t("review.noErrors") : t("review.noRows");

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t("review.total")} className="flex flex-col gap-3">
        <dl className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <div className="flex flex-col gap-1">
            <dt className="text-[12.5px] text-text-3">{t("review.total")}</dt>
            <dd className="text-[34px] font-semibold leading-none tracking-tight tabular-nums text-text sm:text-[40px]">{money.format(counters.validAmount)}</dd>
          </div>
          {stat("stat-ready", t("review.statReady"), String(counters.valid))}
          {stat("stat-errors", t("review.statErrors"), String(counters.invalid), counters.invalid > 0 ? "danger" : undefined)}
        </dl>
        <p className="text-[13px] text-text-3">{t("upload.rows", { count: counters.total })}</p>
        {job.unknownColumns.length > 0 && <p data-testid="ignored-columns" role="note" className="flex max-w-[640px] items-start gap-2 rounded-[10px] border border-border p-3 text-[13.5px] text-text-3"><Info size={15} aria-hidden className="mt-0.5 flex-none" />{t("review.ignoredColumns", { names: job.unknownColumns.join(", ") })}</p>}
        {duplicateOf && <p role="note" className="flex max-w-[640px] items-start gap-2 rounded-[10px] border border-border p-3 text-[13.5px] text-text-3"><Info size={15} aria-hidden className="mt-0.5 flex-none" />{t("review.duplicate")}</p>}
      </section>

      <section aria-labelledby="rows-title" className="flex flex-col gap-3">
        <h2 id="rows-title" className="sr-only">{t("review.listTitle")}</h2>
        <div data-testid="list-tools" className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label={t("review.table")} className="inline-flex rounded-[10px] border border-border p-0.5">
            {(["all", "invalid"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
                className={cn("flex items-center gap-2 rounded-[8px] px-3.5 py-1.5 text-[13.5px] transition-colors duration-150 motion-reduce:transition-none", filter === value ? "bg-active font-medium text-text" : "text-text-3 hover:text-text")}>
                {value === "all" ? t("review.filterAll") : t("review.filterInvalid")}
                <span className={cn("tabular-nums text-[12px]", value === "invalid" && counters.invalid > 0 ? "text-danger" : "text-text-4")}>{value === "all" ? counters.total : counters.invalid}</span>
              </button>
            ))}
          </div>
          {counters.invalid > 0 && <Button variant="ghost" size="sm" onClick={downloadErrors}><Download size={15} aria-hidden />{t("review.downloadErrors")}</Button>}
        </div>

        {list.items && list.items.length === 0 ? <p className="rounded-[12px] border border-border py-10 text-center text-[14px] text-text-3">{emptyText}</p> : list.items && (
          <div className="overflow-hidden rounded-[12px] border border-border">
            <DataTable
              columns={columns} rows={list.items} rowKey={(r) => String(r.line)} caption={t("review.table")}
              rowClassName={(r) => (r.line === flash ? "row-flash" : r.status === "invalid" || r.status === "rejected" ? "row-invalid" : undefined)}
              expandedKey={editing ? String(editing.line) : null}
              renderExpanded={(r) => <RowEditor key={r.line} row={r} problem={r.status === "invalid" ? problem(r) : null} importId={job.id} onSaved={saved} onCancel={() => setEditing(null)} />}
            />
          </div>
        )}
        {list.hasMore && <div><Button variant="secondary" loading={list.loadingMore} onClick={() => void list.loadMore()}>{t("review.loadMore")}</Button></div>}
      </section>

      <div data-testid="action-bar" className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-bg px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {confirmDiscard ? (
          <span role="group" aria-label={t("review.discard")} className="flex items-center gap-2">
            <Button variant="danger" size="sm" loading={busy === "discard"} onClick={() => run("discard", () => imports.discard(job.id), onDiscarded, t("review.discardFailed"))}>{t("review.discard")}</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(false)}>{t("edit.cancel")}</Button>
          </span>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(true)}><Trash2 size={14} aria-hidden />{t("review.discard")}</Button>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 max-sm:w-full">
        <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-text">
          <input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} disabled={busy !== null} className="h-4 w-4 flex-none accent-[var(--accent)]" />
          {t("review.sendEmail")}
        </label>
        <Button variant="accent" size="lg" loading={busy === "emit"} disabled={counters.valid === 0 || busy !== null} className="max-sm:w-full" onClick={() => run("emit", () => imports.emit(job.id, { sendEmail }), onEmitted, t("review.emitFailed"))}>
          {counters.valid === 0 ? t("review.emitNone") : t("review.emitWithAmount", { count: counters.valid, amount: money.format(counters.validAmount) })}
        </Button>
        </div>
      </div>
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
    <form onSubmit={save} className="flex flex-col gap-4">
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
