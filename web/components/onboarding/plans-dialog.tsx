"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { plans } from "@/lib/api";
import type { PlanQuote } from "@/lib/types";
import { Modal } from "@/components/ui/modal";

/** First-steps explanation of the product and the plans. Informational only: nothing to pay here. */
export function PlansDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Onboarding");
  const locale = useLocale();
  const [quotes, setQuotes] = useState<PlanQuote[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    plans.list("monthly").then((page) => { if (!cancelled) setQuotes(page.items); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open]);

  const money = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL" });
  return (
    <Modal open={open} onClose={onClose} title={t("intro.title")} wide>
      <div className="flex flex-col gap-3 text-sm text-text-3">
        <p>{t("intro.p1")}</p>
        <p>{t("intro.p2")}</p>
        <p>{t("intro.p3")}</p>
      </div>
      {quotes.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-medium">{t("plans.title")}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {quotes.map((quote) => (
              <li key={quote.slug} className="rounded-lg border border-border p-3">
                <p className="font-medium">{quote.name}</p>
                <p className="text-sm">{t("plans.price", { price: money.format(quote.monthlyEquivalentCents / 100) })}</p>
                <p className="text-[12.5px] text-text-3">{t("plans.notes", { count: quote.monthlyAllowance })}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
