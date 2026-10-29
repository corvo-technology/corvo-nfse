"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { integrations, type IntegrationSale } from "@/lib/api";
import { formatDate } from "@/lib/i18n-helpers";
import { saleStatus } from "@/lib/integrations";
import { cleanTaxId, maskTaxId } from "@/lib/masks";

interface ConnectionSalesProps {
  connectionId: string;
  canManage: boolean;
  /** Called after a sale changed so the list behind the dialog refreshes. */
  onChanged: () => void;
}

export function ConnectionSales({ connectionId, canManage, onChanged }: ConnectionSalesProps) {
  const t = useTranslations("Integrations");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const { success, error: toastError } = useToast();
  const [sales, setSales] = useState<IntegrationSale[] | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [taxId, setTaxId] = useState("");
  const [saleBusy, setSaleBusy] = useState<string | null>(null);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" });

  const load = useCallback(async () => {
    try { setSales(await integrations.sales(connectionId)); } catch { setSales([]); }
  }, [connectionId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function update(saleId: string, work: () => Promise<unknown>) {
    setSaleBusy(saleId);
    try {
      await work();
      success(t("detail.saleDone"));
      setFixing(null);
      setTaxId("");
      await load();
      onChanged();
    } catch (cause) {
      toastError(`${t("detail.saleFailed")} ${cause instanceof Error ? cause.message : ""}`.trim());
    } finally {
      setSaleBusy(null);
    }
  }

  const taxIdOk = /^([0-9]{11}|[0-9A-Z]{14})$/.test(cleanTaxId(taxId));

  if (sales === null) return <p className="text-[13px] text-text-4">{tc("loading")}</p>;
  if (sales.length === 0) return <p className="text-[13.5px] text-text-3">{t("detail.sales.empty")}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border rounded-[12px] border border-border">
      {sales.map((sale) => {
        const s = saleStatus(sale);
        return (
          <li key={sale.id} className="flex flex-col gap-2 px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-text">{sale.customer?.name || t("detail.sales.anonymous")}</p>
                <p className="text-[12.5px] text-text-4">{sale.paidAt ? formatDate(sale.paidAt, locale) : formatDate(sale.createdAt, locale)} · {money.format(sale.amountCents / 100)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={s.tone}>{t(`detail.sale.${s.key}`)}</Badge>
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
