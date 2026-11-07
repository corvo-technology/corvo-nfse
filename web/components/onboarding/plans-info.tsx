"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { plans } from "@/lib/api";
import type { PlanQuote } from "@/lib/types";
import { AVULSO_MIN_UNITS, AVULSO_UNIT_CENTS } from "@/lib/plans-catalog";

/** First-steps explanation of the product and the plans. Informational only: nothing to pay here. */
export function PlansInfo() {
  const t = useTranslations("Onboarding");
  const locale = useLocale();
  const [quotes, setQuotes] = useState<PlanQuote[]>([]);

  useEffect(() => {
    let cancelled = false;
    plans.list("monthly").then((page) => { if (!cancelled) setQuotes(page.items); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const money = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL" });
  return (
    <>
      <div className="flex flex-col gap-2 text-sm text-text-3">
        <p>{t("intro.p1")}</p>
        <p>{t("intro.p2")}</p>
        <p className="text-text-2">{t("intro.p3")}</p>
      </div>

      <h3 className="eyebrow mt-6">{t("plans.title")}</h3>
      {quotes.length > 0 && (
        <ul className="mt-2 divide-y divide-border border-y border-border">
          {quotes.map((quote) => (
            <li key={quote.slug} className="flex items-baseline justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{quote.name}</p>
                <p className="text-[12.5px] text-text-3">{t("plans.notes", { count: quote.monthlyAllowance })}</p>
              </div>
              <p className="flex-none text-sm tabular-nums">{t("plans.price", { price: money.format(quote.monthlyEquivalentCents / 100) })}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[12.5px] text-text-4">{t("plans.quotaNote")}</p>

      <div className="mt-5 rounded-[10px] border border-accent-border bg-accent-surface p-4">
        <p className="text-sm font-medium">{t("plans.avulsoTitle")}</p>
        <p className="mt-1 text-[13px] text-text-2">{t("plans.avulsoBody", { price: money.format(AVULSO_UNIT_CENTS / 100), min: AVULSO_MIN_UNITS })}</p>
      </div>
    </>
  );
}
