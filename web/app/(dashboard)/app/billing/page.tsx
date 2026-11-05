"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import posthog from "posthog-js";
import { ApiError, billing as billingApi } from "@/lib/api";
import type { BillingPlan } from "@/lib/types";
import { PlanPicker, PLANS, formatBRL, type PlanSlug } from "@/components/pricing/plan-picker";
import { CheckoutDialog, purchaseErrorMessage, type CheckoutTarget } from "@/components/billing/checkout-dialog";
import { AVULSO_MIN_UNITS, AVULSO_UNIT_CENTS } from "@/lib/plans-catalog";
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
  const [target, setTarget] = useState<CheckoutTarget | null>(null);
  const [avulsoUnits, setAvulsoUnits] = useState(String(10));
  const { can, fiscalEnvironment } = useAuth();
  const { success, error: toastError } = useToast();
  const canManage = can("billing.manage");
  const billingEnabled = fiscalEnvironment === "live";

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
  const changePlan = async (slug: PlanSlug, direction: "upgrade" | "downgrade") => {
    if (!billingEnabled || !canManage || busy) return; setBusy(slug);
    try {
      const result = await billingApi.changePlan(slug, direction);
      if (posthogConfigured) posthog.capture("billing_plan_changed", { plan: slug, direction });
      success(result.effectiveAt ? t("changeScheduled", { date: new Date(result.effectiveAt).toLocaleDateString(intl) }) : t("changeScheduledNoDate"));
      setBilling(await billingApi.plan());
    } catch (cause) { fail(cause); }
    finally { setBusy(null); }
  };
  const cancelPix = async () => {
    if (!billingEnabled || !canManage || busy) return; setBusy("cancel-pix");
    try { await billingApi.cancelPix(); success(t("pixCancelled")); setBilling(await billingApi.plan()); }
    catch (cause) { fail(cause); }
    finally { setBusy(null); }
  };
  const openPortal = async () => {
    if (!billingEnabled || !canManage || busy) return; setBusy("portal");
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

      {!billingEnabled && <p role="status" className="banner banner-info">{t("liveOnly")}</p>}

      <Card className="dash-in dash-in-1 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow text-accent">{billing.name}</p>
            <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{money(billing.monthlyPriceCents)}</span>
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
              className={cn("h-full rounded-full transition-[width] duration-500", warn ? "bg-warn" : "bg-accent")}
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

      <p className="text-[13px] text-text-2" data-testid="avulso-balance">{t("avulso.balance", { count: u.avulsoBalance })}</p>
      {u.creditsRemaining <= 0 && u.avulsoBalance <= 0 && <p role="alert" className="text-[13px] text-warn" data-testid="out-of-quota">{t("blockedBuy")}</p>}
      {sub.blocked && <p role="alert" className="text-[13px] text-danger">{t("blocked")}</p>}
      {sub.scheduledPlan && <p className="text-[13px] text-text-3">{t("scheduled", { plan: PLANS.some((p) => p.slug === sub.scheduledPlan) ? tp(`plans.${sub.scheduledPlan}.name`) : sub.scheduledPlan, date: sub.paidUntil ? date(sub.paidUntil) : "—" })}</p>}
      {sub.pixSubscription && canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-text-2">{t("pixActive")}</p>
          <Button variant="secondary" size="sm" disabled={!billingEnabled || busy !== null} loading={busy === "cancel-pix"} onClick={() => void cancelPix()}>{t("pixCancel")}</Button>
        </div>
      )}
      {sub.cancelAtPeriodEnd && <p className="text-[13px] text-warn">{t("cancelsAtEnd")}</p>}

      <section aria-labelledby="plans-heading" className="dash-in dash-in-3 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="plans-heading" className="text-[14.5px] font-medium text-text">{t("plans")}</h2>
          {canManage && hasSubscription && <Button variant="secondary" size="sm" disabled={!billingEnabled || busy !== null} loading={busy === "portal"} onClick={() => void openPortal()}>{t("manage")}</Button>}
        </div>
        <PlanPicker
          currentSlug={billing.slug as PlanSlug}
          renderAction={({ plan, cycle, avulsoUnits, isCurrent }) => {
            if (isCurrent) return <span className="inline-flex min-h-10 items-center text-[14px] text-accent">{t("currentPlan")}</span>;
            if (!canManage) return null;
            if (!plan)
              return (
                <Button variant="accent" size="lg" disabled={!billingEnabled} onClick={() => setTarget({ kind: "avulso", units: avulsoUnits })}>{t("avulso.buy")}</Button>
              );
            const current = PLANS.find((p) => p.slug === billing.slug);
            // Annual is always a fresh purchase; monthly changes on an existing subscription are scheduled.
            const onCurrentSubscription = hasSubscription && PLANS.some((p) => p.slug === billing.slug);
            const action = !onCurrentSubscription || cycle === "annual" ? "subscribe"
              : plan.monthlyCents > (current?.monthlyCents ?? 0) ? "upgrade" : "downgrade";
            return (
              <Button variant={action === "downgrade" ? "secondary" : "accent"} size="lg" loading={busy === plan.slug} disabled={!billingEnabled || (busy !== null && busy !== plan.slug)}
                onClick={() => (action === "subscribe" ? setTarget({ kind: "plan", slug: plan.slug, cycle }) : void changePlan(plan.slug, action))}>{t(action === "subscribe" ? "choose" : action)}</Button>
            );
          }}
        />
      </section>

      <section aria-labelledby="avulso-heading" className="dash-in dash-in-3 flex flex-col gap-3">
        <h2 id="avulso-heading" className="text-[14.5px] font-medium text-text">{t("avulso.title")}</h2>
        <Card className="flex flex-col gap-3 p-5">
          <p className="text-[13px] text-text-2">{t("avulso.description")}</p>
          <label className="text-[13px] text-text-2">{t("avulso.units")}
            <input inputMode="numeric" value={avulsoUnits} onChange={(e) => setAvulsoUnits(e.target.value.replace(/\D/g, ""))}
              className="mt-1 block w-40 rounded-[8px] border border-white/15 bg-transparent px-3 py-2 text-text tabular-nums" />
          </label>
          {Number(avulsoUnits) < AVULSO_MIN_UNITS && <p role="status" className="text-[12.5px] text-warn">{t("avulso.minimum")}</p>}
          <div className="flex items-center gap-4">
            <span className="text-[14px] text-text">{t("avulso.total", { total: formatBRL(Number(avulsoUnits) * AVULSO_UNIT_CENTS) })}</span>
            <Button variant="accent" disabled={!billingEnabled || !canManage || Number(avulsoUnits) < AVULSO_MIN_UNITS}
              onClick={() => setTarget({ kind: "avulso", units: Number(avulsoUnits) })}>{t("avulso.buy")}</Button>
          </div>
        </Card>
      </section>

      <CheckoutDialog target={target} onPaid={() => void billingApi.plan().then(setBilling).catch(() => undefined)} onClose={() => setTarget(null)} onError={(cause) => { setTarget(null); fail(cause); }} redirect={redirect} />
    </div>
  );
}
