"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import { platformAdmin } from "@/lib/platform-admin";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

const REASON_MIN = 5;
const REASON_MAX = 500;

interface NfeAccessButtonProps {
  tenantId: string;
  /** When NF-e was released for the workspace; null while it is off. */
  enabledAt: string | null;
  /** Which release this switch controls; NF-e when omitted. */
  type?: "nfe" | "nfce";
  onChanged: () => void;
}

/** Platform-admin action: releases NF-e (homologação) for one workspace, or takes it away. The reason is kept in the audit trail. */
export function NfeAccessButton({ tenantId, enabledAt, type = "nfe", onChanged }: NfeAccessButtonProps) {
  const t = useTranslations(type === "nfce" ? "Admin.nfce" : "Admin.nfe");
  const apiError = useApiErrorText();
  const enabled = enabledAt !== null;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const trimmed = reason.trim();
  const valid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!valid) { setReasonError(t("errorReason")); return; }
    inFlight.current = true; setSubmitting(true); setError(null); setReasonError(null);
    try {
      await (type === "nfce" ? platformAdmin.setNfceAccess : platformAdmin.setNfeAccess)(tenantId, { enabled: !enabled, reason: trimmed });
      setOpen(false); onChanged();
    } catch (cause) {
      setError(apiError(cause, cause instanceof ApiError && cause.status === 404 ? t("errorNotFound") : t("errorGeneric")));
    } finally { inFlight.current = false; setSubmitting(false); }
  }

  return (
    <>
      <div className="flex flex-col items-start gap-1.5 sm:items-end">
        <Button variant="secondary" onClick={() => { setReason(""); setReasonError(null); setError(null); setOpen(true); }}>{enabled ? t("disable") : t("enable")}</Button>
        <p className="text-[12.5px] text-text-3">{enabled ? t("on") : t("off")}</p>
      </div>
      <Modal open={open} onClose={() => { if (!submitting) setOpen(false); }} title={enabled ? t("disableTitle") : t("enableTitle")}>
        <form noValidate onSubmit={send} className="flex flex-col gap-4">
          <p className="text-sm text-text-3">{enabled ? t("disableDescription") : t("enableDescription")}</p>
          <Field label={t("reason")} hint={t("reasonHint")} error={reasonError ?? undefined} required>
            {(control) => <textarea {...control} className="field resize-y" rows={3} maxLength={REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />}
          </Field>
          {error && <p role="alert" className="banner banner-danger">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>{t("cancel")}</Button>
            <Button type="submit" loading={submitting} variant={enabled ? "danger" : "primary"}>{enabled ? t("disable") : t("enable")}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
