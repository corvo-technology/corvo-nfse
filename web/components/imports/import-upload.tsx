"use client";

import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { ApiError, companies, imports } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import type { Company, ImportStart } from "@/lib/types";

const MAX_BYTES = 10 * 1024 * 1024;

/** Step one: pick the spreadsheet (and, if wanted, the company that issues the rows without a CNPJ). */
export function ImportUpload({ onStarted }: { onStarted: (start: ImportStart) => void }) {
  const t = useTranslations("Imports");
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [options, setOptions] = useState<Company[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    companies.list({ limit: 100 }, abort.signal).then((page) => setOptions(page.items)).catch(() => undefined);
    return () => abort.abort();
  }, []);

  const pick = (next: File | null) => {
    setError(null);
    if (!next) return setFile(null);
    if (!/\.(csv|xlsx)$/i.test(next.name)) { setFile(null); return setError(t("upload.fileInvalid")); }
    if (next.size > MAX_BYTES) { setFile(null); return setError(t("upload.tooLarge")); }
    setFile(next);
  };

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
    <form onSubmit={send} className="flex max-w-[620px] flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-[12px] border border-dashed border-border-strong p-6">
        <label htmlFor="import-file" className="flex items-center gap-3 text-[15px] font-medium text-text">
          <FileSpreadsheet size={20} aria-hidden className="text-text-3" />
          {file ? file.name : t("upload.dropTitle")}
        </label>
        <input id="import-file" ref={input} type="file" accept=".csv,.xlsx" className="sr-only" aria-label={t("upload.dropTitle")} onChange={(event) => pick(event.target.files?.[0] ?? null)} />
        <p className="text-[13px] text-text-3">{t("upload.dropHint")}</p>
        <div className="flex flex-wrap gap-2.5">
          <Button variant="secondary" onClick={() => input.current?.click()}><Upload size={15} aria-hidden />{file ? t("upload.change") : t("upload.choose")}</Button>
          <Button variant="ghost" onClick={downloadTemplate}>{t("upload.template")}</Button>
        </div>
      </div>

      <Field label={t("upload.companyLabel")} hint={t("upload.companyHint")}>
        {(control) => (
          <select {...control} className="field" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="">{t("upload.companyAuto")}</option>
            {options.map((company) => <option key={company.id} value={company.id}>{company.legalName}</option>)}
          </select>
        )}
      </Field>

      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div><Button type="submit" variant="accent" loading={busy} disabled={!file || busy}>{t("upload.send")}</Button></div>
    </form>
  );
}
