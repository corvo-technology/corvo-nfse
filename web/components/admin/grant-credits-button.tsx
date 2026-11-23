"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import { useBillingEnabled } from "@/lib/deployment-config-context";
import { platformAdmin } from "@/lib/platform-admin";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

const AMOUNT_MIN = 1;
const AMOUNT_MAX = 500;
const REASON_MIN = 5;
const REASON_MAX = 500;

type Step = "form" | "confirm" | "done";

interface GrantCreditsButtonProps {
  tenantId: string;
  email: string;
  onGranted: () => void;
}

/** Platform-admin action: gives extra invoices to a workspace. One idempotency key per modal opening. */
export function GrantCreditsButton({ tenantId, email, onGranted }: GrantCreditsButtonProps) {
  const t = useTranslations("Admin.grant");
  const apiError = useApiErrorText();
  const billingEnabled = useBillingEnabled();
  const idempotencyKey = useRef("");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [notifyUser, setNotifyUser] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ balance: number; replayed: boolean } | null>(null);

  if (!billingEnabled) return null;

  function openModal() {
    idempotencyKey.current = crypto.randomUUID();
    setStep("form"); setAmount(""); setReason(""); setNotifyUser(false);
    setAmountError(null); setReasonError(null); setError(null); setResult(null);
    setOpen(true);
  }

  const parsedAmount = Number(amount.trim());
  const amountValid = amount.trim() !== "" && Number.isInteger(parsedAmount) && parsedAmount >= AMOUNT_MIN && parsedAmount <= AMOUNT_MAX;
  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= REASON_MIN && trimmedReason.length <= REASON_MAX;

  function review(event: React.FormEvent) {
    event.preventDefault();
    setAmountError(amountValid ? null : t("errorAmount"));
    setReasonError(reasonValid ? null : t("errorReason"));
    if (amountValid && reasonValid) { setError(null); setStep("confirm"); }
  }

  async function send() {
    if (submitting) return;
    setSubmitting(true); setError(null);
    try {
      const granted = await platformAdmin.grantCredits(tenantId, { amount: parsedAmount, reason: trimmedReason, notifyUser }, idempotencyKey.current);
      setResult({ balance: granted.balance, replayed: granted.replayed });
      setStep("done");
      onGranted();
    } catch (cause) {
      setError(apiError(cause, cause instanceof ApiError && cause.status === 404 ? t("errorNotFound") : t("errorGeneric")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={openModal}>{t("title")}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("title")}>
        {step === "form" && (
          <form noValidate onSubmit={review} className="flex flex-col gap-4">
            <p className="text-sm text-text-3">{t("description")}</p>
            <Field label={t("amount")} hint={t("amountHint")} error={amountError ?? undefined} required>
              {(control) => <Input {...control} type="number" inputMode="numeric" min={AMOUNT_MIN} max={AMOUNT_MAX} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} />}
            </Field>
            <Field label={t("reason")} hint={t("reasonHint")} error={reasonError ?? undefined} required>
              {(control) => <textarea {...control} className="field resize-y" rows={3} maxLength={REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />}
            </Field>
            <label className="flex items-center gap-2 text-sm text-text-2">
              <input type="checkbox" checked={notifyUser} onChange={(event) => setNotifyUser(event.target.checked)} />
              {t("notify")}
            </label>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button>
              <Button type="submit">{t("submit")}</Button>
            </div>
          </form>
        )}
        {step === "confirm" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text">{t("confirm", { amount: parsedAmount, email })}</p>
            {error && <p role="alert" className="banner banner-danger">{error}</p>}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => { setError(null); setStep("form"); }} disabled={submitting}>{t("back")}</Button>
              <Button loading={submitting} onClick={() => void send()}>{submitting ? t("submitting") : t("submit")}</Button>
            </div>
          </div>
        )}
        {step === "done" && result && (
          <p role="status" className="text-sm text-text">{t(result.replayed ? "successReplayed" : "success", { balance: result.balance })}</p>
        )}
      </Modal>
    </>
  );
}
