"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { integrations, type IntegrationSale } from "@/lib/api";
import { saleStatus } from "@/lib/integrations";
import { cleanTaxId, maskTaxId } from "@/lib/masks";
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
  const locale = useLocale();
  const { success, error: toastError } = useToast();
  const [fixing, setFixing] = useState<string | null>(null);
  const [taxId, setTaxId] = useState("");
  const [saleBusy, setSaleBusy] = useState<string | null>(null);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" });
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "pt" ? "pt-BR" : "en-US", { dateStyle: "short", timeStyle: "short" });

  async function update(saleId: string, work: () => Promise<unknown>) {
    setSaleBusy(saleId);
    try {
      await work();
      success(t("detail.saleDone"));
      setFixing(null);
      setTaxId("");
      onChanged();
    } catch (cause) {
      toastError(`${t("detail.saleFailed")} ${apiError(cause, "")}`.trim());
    } finally {
      setSaleBusy(null);
    }
  }

  const taxIdOk = /^([0-9]{11}|[0-9A-Z]{14})$/.test(cleanTaxId(taxId));

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map(({ sale, source }) => {
        const s = saleStatus(sale);
        return (
          <li key={sale.id} className="flex flex-col gap-2 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-text">{sale.customer?.name || t("detail.sales.anonymous")} <span className="text-text-3">· {money.format(sale.amountCents / 100)}</span></p>
                <p className="text-[12.5px] text-text-4">{when(sale.paidAt ?? sale.createdAt)} · {source}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={s.tone}>{t(`detail.sale.${s.key}`)}</Badge>
                {sale.invoiceId && <Link href={`/app/invoices/${sale.invoiceId}`} className="btn btn-sm">{t("sales.viewInvoice")}</Link>}
                {canManage && s.canFixCustomer && fixing !== sale.id && (
                  <Button size="sm" variant="secondary" onClick={() => { setFixing(sale.id); setTaxId(""); }}>{t("detail.fixCustomer")}</Button>
                )}
                {canManage && s.canRetry && (
                  <Button size="sm" variant="secondary" loading={saleBusy === sale.id} onClick={() => void update(sale.id, () => integrations.retry(sale.id))}>{t("detail.tryAgain")}</Button>
                )}
              </div>
            </div>
            {fixing === sale.id && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => { e.preventDefault(); if (taxIdOk) void update(sale.id, async () => { await integrations.completeCustomer(sale.id, { taxId: cleanTaxId(taxId) }); await integrations.retry(sale.id); }); }}
              >
                <Field label={t("detail.taxIdLabel")} error={taxId && !taxIdOk ? t("detail.taxIdInvalid") : undefined} className="min-w-[14rem] flex-1">
                  {(control) => <Input {...control} inputMode="text" autoComplete="off" value={taxId} onChange={(e) => setTaxId(maskTaxId(e.target.value))} />}
                </Field>
                <Button type="submit" variant="accent" size="sm" disabled={!taxIdOk} loading={saleBusy === sale.id}>{t("detail.save")}</Button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
