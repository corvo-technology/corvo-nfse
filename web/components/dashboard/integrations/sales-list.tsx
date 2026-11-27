"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { integrations, type IntegrationSale } from "@/lib/api";
import { saleStatus } from "@/lib/integrations";
import { useIntegrationErrorText } from "@/lib/use-integration-error";
import { useApiErrorText } from "@/lib/use-api-error";

export interface SaleRow {
  sale: IntegrationSale;
  /** Which integration it came from, e.g. "Woovi · Acme". */
  source: string;
}

interface SalesListProps {
  rows: SaleRow[];
  canManage: boolean;
  /** Called after a sale changed so the page refreshes. */
  onChanged: () => void;
}

export function SalesList({ rows, canManage, onChanged }: SalesListProps) {
  const t = useTranslations("Integrations");
  const apiError = useApiErrorText();
  const errorText = useIntegrationErrorText();
  const locale = useLocale();
  const { success, error: toastError } = useToast();
  const [saleBusy, setSaleBusy] = useState<string | null>(null);
  // What the last "try again" said, for each sale, so the button never answers with silence.
  const [feedback, setFeedback] = useState<Record<string, { ok: boolean; text: string }>>({});
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" });
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "pt" ? "pt-BR" : "en-US", { dateStyle: "short", timeStyle: "short" });

  async function retry(saleId: string) {
    setSaleBusy(saleId);
    try {
      const result = await integrations.retry(saleId);
      if (result.state === "processed") {
        success(t("tryAgainDone"));
        setFeedback((prev) => ({ ...prev, [saleId]: { ok: true, text: t("tryAgainDone") } }));
      } else {
        setFeedback((prev) => ({ ...prev, [saleId]: { ok: false, text: `${t("tryAgainStill")} ${errorText(result.lastError) || t("detail.sale.needsAttention")}` } }));
      }
      onChanged();
    } catch (cause) {
      toastError(`${t("detail.saleFailed")} ${apiError(cause, "")}`.trim());
    } finally {
      setSaleBusy(null);
    }
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map(({ sale, source }) => {
        const s = saleStatus(sale);
        const reason = sale.fiscalStatus === "needs_attention" || sale.fiscalStatus === "blocked" ? errorText(sale.blockReason) : "";
        const saleHref = `/app/integrations/sales/${sale.id}`;
        const name = sale.customer?.name || t("detail.sales.anonymous");
        const answer = feedback[sale.id];
        return (
          <li key={sale.id} className="flex flex-col gap-2 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-text">
                  {s.canResolve ? <Link href={saleHref} className="hover:underline">{name}</Link> : name} <span className="text-text-3">· {money.format(sale.amountCents / 100)}</span>
                </p>
                <p className="text-[12.5px] text-text-4">{when(sale.paidAt ?? sale.createdAt)} · {source}</p>
                {reason && <p className="mt-0.5 text-[13px] text-warn">{reason}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={s.tone}>{t(`detail.sale.${s.key}`)}</Badge>
                {sale.invoiceId && <Link href={`/app/invoices/${sale.invoiceId}`} className="btn btn-sm">{t("sales.viewInvoice")}</Link>}
                {canManage && s.canResolve && <Link href={saleHref} className="btn btn-accent btn-sm">{t("resolveAction")}</Link>}
                {canManage && s.canRetry && (
                  <Button size="sm" variant="secondary" loading={saleBusy === sale.id} onClick={() => void retry(sale.id)}>{t("detail.tryAgain")}</Button>
                )}
              </div>
            </div>
            {answer && <p role="status" className={answer.ok ? "text-[13px] text-accent" : "text-[13px] text-warn"}>{answer.text}</p>}
          </li>
        );
      })}
    </ul>
  );
}
