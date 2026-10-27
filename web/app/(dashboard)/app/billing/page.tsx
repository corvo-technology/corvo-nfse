"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import posthog from "posthog-js";
import { ApiError, billing as billingApi, type CheckoutPlan } from "@/lib/api";
import type { BillingPlan } from "@/lib/types";
import { PlanPicker, PLANS, type PlanSlug } from "@/components/pricing/plan-picker";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

export default function BillingPage() {
  const t = useTranslations("Billing");
  const tCommon = useTranslations("Common");
  const tp = useTranslations("Pricing");
  const locale = useLocale();
  const intl = locale === "pt" ? "pt-BR" : "en-US";
  const [billing, setBilling] = useState<BillingPlan | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const canManage = can("billing.manage");

  useEffect(() => {
    let cancelled = false;
    billingApi.plan()
      .then((data) => { if (!cancelled) setBilling(data); })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const fail = (cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 429) return toastError(t("errors.ERROR_RATE_LIMIT_EXCEEDED", { seconds: cause.retryAfterSeconds ?? 60 }));
    if (cause instanceof ApiError && cause.status === 409) return toastError(cause.message.includes("Subscribe before") ? t("errors.customer_required") : cause.message);
    toastError(cause instanceof ApiError && cause.status < 500 && cause.status > 0 ? cause.message : t("errors.generic"));
  };
  const redirect = (url: string) => { window.location.assign(url); };
  const subscribe = async (slug: CheckoutPlan) => {
    if (busy) return; setBusy(slug);
    try {
      const { url } = await billingApi.checkout(slug, crypto.randomUUID());
      if (posthogConfigured) posthog.capture("billing_checkout_started", { plan: slug });
      success(t("redirecting")); redirect(url);
    }
    catch (cause) { fail(cause); setBusy(null); }
  };
  const changePlan = async (slug: PlanSlug, direction: "upgrade" | "downgrade") => {
    if (busy) return; setBusy(slug);
    try {
      const result = await billingApi.changePlan(slug, direction);
      if (posthogConfigured) posthog.capture("billing_plan_changed", { plan: slug, direction });
      success(result.effectiveAt ? t("changeScheduled", { date: new Date(result.effectiveAt).toLocaleDateString(intl) }) : t("changeScheduledNoDate"));
      setBilling(await billingApi.plan());
    } catch (cause) { fail(cause); }
    finally { setBusy(null); }
  };
  const openPortal = async () => {
    if (busy) return; setBusy("portal");
    try { redirect((await billingApi.portal()).url); }
    catch (cause) { fail(cause); setBusy(null); }
  };

  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;

  if (failed) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card>
          <EmptyState tone="danger" icon={AlertTriangle} title={t("loadFailed")} />
        </Card>
      </div>
    );
  }

  if (!billing) {
    return (
      <div className="flex flex-col gap-6" role="status" aria-busy="true" aria-label={tCommon("loading")}>
        {header}
        <Skeleton className="h-[220px] rounded-[12px]" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-[84px] rounded-[12px]" />
          <Skeleton className="h-[84px] rounded-[12px]" />
        </div>
      </div>
    );
  }

  const u = billing.usage;
  const pct = u.monthlyAllowance > 0 ? Math.min(100, (u.creditsUsed / u.monthlyAllowance) * 100) : 0;

  const money = (cents: number) =>
    cents === 0
      ? new Intl.NumberFormat(intl, { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(0)
      : new Intl.NumberFormat(intl, { style: "currency", currency: "BRL" }).format(cents / 100);
  const date = (d: string) => d ? new Date(d).toLocaleDateString(intl, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  const maxCompanies = u.maxActiveCompanies === 999999 ? "∞" : u.maxActiveCompanies;
  const warn = pct > 80;
  const sub = billing.subscription;
  const hasSubscription = sub.status !== "none";

  return (
    <div className="flex max-w-[1000px] flex-col gap-6">
      {header}

      <Card className="dash-in dash-in-1 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow text-accent">{billing.name}</p>
            <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-mono text-[36px] font-medium leading-none tracking-tight">{money(billing.monthlyPriceCents)}</span>
              <span className="text-[14px] text-text-3">{t("perMonth")}</span>
            </p>
          </div>

        </div>

        <div className="mt-6">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <span id="usage-label" className="text-[13px] text-text-2">{t("usage")}</span>
            <span className="font-mono text-[13px] text-text">
              {u.creditsUsed}
              <span className="text-text-4"> / {u.monthlyAllowance}</span>
            </span>
          </div>
          <div
            role="progressbar"
            aria-labelledby="usage-label"
            aria-valuemin={0}
            aria-valuemax={u.monthlyAllowance}
            aria-valuenow={u.creditsUsed}
            className="h-2 overflow-hidden rounded-full bg-track"
          >
            <div
              className={cn("h-full rounded-full transition-all duration-500", warn ? "bg-warn" : "bg-accent")}
              style={{ width: `${pct}%` }}
            />
          </div>
          {warn && (
            <p role="status" className="mt-3 text-[12.5px] text-warn">
              {t("usageWarning")}
            </p>
          )}
        </div>
      </Card>

      <dl className="dash-in dash-in-2 grid gap-4 sm:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <dt className="eyebrow mb-2">{t("period")}</dt>
          <dd className="text-[15px] font-medium">
            {date(u.periodStart)} — {date(u.periodEnd)}
          </dd>
        </Card>
        <Card className="p-4 sm:p-5">
          <dt className="eyebrow mb-2">{t("activeCompanies")}</dt>
          <dd className="font-mono text-[15px] font-medium">
            {u.activeCompanies} <span className="text-text-4">/ {maxCompanies}</span>
          </dd>
        </Card>
      </dl>

      {u.overageUnits > 0 && <p role="status" className="text-[13px] text-text-2">{t("overageUsed", { count: u.overageUnits, price: money(u.overageAmountCents) })}</p>}
      {sub.blocked && <p role="alert" className="text-[13px] text-danger">{t("blocked")}</p>}
      {sub.scheduledPlan && <p className="text-[13px] text-text-3">{t("scheduled", { plan: PLANS.some((p) => p.slug === sub.scheduledPlan) ? tp(`plans.${sub.scheduledPlan}.name`) : sub.scheduledPlan, date: sub.paidUntil ? date(sub.paidUntil) : "—" })}</p>}
      {sub.cancelAtPeriodEnd && <p className="text-[13px] text-warn">{t("cancelsAtEnd")}</p>}

      <section aria-labelledby="plans-heading" className="dash-in dash-in-3 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="plans-heading" className="text-[14.5px] font-medium text-text">{t("plans")}</h2>
          {canManage && hasSubscription && <Button variant="secondary" size="sm" loading={busy === "portal"} onClick={() => void openPortal()}>{t("manage")}</Button>}
        </div>
        <PlanPicker
          currentSlug={billing.slug as PlanSlug}
          renderAction={({ plan, isCurrent }) => {
            if (isCurrent) return <span className="inline-flex min-h-10 items-center text-[14px] text-accent">{t("currentPlan")}</span>;
            if (!canManage) return null;
            const current = PLANS.find((p) => p.slug === billing.slug);
            const action = !hasSubscription ? (plan.slug === "free" ? null : "subscribe")
              : plan.basePriceCents > (current?.basePriceCents ?? 0) ? "upgrade" : "downgrade";
            if (!action) return null;
            return (
              <Button variant={action === "downgrade" ? "secondary" : "accent"} size="lg" loading={busy === plan.slug} disabled={busy !== null && busy !== plan.slug}
                onClick={() => void (action === "subscribe" ? subscribe(plan.slug as CheckoutPlan) : changePlan(plan.slug, action))}>{t(action)}</Button>
            );
          }}
        />
      </section>
    </div>
  );
}
