"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { invoices } from "@/lib/api";
import { SUBSTITUTION_DESCRIPTION_MAX, SUBSTITUTION_DESCRIPTION_MIN } from "@/lib/invoice-cancellation";
import type { Invoice } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useBillingEnabled } from "@/lib/deployment-config-context";
import { useApiErrorText } from "@/lib/use-api-error";

interface SubstituteInvoiceDialogProps {
  invoice: Invoice;
  open: boolean;
  onClose: () => void;
  onSubstituted: (substitute: Invoice) => void;
}

/**
 * Corrects an authorized invoice by issuing a substitute. Only the service description, the purchase order and
 * the notes can change: for MEI and Simples Nacional the customer, the competence date and the amount stay as issued.
 */
export function SubstituteInvoiceDialog({ invoice, open, onClose, onSubstituted }: SubstituteInvoiceDialogProps) {
  const t = useTranslations("InvoiceDetail.substitute");
  const billingEnabled = useBillingEnabled();
  const apiError = useApiErrorText();
  const service = invoice.serviceSnapshot;
  const [reason, setReason] = useState("");
  const [serviceDescription, setServiceDescription] = useState(service.description ?? "");
  const [purchaseOrder, setPurchaseOrder] = useState(service.purchaseOrder ?? "");
  const [notes, setNotes] = useState(service.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per dialog: a second click after a timeout repeats the same call instead of issuing two substitutes.
  const [key] = useState(() => `substitute-${invoice.id}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now()}`);
  const trimmed = reason.trim();
  const invalid = trimmed.length < SUBSTITUTION_DESCRIPTION_MIN || trimmed.length > SUBSTITUTION_DESCRIPTION_MAX || !serviceDescription.trim();

  /** Only what changed: an omitted field keeps the original, an empty text removes it. */
  function body() {
    const original = { description: service.description ?? "", purchaseOrder: service.purchaseOrder ?? "", notes: service.notes ?? "" };
    return {
      description: trimmed,
      ...(serviceDescription.trim() !== original.description ? { service: { description: serviceDescription.trim() } } : {}),
      ...(purchaseOrder.trim() !== original.purchaseOrder ? { purchaseOrder: purchaseOrder.trim() } : {}),
      ...(notes.trim() !== original.notes ? { notes: notes.trim() } : {}),
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (invalid || submitting) return;
    setSubmitting(true); setError(null);
    try { onSubstituted(await invoices.substitute(invoice.id, body(), key)); }
    catch (cause) { setError(apiError(cause, t("failed"))); }
    finally { setSubmitting(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("title")} wide>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-sm text-text-3">{t("intro")}</p>
        <p className="banner banner-warn text-[13px]">{t("locked")}</p>
        <Field label={t("reason")} hint={t("reasonHint", { min: SUBSTITUTION_DESCRIPTION_MIN })} required>
          {(c) => <textarea {...c} className="field resize-y" rows={2} maxLength={SUBSTITUTION_DESCRIPTION_MAX} value={reason} onChange={(event) => setReason(event.target.value)} required />}
        </Field>
        <Field label={t("serviceDescription")} required>
          {(c) => <textarea {...c} className="field resize-y" rows={3} value={serviceDescription} onChange={(event) => setServiceDescription(event.target.value)} required />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("purchaseOrder")} optionalLabel={t("optional")}>
            {(c) => <input {...c} type="text" className="field" maxLength={60} value={purchaseOrder} onChange={(event) => setPurchaseOrder(event.target.value)} autoComplete="off" />}
          </Field>
          <Field label={t("notes")} optionalLabel={t("optional")}>
            {(c) => <textarea {...c} className="field resize-y" rows={2} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} />}
          </Field>
        </div>
        {billingEnabled && <p className="text-[12.5px] text-text-4">{t("credit")}</p>}
        {error && <p role="alert" className="banner banner-danger">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>{t("keep")}</Button>
          <Button type="submit" loading={submitting} disabled={invalid}>{t("confirm")}</Button>
        </div>
      </form>
    </Modal>
  );
}
