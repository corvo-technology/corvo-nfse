"use client";
import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { invoices, type ReviewAction } from "@/lib/api";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * What to do with invoices in manual review: the portal never gave a conclusive answer, so
 * nobody knows yet whether the NFS-e exists. Both actions are safe against a duplicate:
 * "retry" sends it again with the same DPS (the portal is asked for it first) and "discard"
 * only rejects after the portal confirms the DPS was never registered.
 */
export function ManualReviewActions({ invoiceIds, onDone }: { invoiceIds: string[]; onDone: () => void }) {
  const t = useTranslations("ManualReview");
  const toast = useToast();
  const apiError = useApiErrorText();
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const count = invoiceIds.length;

  async function run(action: ReviewAction) {
    setBusy(action);
    try {
      const results = await invoices.review(action, invoiceIds);
      const accepted = results.filter((r) => r.outcome === "accepted").length;
      const skipped = results.length - accepted;
      toast.success(t(`done.${action}`, { count: accepted }) + (skipped ? ` ${t("done.skipped", { count: skipped })}` : ""));
      setConfirmDiscard(false);
      onDone();
    } catch (cause) {
      toast.error(apiError(cause, t("failed")));
    } finally {
      setBusy(null);
    }
  }

  if (count === 0) return null;
  return (
    <section aria-labelledby="manual-review-title" className="banner banner-warn flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="manual-review-title" className="font-medium text-text">{t("title", { count })}</h2>
        <p className="text-sm text-text-2">{t("why", { count })}</p>
      </div>
      <ul className="flex flex-col gap-1 text-[13px] text-text-2">
        <li><strong className="font-medium text-text">{t("retry.label")}:</strong> {t("retry.hint")}</li>
        <li><strong className="font-medium text-text">{t("discard.label")}:</strong> {t("discard.hint")}</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy === "retry"} disabled={busy !== null} onClick={() => void run("retry")}>
          <RotateCcw size={15} aria-hidden />
          {t("retry.button", { count })}
        </Button>
        <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirmDiscard(true)}>
          <Trash2 size={15} aria-hidden />
          {t("discard.button", { count })}
        </Button>
      </div>
      {confirmDiscard && (
        <Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title={t("discard.confirmTitle", { count })}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-2">{t("discard.confirmBody", { count })}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmDiscard(false)}>{t("discard.back")}</Button>
              <Button variant="danger" loading={busy === "discard"} disabled={busy !== null} onClick={() => void run("discard")}>{t("discard.confirm", { count })}</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
