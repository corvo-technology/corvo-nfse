"use client";

import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, UploadCloud, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { ApiError, companies, imports } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import type { Company, ImportStart } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";

const MAX_BYTES = 10 * 1024 * 1024;

const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Data lines of a csv (the header is not counted); null when the browser cannot read the file. */
async function countCsvRows(file: File): Promise<number | null> {
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
    return Math.max(0, text.split(/\r?\n/).filter((line) => line.trim() !== "").length - 1);
  } catch { return null; }
}

/** Step one: drop or pick the spreadsheet (and, if wanted, the company that issues the rows without a CNPJ). */
export function ImportUpload({ onStarted }: { onStarted: (start: ImportStart) => void }) {
  const t = useTranslations("Imports");
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const pickToken = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<number | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [options, setOptions] = useState<Company[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    companies.list({ limit: 100 }, abort.signal).then((page) => setOptions(page.items)).catch(() => undefined);
    return () => abort.abort();
  }, []);

  const pick = (next: File | null) => {
    const token = ++pickToken.current;
    setError(null); setRows(null);
    if (!next) return setFile(null);
    if (!/\.(csv|xlsx)$/i.test(next.name)) { setFile(null); return setError(t("upload.fileInvalid")); }
    if (next.size > MAX_BYTES) { setFile(null); return setError(t("upload.tooLarge")); }
    setFile(next);
    if (/\.csv$/i.test(next.name)) void countCsvRows(next).then((count) => { if (token === pickToken.current) setRows(count); });
  };

  // The whole page is the drop target: dropping anywhere works, and the zone lights up while a file is over the window.
  const pickRef = useRef(pick);
  useEffect(() => { pickRef.current = pick; });
  useEffect(() => {
    let depth = 0;
    const enter = (event: DragEvent) => { if (!isFileDrag(event)) return; depth += 1; setDragging(true); };
    const leave = (event: DragEvent) => { if (!isFileDrag(event)) return; depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false); };
    const over = (event: DragEvent) => { if (isFileDrag(event)) event.preventDefault(); };
    const drop = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault(); depth = 0; setDragging(false);
      pickRef.current(event.dataTransfer?.files?.[0] ?? null);
    };
    window.addEventListener("dragenter", enter); window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragleave", leave); window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, []);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!file || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      onStarted(await imports.start(file, companyId || undefined));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t("upload.failed"));
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }

  async function downloadTemplate() {
    try { saveBlob(await imports.template(), "modelo-importacao.csv"); }
    catch { setError(t("upload.templateFailed")); }
  }

  return (
    <form onSubmit={send} className="flex max-w-[640px] flex-col gap-6">
      <div className={cn(
        "flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed p-8 text-center transition-colors duration-150",
        dragging ? "border-accent bg-active" : file ? "border-border-strong" : "border-border-strong hover:bg-active",
      )}>
        {file ? (
          <div className="flex w-full max-w-[440px] items-center gap-3 rounded-[10px] border border-border bg-bg p-3 text-left">
            <FileSpreadsheet size={22} aria-hidden className="flex-none text-text-3" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-medium text-text">{file.name}</p>
              <p className="text-[12.5px] text-text-3">{sizeLabel(file.size)}{rows !== null && <> · {t("upload.rows", { count: rows })}</>}</p>
            </div>
            <button type="button" aria-label={t("upload.remove")} onClick={() => { pick(null); if (input.current) input.current.value = ""; }} className="btn btn-ghost btn-sm"><X size={15} aria-hidden /></button>
          </div>
        ) : (
          <>
            <UploadCloud size={32} aria-hidden className={cn("transition-transform duration-150 motion-reduce:transition-none", dragging ? "-translate-y-1 text-accent" : "text-text-3")} />
            <p className="text-[17px] font-medium text-text">{dragging ? t("upload.dropActive") : t("upload.dropIdle")}</p>
            <p className="text-[13.5px] text-text-3">{t("upload.dropOr")}</p>
          </>
        )}
        <input id="import-file" ref={input} type="file" accept=".csv,.xlsx" className="sr-only" aria-label={t("upload.dropTitle")} onChange={(event) => pick(event.target.files?.[0] ?? null)} />
        <div className="flex flex-wrap justify-center gap-2.5">
          <Button variant={file ? "ghost" : "secondary"} onClick={() => input.current?.click()}>{file ? t("upload.change") : t("upload.choose")}</Button>
        </div>
        <p className="text-[12.5px] text-text-4">{t("upload.dropHint")}</p>
      </div>

      <Field label={t("upload.companyLabel")} hint={t("upload.companyHint")}>
        {(control) => (
          <Select {...control} value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="">{t("upload.companyAuto")}</option>
            {options.map((company) => <option key={company.id} value={company.id}>{company.legalName}</option>)}
          </Select>
        )}
      </Field>

      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="submit" variant="accent" size="lg" loading={busy} disabled={!file || busy} className="max-sm:w-full">{t("upload.send")}</Button>
        <button type="button" onClick={downloadTemplate} className="text-[13.5px] text-text-3 underline-offset-4 hover:text-text hover:underline">{t("upload.template")}</button>
      </div>
    </form>
  );
}
