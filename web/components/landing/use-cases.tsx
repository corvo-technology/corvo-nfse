"use client";

import { useTranslations } from "next-intl";

const cases = ["saas", "erp", "agencies", "companies"] as const;

export function UseCases() {
  const t = useTranslations("UseCases");

  return (
    <section className="max-w-[1120px] mx-auto px-6 sm:px-10 py-16 sm:py-24">
      <h2 className="max-w-[640px] text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1.02] tracking-[-0.035em] text-text text-balance">
        {t("title")}
      </h2>
      <p className="mt-5 max-w-[520px] text-[17px] leading-relaxed text-text-3 text-pretty">{t("description")}</p>

      <dl className="mt-14 border-t border-border-strong">
        {cases.map((key) => (
          <div key={key} className="group grid gap-2 border-b border-border py-7 md:grid-cols-[5fr_7fr] md:gap-10">
            <dt className="text-[24px] font-medium leading-tight tracking-[-0.02em] text-text transition-[transform,color] duration-200 group-hover:translate-x-1.5 group-hover:text-accent">{t(`${key}.title`)}</dt>
            <dd className="max-w-[520px] text-[15.5px] leading-relaxed text-text-3 text-pretty">{t(`${key}.description`)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
