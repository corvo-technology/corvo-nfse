"use client";

import { useRef, useState } from "react";
import { Eye, EyeOff, FileKey, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { ApiError, certificates } from "@/lib/api";
import { errorCodeKey } from "@/lib/api-errors";
import { useApiErrorText } from "@/lib/use-api-error";
import type { Certificate } from "@/lib/types";

const MAX_BYTES = 50 * 1024;

function friendlyError(cause: unknown, t: (key: string) => string, apiError: (error: unknown, fallback: string) => string): string {
  if (cause instanceof ApiError) {
    const message = cause.message.toLowerCase();
    const code = cause.code ? errorCodeKey(cause.code) : "";
    if (cause.status === 413) return t("certErr.tooLarge");
    if (code === "certificate_tax_id_mismatch") return t("certErr.mismatch");
    if (code === "certificate_expired") return t("certErr.expired");
    if (message.includes("does not match")) return t("certErr.mismatch");
    if (message.includes("expired")) return t("certErr.expired");
    if (message.includes("not yet valid")) return t("certErr.notYetValid");
    if (message.includes("invalid") || message.includes("password") || message.includes("pkcs")) return t("certErr.invalid");
  }
  return apiError(cause, t("failed"));
}

/** Uploads a PKCS#12 (.p12/.pfx) certificate for a company. */
export function CertificateUpload({ companyId, onUploaded }: { companyId: string; onUploaded: (certificate: Certificate) => void }) {
  const t = useTranslations("CompanyDetail");
  const apiError = useApiErrorText();
  const fileInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (next: File | null) => {
    setError(null);
    if (next && (next.size > MAX_BYTES || !/\.(p12|pfx)$/i.test(next.name))) {
      setFile(null);
      setError(t("certificateInvalid"));
      return;
    }
    setFile(next);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (inFlight.current) return;
    if (!file || !password) { setError(t("certificateRequired")); return; }
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("password", password);
      onUploaded(await certificates.create(companyId, body));
    } catch (cause) {
      setError(friendlyError(cause, t as unknown as (key: string) => string, apiError));
    } finally {
      inFlight.current = false; setBusy(false); setPassword("");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={busy}>
      <div
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); pick(event.dataTransfer.files?.[0] ?? null); }}
        className={`flex items-center gap-3.5 rounded-[12px] border border-dashed p-4 transition-colors ${dragging ? "border-accent bg-accent-surface" : file ? "border-accent-border bg-accent-surface" : "border-border-strong bg-bg"}`}
      >
        <span aria-hidden className={`flex h-10 w-10 flex-none items-center justify-center rounded-[10px] border ${file ? "border-accent-border text-accent" : "border-border-strong text-text-3"}`}>
          {file ? <ShieldCheck size={18} /> : <FileKey size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] text-text">{file ? file.name : t("dropTitle")}</p>
          <p className="text-[12.5px] text-text-4">{file ? `${(file.size / 1024).toFixed(1)} KiB` : t("certificateHint")}</p>
        </div>
        <Button variant="ghost" onClick={() => fileInput.current?.click()} disabled={busy}>{file ? t("changeFile") : t("chooseFile")}</Button>
        <input ref={fileInput} type="file" accept=".p12,.pfx" className="sr-only" tabIndex={-1} aria-label={t("file")} onChange={(event) => pick(event.target.files?.[0] ?? null)} />
      </div>

      <Field label={t("password")} required>
        {(props) => (
          <div className="relative">
            <input {...props} type={reveal ? "text" : "password"} autoComplete="off" spellCheck={false} disabled={busy} required className="field pr-11" value={password} onChange={(event) => setPassword(event.target.value)} />
            <button type="button" onClick={() => setReveal((v) => !v)} aria-label={reveal ? t("hidePassword") : t("showPassword")} aria-pressed={reveal} className="absolute inset-y-0 right-1 flex w-10 cursor-pointer items-center justify-center rounded-lg text-text-4 transition-colors hover:text-text">
              {reveal ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
            </button>
          </div>
        )}
      </Field>

      <p className="field-hint">{t("certificateMatch")}</p>
      {error && <p role="alert" className="banner banner-danger">{error}</p>}
      <Button type="submit" variant="accent" loading={busy} className="w-full sm:w-auto sm:self-end">{t("upload")}</Button>
    </form>
  );
}
