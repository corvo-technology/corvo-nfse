"use client";

import { useTranslations } from "next-intl";
import type { InvoiceCalculation } from "@/lib/types";

const TAX_ORDER = ["iss", "cbs", "ibsState", "ibsCity", "ibsTotal"] as const;

/** Result of POST /invoices/calculate: a pre-emission estimate, never a fiscal document. */
export function InvoiceCalculationPanel({ result, format }: { result: InvoiceCalculation; format: (value: string) => string }) {
  const t = useTranslations("Invoices.calculate");
  const taxes = TAX_ORDER.flatMap((key) => (result.taxes[key] ? [[key, result.taxes[key]] as const] : []));
  const ready = result.status === "ready";
  return (
    <section aria-label={t("title")} className="flex flex-col gap-3 rounded-[10px] border border-border-soft p-3.5 text-[13px]">
      <p className={`font-medium ${ready ? "text-accent" : "text-warn"}`}>{t(ready ? "ready" : "blocked")}</p>
      {taxes.length > 0 && (
        <dl className="flex flex-col gap-1.5">
          <dt className="eyebrow">{t("taxes")}</dt>
          {taxes.map(([key, tax]) => (
            <div key={key} className="flex items-baseline justify-between gap-3"><dd className="text-text-3">{t(`tax.${key}`)} · {Number(tax.rate)}%</dd><dd className="font-mono tabular-nums text-text-2">{format(tax.amount)}</dd></div>
          ))}
        </dl>
      )}
      {result.withholdings.length > 0 && (
        <dl className="flex flex-col gap-1.5">
          <dt className="eyebrow">{t("withholdings")}</dt>
          {result.withholdings.map((item) => (
            <div key={item.tax} className="flex items-baseline justify-between gap-3"><dd className="text-text-3">{item.tax} · {Number(item.rate)}%</dd><dd className="font-mono tabular-nums text-text-2">{format(item.amount)}</dd></div>
          ))}
        </dl>
      )}
      {ready && taxes.length === 0 && result.withholdings.length === 0 && <p className="text-text-4">{t("noTaxes")}</p>}
      {result.netReceivableAmount !== null && (
        <div className="flex items-baseline justify-between gap-3 border-t border-border-soft pt-2.5"><p className="text-text-3">{t("net")}</p><p className="font-mono tabular-nums text-text">{format(result.netReceivableAmount)}</p></div>
      )}
      {result.blocking && (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-text-2">{result.blocking.message}</p>
          <p className="font-mono text-[11.5px] text-text-4">{result.blocking.code}</p>
        </div>
      )}
      {result.pendingFields.length > 0 && (
        <div>
          <p className="eyebrow">{t("pending")}</p>
          <ul className="mt-1 list-disc pl-4 text-text-3">{result.pendingFields.map((item) => <li key={item.field}><span className="font-mono text-[12px]">{item.field}</span> · {item.reason}</li>)}</ul>
        </div>
      )}
      <p className="text-[12px] text-text-4">{t("disclaimer")}</p>
    </section>
  );
}
