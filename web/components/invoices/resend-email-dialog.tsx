"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { invoices } from "@/lib/api";
import { useApiErrorText } from "@/lib/use-api-error";

/** Sends the authorized note again by e-mail, to the customer's address or to another one. */
export function ResendEmailDialog({ invoiceId, defaultEmail, open, onClose, onSent }: { invoiceId: string; defaultEmail: string; open: boolean; onClose: () => void; onSent: () => void }) {
  const t = useTranslations("InvoiceDetail.resend");
  const toast = useToast();
  const apiError = useApiErrorText();
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setError(t("invalid")); return; }
    setBusy(true); setError(null);
    try {
      await invoices.email(invoiceId, crypto.randomUUID(), value === defaultEmail ? undefined : value);
      toast.success(t("sent", { email: value }));
      onSent();
    } catch (cause) {
      const message = apiError(cause, t("failed"));
      setError(message); toast.error(message);
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("title")}>
      <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={busy}>
        <Field label={t("email")} hint={t("hint")} required>
          {(props) => <input {...props} type="email" className="field" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />}
        </Field>
        {error && <p role="alert" className="banner banner-danger">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} disabled={busy}>{t("cancel")}</Button>
          <Button type="submit" variant="accent" loading={busy}>{t("send")}</Button>
        </div>
      </form>
    </Modal>
  );
}
