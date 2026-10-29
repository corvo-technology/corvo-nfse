"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BadgeDollarSign, Copy, FilePenLine, XCircle } from "lucide-react";
import { invoices } from "@/lib/api";
import { CANCELLATION_DESCRIPTION_MAX, CANCELLATION_DESCRIPTION_MIN } from "@/lib/invoice-cancellation";
import type { CancellationReasonCode, Invoice } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const CANCELLATION_OPTIONS: {
  id: "incorrect_data" | "duplicate_charge" | "service_not_provided" | "refund";
  reason: CancellationReasonCode;
  icon: typeof FilePenLine;
}[] = [
  { id: "incorrect_data", reason: "issue_error", icon: FilePenLine },
  { id: "duplicate_charge", reason: "issue_error", icon: Copy },
  { id: "service_not_provided", reason: "service_not_provided", icon: XCircle },
  { id: "refund", reason: "other", icon: BadgeDollarSign },
];

interface CancelInvoiceDialogProps {
  invoice: Invoice;
  open: boolean;
  onClose: () => void;
  onCancelled: (invoice: Invoice) => void;
}

/** Issued and being-issued NFS-e need the Sefin justification (15–255 chars); queued ones are cancelled locally. */
export function CancelInvoiceDialog({ invoice, open, onClose, onCancelled }: CancelInvoiceDialogProps) {
  const t = useTranslations("InvoiceDetail.cancel");
  const fiscal = invoice.status === "authorized" || invoice.status === "processing";
  const hint = invoice.status === "authorized" ? "fiscalHint" : invoice.status === "processing" ? "processingHint" : "queuedHint";
  const [selectedOption, setSelectedOption] = useState(CANCELLATION_OPTIONS[0]);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = description.trim();
  const invalid = fiscal && (trimmed.length < CANCELLATION_DESCRIPTION_MIN || trimmed.length > CANCELLATION_DESCRIPTION_MAX);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (invalid || submitting) return;
    setSubmitting(true); setError(null);
    try { onCancelled(await invoices.cancel(invoice.id, { reason: selectedOption.reason, description: trimmed || undefined })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("failed")); }
    finally { setSubmitting(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("title")}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-sm text-text-3">{t(hint)}</p>
        <fieldset className="border-0 p-0">
          <legend className="mb-2 text-sm font-medium text-text">{t("reason")}</legend>
          <div role="radiogroup" aria-label={t("reason")} className="grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2">
            {CANCELLATION_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = selectedOption.id === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setSelectedOption(option);
                    setDescription(t(`options.${option.id}.suggestedDescription`));
                  }}
                  className={`flex min-h-24 flex-col items-start gap-2 bg-surface p-3.5 text-left transition-colors ${selected ? "bg-danger-surface text-text" : "text-text-2 hover:bg-active"}`}
                >
                  <Icon size={17} className={selected ? "text-danger" : "text-text-3"} aria-hidden />
                  <span className="text-sm font-medium">{t(`options.${option.id}.title`)}</span>
                  <span className="text-[12.5px] leading-snug text-text-3">{t(`options.${option.id}.description`)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
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
