"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { BillingPlan } from "@/lib/types";

/** Notes the account can issue right now: what is left of the plan (zero if it lapsed) plus the avulso balance. */
export function availableNotes(plan: BillingPlan): number {
  const planLeft = plan.subscription.blocked ? 0 : plan.usage.creditsRemaining;
  return planLeft + plan.usage.avulsoBalance;
}

/**
 * "How many notes can I issue right now": what is left of the plan plus the avulso balance.
 * The usage bar only exists when there is a plan quota to measure against.
 */
export function NotesBalance({ plan, onNavigate }: { plan: BillingPlan; onNavigate?: () => void }) {
  const t = useTranslations("Sidebar");
  const { usage } = plan;
  const total = usage.monthlyAllowance;
  // A lapsed plan cannot issue, so its leftover notes are not available.
  const planLeft = plan.subscription.blocked ? 0 : usage.creditsRemaining;
  const available = availableNotes(plan);
  const pct = total > 0 ? Math.min(100, Math.round((usage.creditsUsed / total) * 100)) : 0;
  const nearLimit = pct >= 80;

  return (
    <div className="flex flex-col gap-3 rounded-[11px] border border-border bg-surface p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow">{t("notesAvailable")}</span>
        <span data-testid="notes-available" className={cn("font-mono text-[15px]", available === 0 ? "text-warn" : "text-text")}>{available}</span>
      </div>

      {total > 0 && (
        <div className="flex flex-col gap-1.5">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={usage.creditsUsed}
            aria-label={t("creditsUsed", { used: usage.creditsUsed, total })}
            className="h-1 overflow-hidden rounded-full bg-track"
          >
            <div className={cn("h-full rounded-full transition-[width] duration-500", nearLimit ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[12px] text-text-3">{t("planLine", { left: planLeft, total })}</p>
        </div>
      )}
      {usage.avulsoBalance > 0 && <p className="text-[12px] text-text-3">{t("avulsoLine", { count: usage.avulsoBalance })}</p>}

      <Link href="/app/billing" onClick={onNavigate} className="text-[13px] text-accent transition-opacity hover:opacity-80">
        {available === 0 ? t("buyNotes") : t("manageBilling")}
      </Link>
    </div>
  );
}
