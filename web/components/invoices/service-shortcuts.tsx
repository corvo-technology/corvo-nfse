"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoices as invoicesApi, serviceFavorites as favoritesApi } from "@/lib/api";
import { invoiceToFormValues } from "@/lib/invoice-copy";
import { maskCurrency } from "@/lib/masks";
import type { ServiceFavorite } from "@/lib/types";

/** The service fields a shortcut fills. A field left out is not touched. */
export interface ServiceFill { serviceDescription?: string; serviceCode?: string; municipalityCode?: string; amount?: string }

interface Props {
  companyId: string;
  /** Digits of the customer when it is a saved one; the "last invoice" shortcut only exists then. */
  savedCustomerTaxId: string | null;
  /** What the form holds now: the base of "save as favorite". */
  current: { description: string; serviceCode: string; municipalityCode: string; amountCents: number };
  onApply: (fill: ServiceFill) => void;
}

const LABEL_MAX = 80;
const defaultLabel = (description: string) => description.trim().replace(/\s+/g, " ").slice(0, 40);

/** Favorites of the company and the last invoice of the customer: two ways to fill the service in one click. */
export function ServiceShortcuts({ companyId, savedCustomerTaxId, current, onApply }: Props) {
  const t = useTranslations("Invoices.shortcuts");
  const [favorites, setFavorites] = useState<ServiceFavorite[]>([]);
  // The answer counts only for the company and customer it was asked for.
  const [lastAnswer, setLastAnswer] = useState<{ key: string; fill: ServiceFill } | null>(null);
  const lastKey = `${companyId}:${savedCustomerTaxId ?? ""}`;
  const last = lastAnswer?.key === lastKey ? lastAnswer.fill : null;
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    Promise.resolve().then(() => favoritesApi.list(companyId)).then((items) => { if (!cancelled) setFavorites(items); }).catch(() => { if (!cancelled) setFavorites([]); });
    return () => { cancelled = true; };
  }, [companyId]);

  useEffect(() => {
    if (!companyId || !savedCustomerTaxId) return;
    let cancelled = false;
    Promise.resolve().then(() => invoicesApi.list({ companyId, customerTaxId: savedCustomerTaxId, status: "authorized", limit: 1 }))
      .then((page) => {
        const invoice = page.items[0];
        if (cancelled || !invoice) return;
        const values = invoiceToFormValues(invoice, "");
        setLastAnswer({ key: lastKey, fill: { serviceDescription: values.serviceDescription, serviceCode: values.serviceCode, municipalityCode: values.municipalityCode, amount: values.amount } });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [companyId, savedCustomerTaxId, lastKey]);

  const canSave = current.description.trim() !== "" && /^\d{6}$/.test(current.serviceCode);

  const save = useCallback(async () => {
    setSaving(true);
    setFailed(false);
    try {
      const created = await favoritesApi.create(companyId, {
        label: label.trim() || defaultLabel(current.description),
        description: current.description.trim(),
        serviceCode: current.serviceCode,
        amountCents: current.amountCents > 0 ? current.amountCents : null,
        municipalityCode: /^\d{7}$/.test(current.municipalityCode) ? current.municipalityCode : null,
      });
      setFavorites((previous) => [...previous, created]);
      setNaming(false);
    } catch { setFailed(true); }
    finally { setSaving(false); }
  }, [companyId, label, current]);

  async function remove(favorite: ServiceFavorite) {
    try {
      await favoritesApi.remove(companyId, favorite.id);
      setFavorites((previous) => previous.filter((item) => item.id !== favorite.id));
    } catch { setFailed(true); }
  }

  const apply = (favorite: ServiceFavorite) => onApply({
    serviceDescription: favorite.description,
    serviceCode: favorite.serviceCode,
    ...(favorite.municipalityCode ? { municipalityCode: favorite.municipalityCode } : {}),
    ...(favorite.amountCents ? { amount: maskCurrency(String(favorite.amountCents)) } : {}),
  });

  if (favorites.length === 0 && !last && !canSave) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-soft bg-surface-alt p-3" data-testid="service-shortcuts">
      {last && (
        <div>
          <Button variant="accent" size="sm" onClick={() => onApply(last)}>{t("useLast")}</Button>
          <p className="mt-1 text-[12.5px] text-text-4">{t("useLastHint")}</p>
        </div>
      )}
      {favorites.length > 0 && (
        <div>
          <p className="mb-2 text-[12.5px] text-text-4">{t("favorites")}</p>
          <ul className="flex flex-wrap gap-2">
            {favorites.map((favorite) => (
              <li key={favorite.id} className="inline-flex items-center overflow-hidden rounded-full border border-border-soft bg-surface">
                <button type="button" className="px-3 py-1 text-[13px] text-text-2 hover:bg-surface-alt" onClick={() => apply(favorite)}>{favorite.label}</button>
                <button type="button" className="px-2 py-1 text-text-4 hover:text-text" aria-label={t("remove", { name: favorite.label })} onClick={() => remove(favorite)}><X size={12} aria-hidden /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {canSave && !naming && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => { setLabel(defaultLabel(current.description)); setNaming(true); }}><Star size={14} aria-hidden /> {t("save")}</Button>
        </div>
      )}
      {naming && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12.5px] text-text-4">
            {t("nameLabel")}
            <input className="field" value={label} maxLength={LABEL_MAX} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <Button size="sm" loading={saving} onClick={save}>{t("saveConfirm")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>{t("cancel")}</Button>
        </div>
      )}
      {failed && <p role="alert" className="text-[12.5px] text-danger">{t("failed")}</p>}
    </div>
  );
}
