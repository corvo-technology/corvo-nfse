"use client";

import { useLocale, useTranslations } from "next-intl";
import type { PaymentRecord } from "@/lib/types";
import { PLANS } from "@/lib/plans-catalog";
import { formatBRL } from "@/components/pricing/plan-picker";
import { Card } from "@/components/ui/card";

/** What was actually paid, at the end of the Billing page: collapsed, so it never competes with the plan. */
export function PaymentHistory({ payments, failed }: { payments: PaymentRecord[] | null; failed: boolean }) {
  const t = useTranslations("Billing.history");
  const tp = useTranslations("Pricing");
  const intl = useLocale() === "pt" ? "pt-BR" : "en-US";
  const date = (value: string | null) => (value ? new Date(value).toLocaleDateString(intl, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }) : "—");

  if (failed) return <p className="text-[12.5px] text-text-3">{t("loadFailed")}</p>;
  if (payments === null) return null;

  const planName = (slug: string | null) => (PLANS.some((p) => p.slug === slug) ? tp(`plans.${slug}.name`).charAt(0) + tp(`plans.${slug}.name`).slice(1).toLowerCase() : (slug ?? ""));
  const describe = (p: PaymentRecord) =>
    p.kind === "avulso" ? t("avulso", { count: p.units ?? 0 }) : t("plan", { name: planName(p.planSlug), cycle: t(p.cycle ?? "monthly") });

  return (
    <Card className="overflow-hidden">
      <details data-testid="payment-history" className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-[14.5px] font-medium text-text marker:content-none [&::-webkit-details-marker]:hidden">
          <span>{t("title")}</span>
          <span className="flex items-center gap-2 font-mono text-[12px] font-normal text-text-3">
            {payments.length}
            <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
          </span>
        </summary>
        {payments.length === 0 ? (
          <p className="border-t border-border px-5 py-4 text-[13px] text-text-3">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border px-5">
            {payments.map((p) => (
              <li key={p.id} data-testid="payment-row" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-[13px]">
                <span className="min-w-0 text-text">{describe(p)}</span>
                <span className="flex items-baseline gap-3 text-text-3">
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px]">{t(p.provider === "woovi" ? "pix" : "card")}</span>
                  <span className="tabular-nums">{date(p.paidAt)}</span>
                  <span className="min-w-[84px] text-right font-medium tabular-nums text-text">{formatBRL(p.amountCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </Card>
  );
}
