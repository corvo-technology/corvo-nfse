"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { integrations, type IntegrationConnection, type IntegrationProvider, type IntegrationSale } from "@/lib/api";
import { formatDate } from "@/lib/i18n-helpers";
import { connectionStatus, saleStatus } from "@/lib/integrations";
import { cleanTaxId, maskTaxId } from "@/lib/masks";

interface ConnectionDialogProps {
  connection: IntegrationConnection;
  provider?: IntegrationProvider;
  companyName: string;
  canManage: boolean;
  onClose: () => void;
  /** Called after any change so the list behind the dialog refreshes. */
  onChanged: () => void;
}

export function ConnectionDialog({ connection, provider, companyName, canManage, onClose, onChanged }: ConnectionDialogProps) {
  const t = useTranslations("Integrations");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const { success, error: toastError } = useToast();
  const [current, setCurrent] = useState(connection);
  const [sales, setSales] = useState<IntegrationSale[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [taxId, setTaxId] = useState("");
  const [saleBusy, setSaleBusy] = useState<string | null>(null);

  const status = connectionStatus(current);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" });

  const loadSales = useCallback(async () => {
    try { setSales(await integrations.sales(connection.id)); } catch { setSales([]); }
  }, [connection.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadSales(); }, [loadSales]);

  async function change(action: () => Promise<IntegrationConnection>) {
    setBusy(true);
    try {
      setCurrent(await action());
      success(t("detail.updated"));
      onChanged();
    } catch (cause) {
      toastError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setConfirmingDisconnect(false);
    }
  }

  async function updateSale(saleId: string, work: () => Promise<unknown>) {
    setSaleBusy(saleId);
    try {
      await work();
      success(t("detail.saleDone"));
      setFixing(null);
      setTaxId("");
      await loadSales();
      onChanged();
    } catch (cause) {
      toastError(`${t("detail.saleFailed")} ${cause instanceof Error ? cause.message : ""}`.trim());
    } finally {
      setSaleBusy(null);
    }
  }

  const taxIdOk = /^([0-9]{11}|[0-9A-Z]{14})$/.test(cleanTaxId(taxId));

  return (
    <Modal open onClose={onClose} title={provider?.name ?? current.provider} wide>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge variant={status.tone}>{t(`status.${status.key}`)}</Badge>
          <span className="text-[13.5px] text-text-3">{companyName}</span>
        </div>

        {current.state === "paused" && <p className="text-[13.5px] text-warn">{t("detail.pausedHint")}</p>}
        {current.state === "reauth_required" && <p role="alert" className="text-[13.5px] text-danger">{t("detail.reconnectHint")}</p>}

        <div className="flex flex-col gap-1.5">
          <span className="field-label">{t("detail.webhookUrl")}</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-[10px] border border-border bg-black/20 px-3 py-2 font-mono text-[12.5px] text-text-2">{current.webhookUrl}</code>
            <Button
              variant="secondary"
              size="sm"
              aria-label={tc("copy")}
              onClick={() => { void navigator.clipboard.writeText(current.webhookUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
            >
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              {copied ? tc("copied") : tc("copy")}
            </Button>
          </div>
          <p className="field-hint">{t("detail.webhookUrlHint")}</p>
        </div>

        <section aria-labelledby="sales-title" className="flex flex-col gap-2">
          <h3 id="sales-title" className="text-[14px] font-medium text-text">{t("detail.sales.title")}</h3>
          {sales === null ? (
            <p className="text-[13px] text-text-4">{tc("loading")}</p>
          ) : sales.length === 0 ? (
            <p className="text-[13.5px] text-text-3">{t("detail.sales.empty")}</p>
          ) : (
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
                          <Button size="sm" variant="secondary" loading={saleBusy === sale.id} onClick={() => void updateSale(sale.id, () => integrations.retry(sale.id))}>{t("detail.tryAgain")}</Button>
                        )}
                      </div>
                    </div>
                    {fixing === sale.id && (
                      <form
                        className="flex flex-wrap items-end gap-2"
                        onSubmit={(e) => { e.preventDefault(); if (taxIdOk) void updateSale(sale.id, async () => { await integrations.completeCustomer(sale.id, { taxId: cleanTaxId(taxId) }); await integrations.retry(sale.id); }); }}
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
          )}
        </section>

        {canManage && current.state !== "disconnected" && (
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            {confirmingDisconnect ? (
              <>
                <p className="mr-auto max-w-[44ch] text-[13px] text-text-3">{t("detail.confirmDisconnect")}</p>
                <Button variant="ghost" onClick={() => setConfirmingDisconnect(false)} disabled={busy}>{tc("cancel")}</Button>
                <Button variant="danger" loading={busy} onClick={() => void change(() => integrations.disconnect(current.id))}>{t("detail.confirmYes")}</Button>
              </>
            ) : (
              <>
                {current.state === "active" && <Button variant="secondary" loading={busy} onClick={() => void change(() => integrations.pause(current.id))}>{t("detail.pause")}</Button>}
                {current.state === "paused" && <Button variant="accent" loading={busy} onClick={() => void change(() => integrations.activate(current.id))}>{t("detail.resume")}</Button>}
                <Button variant="ghost" onClick={() => setConfirmingDisconnect(true)}>{t("detail.disconnect")}</Button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
