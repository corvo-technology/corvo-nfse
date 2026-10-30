"use client";

import { useTranslations } from "next-intl";
import { Facet } from "@/components/ui/facet";

const steps = ["step1", "step2", "step3", "step4"] as const;

export function FlowSection() {
  const t = useTranslations("Flow");

  return (
    <section className="max-w-[1120px] mx-auto px-6 sm:px-10 pb-16 sm:pb-24">
      <div className="mb-12 max-w-[640px]">
        <h2 className="text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1.02] tracking-[-0.035em] text-text text-balance">
          {t("title")}
        </h2>
        <p className="mt-5 max-w-[480px] text-[16px] leading-relaxed text-text-3 text-pretty">{t("description")}</p>
      </div>

      <ol className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <li key={step} className="relative border-t-2 border-border-strong pt-6">
            <Facet className="absolute -top-[5px] left-0" />
            <h3 className="text-[16px] font-medium tracking-[-0.01em] text-text">{t(`steps.${step}`)}</h3>
            <p className="mt-2 text-[14px] leading-[1.6] text-text-3 text-pretty">{t(`steps.${step}Desc`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
