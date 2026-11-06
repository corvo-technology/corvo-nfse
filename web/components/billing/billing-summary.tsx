"use client";

import { useLocale, useTranslations } from "next-intl";
import { PLANS } from "@/lib/plans-catalog";
import type { BillingPlan, PixSubscription } from "@/lib/types";
import { availableNotes } from "@/components/dashboard/notes-balance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type NoticeKind = "blocked" | "out-of-quota" | "cancels-at-end" | "scheduled";

/**
 * The whole billing state in one card: how many notes can be issued, the plan behind it, one notice at
 * most (the most important), and the account actions. Everything else on the page is the plan picker.
 */
export function BillingSummary({
  billing,
  canManage,
  billingEnabled,
  busy,
  onPortal,
  onCancelPix,
  onBuyNotes,
  onResumePix,
}: {
  billing: BillingPlan;
  canManage: boolean;
  billingEnabled: boolean;
  busy: string | null;
  onPortal: () => void;
  onCancelPix: () => void;
  onBuyNotes: () => void;
  onResumePix: (pix: PixSubscription) => void;
}) {
  const t = useTranslations("Billing");
  const tp = useTranslations("Pricing");
  const intl = useLocale() === "pt" ? "pt-BR" : "en-US";
  const { usage, subscription: sub } = billing;
  const hasPlan = PLANS.some((p) => p.slug === billing.slug);
  const hasSubscription = sub.status !== "none";
  const available = availableNotes(billing);
  const total = usage.monthlyAllowance;
  const planLeft = sub.blocked ? 0 : usage.creditsRemaining;
  const pct = total > 0 ? Math.min(100, Math.round((usage.creditsUsed / total) * 100)) : 0;
  const date = (value: string) => (value ? new Date(value).toLocaleDateString(intl, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }) : "—");
  const money = (cents: number) => new Intl.NumberFormat(intl, { style: "currency", currency: "BRL" }).format(cents / 100);
  const planName = (slug: string) => (PLANS.some((p) => p.slug === slug) ? tp(`plans.${slug}.name`) : slug);

  // One notice, the most important first.
  const notice: { kind: NoticeKind; tone: string; text: string; role: "alert" | "status" } | null = sub.blocked
    ? { kind: "blocked", tone: "border-danger/40 bg-danger/10 text-danger", text: t("blocked"), role: "alert" }
    : available === 0
      ? { kind: "out-of-quota", tone: "border-warn/40 bg-warn/10 text-warn", text: t("blockedBuy"), role: "alert" }
      : sub.cancelAtPeriodEnd
        ? { kind: "cancels-at-end", tone: "border-warn/40 bg-warn/10 text-warn", text: t("cancelsAtEnd"), role: "status" }
        : sub.scheduledPlan
          ? { kind: "scheduled", tone: "border-white/15 bg-white/[0.04] text-text-2", text: t("scheduled", { plan: planName(sub.scheduledPlan), date: sub.paidUntil ? date(sub.paidUntil) : "—" }), role: "status" }
          : null;

  const companies = t("summary.companiesLine", { count: usage.activeCompanies });
  const pix = sub.pixSubscription;
  const showPortal = canManage && hasSubscription;

  return (
    <Card data-testid="billing-summary" className="dash-in dash-in-1 flex flex-col gap-5 p-5 sm:p-6">
      {notice && (
        <p data-testid="summary-notice" data-kind={notice.kind} role={notice.role} className={cn("rounded-[8px] border px-3.5 py-2.5 text-[13px]", notice.tone)}>
          {notice.text}
        </p>
      )}

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">{t("summary.available")}</p>
          <p data-testid="summary-available" className={cn("mt-2 text-[48px] font-semibold leading-none tracking-[-0.03em] tabular-nums", available === 0 ? "text-warn" : "text-text")}>{available}</p>
          <p className="mt-2 text-[13px] text-text-3">
            {hasPlan && t("summary.planLine", { left: planLeft, total })}
            {hasPlan && usage.avulsoBalance > 0 && " · "}
            {(usage.avulsoBalance > 0 || !hasPlan) && t("summary.avulsoLine", { count: usage.avulsoBalance })}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:items-end sm:text-right">
          <p className="eyebrow text-accent">{billing.name}</p>
          {hasPlan ? (
            <>
              <p className="flex items-baseline gap-1.5 sm:justify-end">
                <span className="text-[24px] font-semibold leading-none tabular-nums">{money(billing.monthlyPriceCents)}</span>
                <span className="text-[13px] text-text-3">{t("perMonth")}</span>
              </p>
              {sub.paidUntil && <p className="text-[12.5px] text-text-3">{t("summary.paidUntil", { date: date(sub.paidUntil) })}</p>}
            </>
          ) : (
            <p className="max-w-[240px] text-[12.5px] text-text-3">{t("summary.noPlanHint")}</p>
          )}
        </div>
      </div>

      {hasPlan && total > 0 && (
        <div
          role="progressbar"
          aria-label={t("usage")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={usage.creditsUsed}
          className="h-1.5 overflow-hidden rounded-full bg-track"
        >
          <div className={cn("h-full rounded-full transition-[width] duration-500", pct > 80 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>
      )}

      {pix && (
        <div data-testid="pix-state" data-status={pix.status} className="flex flex-col gap-3 rounded-[10px] border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[14px] font-medium text-text">
              <span aria-hidden className={cn("h-2 w-2 rounded-full", pix.status === "active" ? "bg-accent" : "bg-warn")} />
              {pix.status === "active" ? t("pix.activeTitle") : t("pix.pendingTitle")}
            </p>
            <p className="mt-1 max-w-[520px] text-[12.5px] leading-relaxed text-text-3">{pix.status === "active" ? t("pix.activeBody") : t("pix.pendingBody")}</p>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {pix.status === "pending" && (pix.brCode || pix.paymentLinkUrl) && (
                <Button variant="accent" size="sm" disabled={!billingEnabled} onClick={() => onResumePix(pix)}>{t("pix.viewQr")}</Button>
              )}
              <Button variant="secondary" size="sm" disabled={!billingEnabled || busy !== null} loading={busy === "cancel-pix"} onClick={onCancelPix}>
                {pix.status === "pending" ? t("pix.cancelAuthorization") : t("pixCancel")}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p data-testid="summary-meta" className="text-[12.5px] text-text-3">
          {hasPlan ? `${t("summary.periodLine", { start: date(usage.periodStart), end: date(usage.periodEnd) })} · ${companies}` : companies}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <Button variant="accent" size="sm" disabled={!billingEnabled} onClick={onBuyNotes}>{t("avulso.buy")}</Button>
          )}
          {showPortal && (
            <Button variant="secondary" size="sm" disabled={!billingEnabled || busy !== null} loading={busy === "portal"} onClick={onPortal}>{t("manage")}</Button>
          )}
        </div>
      </div>
    </Card>
  );
}
