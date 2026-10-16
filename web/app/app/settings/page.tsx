"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, billing as billingApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";

export default function SettingsPage() {
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");
  const tb = useTranslations("Billing");
  const { can } = useAuth();
  const { error: toastError } = useToast();
  const canManage = can("billing.manage");
  // null while loading; false when the plan could not be read or has no subscription.
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    billingApi
      .plan()
      .then((plan) => { if (!cancelled) setHasSubscription(plan.subscription.status !== "none"); })
      .catch(() => { if (!cancelled) setHasSubscription(false); });
    return () => { cancelled = true; };
  }, []);

  const openPortal = async () => {
    if (opening) return;
    setOpening(true);
    try {
      window.location.assign((await billingApi.portal()).url);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) toastError(tb("errors.ERROR_RATE_LIMIT_EXCEEDED", { seconds: cause.retryAfterSeconds ?? 60 }));
      else if (cause instanceof ApiError && cause.status === 409) toastError(tb("errors.customer_required"));
      else toastError(cause instanceof ApiError && cause.status < 500 && cause.status > 0 ? cause.message : tb("errors.generic"));
      setOpening(false);
    }
  };
  const portalHint = !canManage ? t("portalNoPermission") : hasSubscription === false ? t("portalNoSubscription") : t("portalDescription");

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card className="dash-in dash-in-2 overflow-hidden">
        <h2 className="border-b border-border px-5 py-4 text-[14.5px] font-medium">{t("billing")}</h2>
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-sm text-text-3">{portalHint}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              className="max-sm:w-full"
              loading={opening}
              disabled={!canManage || hasSubscription !== true}
              onClick={() => void openPortal()}
            >
              {t("openStripePortal")}
            </Button>
            {canManage && hasSubscription === false && (
              <Link href="/app/billing" className="text-sm underline">{t("goToBilling")}</Link>
            )}
          </div>
        </div>
      </Card>

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
