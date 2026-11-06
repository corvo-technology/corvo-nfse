"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import posthog from "posthog-js";
import { ApiError, billing as billingApi, type CheckoutPlan } from "@/lib/api";
import type { BillingPlan } from "@/lib/types";
import { PlanPicker, PLANS, type PlanSlug } from "@/components/pricing/plan-picker";
import { BillingSummary } from "@/components/billing/billing-summary";
import { CheckoutDialog, type CheckoutTarget } from "@/components/billing/checkout-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";

const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

export default function BillingPage() {
  const t = useTranslations("Billing");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const intl = locale === "pt" ? "pt-BR" : "en-US";
  const [billing, setBilling] = useState<BillingPlan | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState<CheckoutTarget | null>(null);
  const [resume, setResume] = useState<{ brCode: string | null; paymentLinkUrl: string } | undefined>(undefined);
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
        <Skeleton className="h-[230px] rounded-[12px]" />
      </div>
    );
  }

  const sub = billing.subscription;
  const hasSubscription = sub.status !== "none";

  return (
    <div className="flex max-w-[1000px] flex-col gap-6">
      {header}

      {!billingEnabled && <p role="status" className="banner banner-info">{t("liveOnly")}</p>}

      <BillingSummary
        billing={billing}
        canManage={canManage}
        billingEnabled={billingEnabled}
        busy={busy}
        onPortal={() => void openPortal()}
        onCancelPix={() => void cancelPix()}
        onResumePix={(pix) => {
          setResume({ brCode: pix.brCode, paymentLinkUrl: pix.paymentLinkUrl ?? "" });
          setTarget({ kind: "plan", slug: pix.planSlug as CheckoutPlan, cycle: "monthly" });
        }}
        onBuyNotes={() => document.getElementById("plans-heading")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />

      <section aria-labelledby="plans-heading" className="dash-in dash-in-3 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="plans-heading" className="text-[14.5px] font-medium text-text">{t("plans")}</h2>
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

      <CheckoutDialog target={target} resume={resume} onPaid={() => void billingApi.plan().then(setBilling).catch(() => undefined)} onClose={() => { setTarget(null); setResume(undefined); }} onError={(cause) => { setTarget(null); fail(cause); }} redirect={redirect} />
    </div>
  );
}
