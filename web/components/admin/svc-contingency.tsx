"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/i18n-helpers";
import { platformAdmin, type PlatformSvcState } from "@/lib/platform-admin";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

const REASON_MIN = 5;
const REASON_MAX = 500;

/** Platform admin: the UFs whose NF-e goes through the SVC right now, each with a button to leave it. */
export function SvcContingency() {
  const t = useTranslations("Admin.svc");
  const tc = useTranslations("Admin.common");
  const locale = useLocale();
  const apiError = useApiErrorText();
  const [rows, setRows] = useState<PlatformSvcState[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<PlatformSvcState | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const trimmed = reason.trim();
  const valid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;

  const load = useCallback(
    (signal?: AbortSignal) =>
      platformAdmin
        .svcStates(signal)
        .then((found) => { setRows(found); setLoadError(null); })
        .catch((cause: unknown) => { if (!signal?.aborted) setLoadError(apiError(cause, tc("loadFailed"))); }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !leaving) return;
    if (!valid) { setReasonError(t("errorReason")); return; }
    inFlight.current = true; setSubmitting(true); setError(null); setReasonError(null);
    try {
      await platformAdmin.exitSvc(leaving.uf, leaving.tpAmb, { reason: trimmed });
      setLeaving(null);
      await load();
    } catch (cause) {
      setError(apiError(cause, cause instanceof ApiError && cause.status === 404 ? t("errorNotFound") : t("errorGeneric")));
    } finally { inFlight.current = false; setSubmitting(false); }
  }

  return (
    <>
      {loadError && <p role="alert" className="text-[14px] text-danger">{loadError}</p>}
      {!loadError && rows === null && <p className="text-[14px] text-text-3">…</p>}
      {rows && rows.length === 0 && <p className="text-[14px] text-text-3">{t("empty")}</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={`${row.uf}-${row.tpAmb}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 text-[14px] text-text">
                <p className="font-medium">{row.uf} · {row.tpAmb === 1 ? t("live") : t("test")}</p>
                <p className="text-[12.5px] text-text-3">
                  {t("authority")}: {row.authority === "SVCAN" ? "SVC-AN" : "SVC-RS"}
                  {row.enteredAt ? ` · ${t("since")} ${formatDate(row.enteredAt, locale)}` : ""}
                </p>
              </div>
              <Button variant="secondary" onClick={() => { setReason(""); setReasonError(null); setError(null); setLeaving(row); }}>{t("exit")}</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={leaving !== null} onClose={() => { if (!submitting) setLeaving(null); }} title={leaving ? t("exitTitle", { uf: leaving.uf }) : ""}>
        <form noValidate onSubmit={send} className="flex flex-col gap-4">
          <p className="text-sm text-text-3">{leaving ? t("exitDescription", { uf: leaving.uf }) : ""}</p>
          <Field label={t("reason")} hint={t("reasonHint")} error={reasonError ?? undefined} required>
            {(control) => <textarea {...control} className="field resize-y" rows={3} maxLength={REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />}
          </Field>
          {error && <p role="alert" className="banner banner-danger">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setLeaving(null)} disabled={submitting}>{t("cancel")}</Button>
            <Button type="submit" loading={submitting} variant="danger">{t("exit")}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
