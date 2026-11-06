"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, billing as billingApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { BillingPlan } from "@/lib/types";
import { PaymentsCard } from "@/components/settings/payments-card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";

export default function SettingsPage() {
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");
  const tb = useTranslations("Billing");
  const { can } = useAuth();
  const { error: toastError, success } = useToast();
  const canManage = can("billing.manage");
  // null while loading.
  const [billing, setBilling] = useState<BillingPlan | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<"portal" | "cancel-pix" | null>(null);

  const load = useCallback((isCancelled: () => boolean = () => false) => {
    billingApi
      .plan()
      .then((plan) => { if (!isCancelled()) { setBilling(plan); setFailed(false); } })
      .catch(() => { if (!isCancelled()) setFailed(true); });
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  const fail = (cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 429) toastError(tb("errors.ERROR_RATE_LIMIT_EXCEEDED", { seconds: cause.retryAfterSeconds ?? 60 }));
    else if (cause instanceof ApiError && cause.status === 409) toastError(tb("errors.customer_required"));
    else toastError(cause instanceof ApiError && cause.status < 500 && cause.status > 0 ? cause.message : tb("errors.generic"));
  };

  const openPortal = async () => {
    if (busy) return;
    setBusy("portal");
    try {
      window.location.assign((await billingApi.portal()).url);
    } catch (cause) {
      fail(cause);
      setBusy(null);
    }
  };

  const cancelPix = async () => {
    if (busy) return;
    setBusy("cancel-pix");
    try {
      await billingApi.cancelPix();
      success(tb("pixCancelled"));
      load();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <PaymentsCard billing={billing} failed={failed} canManage={canManage} busy={busy} onPortal={() => void openPortal()} onCancelPix={() => void cancelPix()} />

      <section
        aria-labelledby="danger-zone"
        className="dash-in dash-in-3 flex flex-col gap-4 rounded-[12px] border border-danger-border bg-danger-surface p-5 sm:flex-row sm:items-center"
      >
        <div className="flex flex-1 flex-col gap-1">
          <h2 id="danger-zone" className="text-[14px] font-medium text-danger">
            {t("deleteWorkspace")}
          </h2>
          <p className="text-[13px] text-text-3">{t("deleteWorkspaceDesc")}</p>
        </div>
        <Button variant="danger" disabled className="max-sm:w-full">
          {tc("delete")}
        </Button>
      </section>
    </div>
  );
}
