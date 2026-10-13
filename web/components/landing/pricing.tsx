"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PlanPicker } from "@/components/pricing/plan-picker";

export function Pricing() {
  const t = useTranslations("Pricing");

  return (
    <section id="pricing" className="max-w-[1120px] mx-auto px-6 sm:px-10 pb-14 sm:pb-22">
      <div className="text-center mb-14">
        <span className="font-mono text-xs text-accent tracking-[0.1em]">{t("eyebrow")}</span>
        <h2 className="text-[34px] font-semibold tracking-[-0.04em] text-text mt-3 leading-tight">
          {t("title")}
        </h2>
        <p className="text-[16px] text-text-2 mt-3 max-w-[520px] mx-auto leading-relaxed">
          {t("description")}
        </p>
      </div>

      <PlanPicker
        renderAction={({ plan }) => (
          <Link
            href="/login?mode=signup"
            className="inline-flex w-full sm:w-auto items-center justify-center rounded-[10px] bg-[#ededed] px-7 py-3 text-[14px] font-medium text-[#0a0a0a] transition-all hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]"
          >
            {plan.slug === "free" ? t("ctaFree") : t("ctaPaid")}
          </Link>
        )}
      />

      <p className="text-center text-[13px] text-text-3 mt-8">{t("footnote")}</p>
    </section>
  );
}
