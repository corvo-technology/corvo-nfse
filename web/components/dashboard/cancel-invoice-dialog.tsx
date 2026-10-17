"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { invoices } from "@/lib/api";
import { CANCELLATION_DESCRIPTION_MAX, CANCELLATION_DESCRIPTION_MIN } from "@/lib/invoice-cancellation";
import type { CancellationReasonCode, Invoice } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const REASONS: CancellationReasonCode[] = ["issue_error", "service_not_provided", "other"];

interface CancelInvoiceDialogProps {
  invoice: Invoice;
  open: boolean;
  onClose: () => void;
  onCancelled: (invoice: Invoice) => void;
}

/** Issued NFS-e need the Sefin justification (15–255 chars); queued ones are cancelled locally. */
export function CancelInvoiceDialog({ invoice, open, onClose, onCancelled }: CancelInvoiceDialogProps) {
  const t = useTranslations("InvoiceDetail.cancel");
  const fiscal = invoice.status === "authorized";
  const [reason, setReason] = useState<CancellationReasonCode>("issue_error");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = description.trim();
  const invalid = fiscal && (trimmed.length < CANCELLATION_DESCRIPTION_MIN || trimmed.length > CANCELLATION_DESCRIPTION_MAX);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (invalid || submitting) return;
    setSubmitting(true); setError(null);
    try { onCancelled(await invoices.cancel(invoice.id, { reason, description: trimmed || undefined })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("failed")); }
    finally { setSubmitting(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("title")}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-sm text-text-3">{t(fiscal ? "fiscalHint" : "queuedHint")}</p>
        <label className="flex flex-col gap-1.5 text-sm">
          {t("reason")}
          <select className="field" value={reason} onChange={(event) => setReason(event.target.value as CancellationReasonCode)}>
            {REASONS.map((code) => <option key={code} value={code}>{t(`reasons.${code}`)}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-1.5 text-sm">
          <label className="flex flex-col gap-1.5">
            {t("description")}
            <textarea className="field resize-y" rows={3} maxLength={CANCELLATION_DESCRIPTION_MAX} required={fiscal} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          {/* Outside the label so the field's accessible name stays "Justification". */}
          <span className="text-[12.5px] text-text-4">{t(fiscal ? "descriptionRequired" : "descriptionOptional")}</span>
        </div>
        {error && <p role="alert" className="banner banner-danger">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>{t("keep")}</Button>
          <Button type="submit" variant="danger" loading={submitting} disabled={invalid}>{t("confirm")}</Button>
        </div>
      </form>
    </Modal>
  );
}
