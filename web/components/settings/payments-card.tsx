"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { BillingPlan } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Only what can be configured: the Stripe portal (when there is a card customer) and the Pix
 * Automático contract (when there is one). With neither, a single line points to Billing, where
 * the plan, the money and its history live.
 */
export function PaymentsCard({
  billing,
  failed,
  canManage,
  busy,
  onPortal,
  onCancelPix,
}: {
  /** null while loading. */
  billing: BillingPlan | null;
  failed: boolean;
  canManage: boolean;
  busy: "portal" | "cancel-pix" | null;
  onPortal: () => void;
  onCancelPix: () => void;
}) {
  const t = useTranslations("Settings.payments");
  const tb = useTranslations("Billing");
  const ts = useTranslations("Settings");

  if (failed)
    return (
      <Card className="dash-in dash-in-2 p-5">
        <p role="alert" className="text-sm text-warn">{t("loadFailed")}</p>
      </Card>
    );
  if (billing === null) return <Card className="dash-in dash-in-2 h-[96px] motion-safe:animate-pulse" aria-busy="true" />;

  const card = billing.subscription.stripePortalAvailable;
  const pix = billing.subscription.pixSubscription;

  if (!card && !pix)
    return (
      <Card className="dash-in dash-in-2 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <p className="text-[13.5px] text-text-3">{t("elsewhere")}</p>
        <Link href="/app/billing" className="text-sm text-accent underline-offset-4 hover:underline">{t("openBilling")}</Link>
      </Card>
    );

  return (
    <Card className="dash-in dash-in-2 overflow-hidden">
      <h2 className="border-b border-border px-5 py-4 text-[14.5px] font-medium">{t("title")}</h2>
      {!canManage && <p className="border-b border-border px-5 py-3 text-[13px] text-text-3">{t("permissionHint")}</p>}
      <div className="divide-y divide-border">
        {card && (
          <section data-testid="card-settings" className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
            <div>
              <h3 className="text-[13.5px] font-medium text-text">{t("card.title")}</h3>
              <p className="mt-1 text-[13px] text-text-3">{t("card.available")}</p>
            </div>
            {canManage && (
              <div className="flex flex-col gap-2 sm:items-end">
                <Button variant="secondary" className="max-sm:w-full" loading={busy === "portal"} onClick={onPortal}>{ts("openStripePortal")}</Button>
              </div>
            )}
          </section>
        )}
        {pix && (
          <section data-testid="pix-settings" className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
            <div>
              <h3 className="text-[13.5px] font-medium text-text">{t("pix.title")}</h3>
              <p className="mt-1 max-w-[460px] text-[13px] text-text-3">{pix.status === "pending" ? t("pix.pending") : t("pix.active")}</p>
            </div>
            {canManage && (
              <div className="flex flex-col gap-2 sm:items-end">
                <Button variant="secondary" className="max-sm:w-full" loading={busy === "cancel-pix"} onClick={onCancelPix}>
                  {pix.status === "pending" ? tb("pix.cancelAuthorization") : tb("pixCancel")}
                </Button>
                {pix.status === "pending" && <Link href="/app/billing" className="text-[13px] text-accent underline-offset-4 hover:underline">{t("pix.viewQr")}</Link>}
              </div>
            )}
          </section>
        )}
      </div>
    </Card>
  );
}
