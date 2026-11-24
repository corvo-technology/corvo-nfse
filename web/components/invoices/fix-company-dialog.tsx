"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { CertificateUpload } from "@/components/dashboard/certificate-upload";
import { companies } from "@/lib/api";
import { maskDigits } from "@/lib/masks";
import { useApiErrorText } from "@/lib/use-api-error";
import type { Company } from "@/lib/types";

export type CompanyFix = "certificate" | "municipality_code";

/** Fixes what blocks the note (certificate, municipality code) without leaving the invoice form. */
export function FixCompanyDialog({ company, fixes, open, onClose, onFixed }: { company: Company; fixes: CompanyFix[]; open: boolean; onClose: () => void; onFixed: (company: Company) => void }) {
  const t = useTranslations("Invoices.fix");
  const apiError = useApiErrorText();
  const [code, setCode] = useState(company.municipalityCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() { onFixed(await companies.get(company.id)); }

  async function saveCode(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!/^\d{7}$/.test(code)) { setError(t("municipalityInvalid")); return; }
    setBusy(true); setError(null);
    try { await companies.update(company.id, { municipalityCode: code }); await refresh(); }
    catch (cause) { setError(apiError(cause, t("failed"))); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("title")}>
      <div className="flex flex-col gap-6">
        <p className="text-sm text-text-3">{t("intro")}</p>
        {fixes.includes("municipality_code") && (
          <form onSubmit={saveCode} className="flex flex-col gap-3" aria-busy={busy}>
            <Field label={t("municipalityCode")} hint={t("municipalityHint")} required>
              {(props) => <input {...props} type="text" inputMode="numeric" className="field font-mono tabular-nums" maxLength={7} value={code} onChange={(event) => setCode(maskDigits(7)(event.target.value))} disabled={busy} />}
            </Field>
            {error && <p role="alert" className="banner banner-danger">{error}</p>}
            <Button type="submit" variant="accent" loading={busy} className="sm:self-end">{t("save")}</Button>
          </form>
        )}
        {fixes.includes("certificate") && (
          <section className="flex flex-col gap-3">
            <h3 className="font-medium">{t("certificate")}</h3>
            <CertificateUpload companyId={company.id} onUploaded={() => void refresh().catch(() => onClose())} />
          </section>
        )}
      </div>
    </Modal>
  );
}
