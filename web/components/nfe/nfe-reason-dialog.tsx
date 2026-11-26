"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export interface ReasonDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  label: string;
  submitLabel: string;
  min: number;
  max: number;
  danger?: boolean;
  /** Sends the text; throws when the API refuses (the dialog shows the translated reason and stays open). */
  onSubmit: (text: string) => Promise<void>;
}

/** A dialog that asks for a written reason (justification, correction text) and checks its length before sending. */
export function NfeReasonDialog({ open, onClose, title, description, label, submitLabel, min, max, danger, onSubmit }: ReasonDialogProps) {
  const t = useTranslations("Nfe.reason");
  const apiError = useApiErrorText();
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const length = text.trim().length;
  const valid = length >= min && length <= max;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!valid || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await onSubmit(text.trim()); }
    catch (cause) { setError(apiError(cause, t("failed"))); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title={title}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {description && <p className="text-sm text-text-3">{description}</p>}
        <Field label={label} hint={t("hint", { min, max })} error={touched && !valid ? t("length", { min, max }) : undefined} required>
          {(control) => <textarea {...control} className="field resize-y" rows={4} maxLength={max * 2} value={text} onChange={(event) => setText(event.target.value)} />}
        </Field>
        <p className="text-right font-mono text-[11.5px] text-text-4" aria-live="off">{length}/{max}</p>
        {error && <p role="alert" className="banner banner-danger">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t("back")}</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy}>{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
