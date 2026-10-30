"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PlanPicker } from "@/components/pricing/plan-picker";

export function Pricing() {
  const t = useTranslations("Pricing");

  return (
    <section id="pricing" className="max-w-[1120px] mx-auto px-6 sm:px-10 pb-14 sm:pb-22">
      <div className="text-center mb-14">
        <h2 className="text-[clamp(32px,4.4vw,56px)] font-semibold tracking-[-0.035em] text-text leading-[1.02] text-balance">
          {t("title")}
        </h2>
        <p className="text-[16px] text-text-2 mt-3 max-w-[520px] mx-auto leading-relaxed">
          {t("description")}
        </p>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-2.5" aria-label={t("included.label")}>
          {(["mcp", "email"] as const).map((key) => (
            <li
              key={key}
              className="flex items-center gap-2 rounded-full border border-accent/30 bg-accent-surface px-3.5 py-1.5 text-[13px] text-text-2"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 8.5l3.2 3L13 4.5" />
              </svg>
              {t(`included.${key}`)}
            </li>
          ))}
        </ul>
      </div>

      <PlanPicker
        renderAction={({ plan }) => (
          <Link
            href="/login?mode=signup"
            className="inline-flex w-full sm:w-auto items-center justify-center rounded-[10px] bg-[#ededed] px-7 py-3 text-[14px] font-medium text-[#0a0a0a] transition-[color,background-color,border-color,opacity,transform,box-shadow] hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]"
          >
            {plan.slug === "free" ? t("ctaFree") : t("ctaPaid")}
          </Link>
        )}
      />

      <p className="text-center text-[13px] text-text-3 mt-8">{t("footnote")}</p>
    </section>
  );
}
