"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { BillingPlan, PaymentRecord } from "@/lib/types";
import { PLANS } from "@/lib/plans-catalog";
import { formatBRL } from "@/components/pricing/plan-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** How the account pays Corvo: card (Stripe portal), Pix (contract), and what was actually paid. */
export function PaymentsCard({
  billing,
  payments,
  failed,
  canManage,
  busy,
  onPortal,
  onCancelPix,
}: {
  /** null while loading. */
  billing: BillingPlan | null;
  payments: PaymentRecord[] | null;
  failed: boolean;
  canManage: boolean;
  busy: "portal" | "cancel-pix" | null;
  onPortal: () => void;
  onCancelPix: () => void;
}) {
  const t = useTranslations("Settings.payments");
  const tb = useTranslations("Billing");
  const ts = useTranslations("Settings");
  const tp = useTranslations("Pricing");
  const intl = useLocale() === "pt" ? "pt-BR" : "en-US";
  const date = (value: string | null) => (value ? new Date(value).toLocaleDateString(intl, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }) : "—");

  const card = billing?.subscription.stripePortalAvailable ?? false;
  const pix = billing?.subscription.pixSubscription ?? null;
  const paidByPix = (payments ?? []).some((p) => p.provider === "woovi");

  const describe = (p: PaymentRecord) =>
    p.kind === "avulso"
      ? t("history.avulso", { count: p.units ?? 0 })
      : t("history.plan", { name: PLANS.some((x) => x.slug === p.planSlug) ? tp(`plans.${p.planSlug}.name`).charAt(0) + tp(`plans.${p.planSlug}.name`).slice(1).toLowerCase() : (p.planSlug ?? ""), cycle: t(`history.${p.cycle ?? "monthly"}`) });

  if (failed)
    return (
      <Card className="dash-in dash-in-2 p-5">
        <h2 className="text-[14.5px] font-medium">{t("title")}</h2>
        <p role="alert" className="mt-3 text-sm text-warn">{t("loadFailed")}</p>
      </Card>
    );

  return (
    <Card className="dash-in dash-in-2 overflow-hidden">
      <h2 className="border-b border-border px-5 py-4 text-[14.5px] font-medium">{t("title")}</h2>

      {!canManage && <p className="border-b border-border px-5 py-3 text-[13px] text-text-3">{t("permissionHint")}</p>}

      <div className="divide-y divide-border">
        <section data-testid="card-settings" className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-[13.5px] font-medium text-text">{t("card.title")}</h3>
            <p className="mt-1 text-[13px] text-text-3">{billing === null ? "…" : card ? t("card.available") : t("card.none")}</p>
          </div>
          {card && canManage && (
            <Button variant="secondary" className="max-sm:w-full" loading={busy === "portal"} onClick={onPortal}>{ts("openStripePortal")}</Button>
          )}
        </section>

        <section data-testid="pix-settings" className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-[13.5px] font-medium text-text">{t("pix.title")}</h3>
            <p className="mt-1 max-w-[460px] text-[13px] text-text-3">
              {billing === null || payments === null ? "…" : pix ? (pix.status === "pending" ? t("pix.pending") : t("pix.active")) : paidByPix ? t("pix.single") : t("pix.none")}
            </p>
          </div>
          {pix && canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {pix.status === "pending" && (
                <Link href="/app/billing" className="text-[13px] text-accent underline-offset-4 hover:underline">{t("pix.viewQr")}</Link>
              )}
              <Button variant="secondary" className="max-sm:w-full" loading={busy === "cancel-pix"} onClick={onCancelPix}>
                {pix.status === "pending" ? tb("pix.cancelAuthorization") : tb("pixCancel")}
              </Button>
            </div>
          )}
        </section>

        <section className="px-5 py-4">
          <h3 className="text-[13.5px] font-medium text-text">{t("history.title")}</h3>
          {payments === null ? (
            <p className="mt-2 text-[13px] text-text-3">…</p>
          ) : payments.length === 0 ? (
            <p className="mt-2 text-[13px] text-text-3">{t("history.empty")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {payments.map((p) => (
                <li key={p.id} data-testid="payment-row" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-[13px]">
                  <span className="min-w-0 text-text">{describe(p)}</span>
                  <span className="flex items-baseline gap-3 text-text-3">
                    <span className={cn("rounded-full border border-white/10 px-2 py-0.5 text-[11px]")}>{t(p.provider === "woovi" ? "history.pix" : "history.card")}</span>
                    <span className="tabular-nums">{date(p.paidAt)}</span>
                    <span className="min-w-[84px] text-right font-medium tabular-nums text-text">{formatBRL(p.amountCents)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="border-t border-border px-5 py-3.5">
        <Link href="/app/billing" className="text-sm text-accent underline-offset-4 hover:underline">{t("goToPlan")}</Link>
      </div>
    </Card>
  );
}
