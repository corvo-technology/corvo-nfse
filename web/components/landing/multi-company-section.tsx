"use client";

import { useTranslations } from "next-intl";
import { Facet } from "@/components/ui/facet";

const items = ["companies", "perCompany", "documents", "limits", "consumption"] as const;

export function MultiCompanySection() {
  const t = useTranslations("MultiCompany");

  return (
    <section className="max-w-[1120px] mx-auto px-6 sm:px-10 py-16 sm:py-24">
      <div className="grid gap-10 lg:grid-cols-[5fr_6fr] lg:gap-20">
        <div>
          <h2 className="max-w-[440px] text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1.02] tracking-[-0.035em] text-text text-balance">
            {t("title")}
          </h2>
          <p className="mt-5 max-w-[420px] text-[16px] leading-relaxed text-text-3 text-pretty">
            {t("description")}
          </p>
        </div>

        <ul className="border-t border-border-strong">
          {items.map((key) => (
            <li key={key} className="group flex items-center gap-4 border-b border-border py-4 text-[15.5px] text-text-2 transition-colors hover:text-text">
              <Facet className="transition-transform duration-200 group-hover:translate-x-1" />
              {t(`items.${key}`)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
