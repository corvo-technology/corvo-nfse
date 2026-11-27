"use client";

import { Select } from "@/components/ui/select";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { emptyItem, lineTotal, maskNcm, type NfeItemForm } from "@/lib/nfe-form";
import { maskCurrency } from "@/lib/masks";
import { loadProducts, type SavedProduct } from "@/lib/nfe-products";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

interface NfeItemsEditorProps {
  items: NfeItemForm[];
  onChange: (items: NfeItemForm[]) => void;
  /** Problems by field path, as the API names them (`items[1].ncm`). */
  errors: Record<string, string>;
  /** CSOSN of the company, shown as what "default" means. */
  defaultCsosn?: string;
  /** CFOP that fits the recipient (5102 / 6102); empty while unknown. */
  suggestedCfop?: string;
}

const NCM_LOOKUP = "https://portalunico.siscomex.gov.br/classif/#/sumario?perfil=publico";

/** The products of the note: add, remove and edit. The totals shown are only a preview. */
export function NfeItemsEditor({ items, onChange, errors, defaultCsosn, suggestedCfop }: NfeItemsEditorProps) {
  const t = useTranslations("Nfe.form.items");
  const locale = useLocale();
  const money = (value: number) => new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL" }).format(value);
  const [saved] = useState<SavedProduct[]>(loadProducts);
  const set = (index: number, patch: Partial<NfeItemForm>) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const add = (product?: SavedProduct) => onChange([...items, { ...emptyItem(), ...(suggestedCfop ? { cfop: suggestedCfop } : {}), ...product, cfopManual: false }]);
  // The last item is the one that is still empty: a saved product fills it instead of adding a row.
  const use = (index: number, product: SavedProduct) => set(index, { ...product, quantity: items[index].quantity || "1", cfopManual: false, cfop: suggestedCfop || product.cfop });
  return (
    <div className="flex flex-col gap-4">
      {items.map((item, index) => {
        const error = (field: string) => errors[`items[${index}].${field}`];
        return (
          <fieldset key={index} className="grid items-start gap-3 rounded-[12px] border border-border p-4 sm:grid-cols-6">
            <legend className="px-1 text-sm text-text-3">{t("item", { number: index + 1 })}</legend>
            {saved.length > 0 && item.description === "" && (
              <div className="sm:col-span-6">
                <Select aria-label={t("useSaved")} value="" onChange={(e) => { const found = saved[Number(e.target.value)]; if (found) use(index, found); }}>
                  <option value="">{t("useSaved")}</option>
                  {saved.map((product, i) => <option key={`${product.description}-${i}`} value={i}>{product.description}</option>)}
                </Select>
              </div>
            )}
            <Field className="sm:col-span-4" label={t("description")} error={error("description")} required>{(c) => <Input {...c} maxLength={120} placeholder={t("descriptionPlaceholder")} value={item.description} onChange={(e) => set(index, { description: e.target.value })} />}</Field>
            <Field className="sm:col-span-2" label={t("code")} hint={t("codeHint")} error={error("code")} optionalLabel={t("optional")}>{(c) => <Input {...c} maxLength={60} placeholder={t("codePlaceholder", { number: index + 1 })} value={item.code} onChange={(e) => set(index, { code: e.target.value })} />}</Field>
            <Field className="sm:col-span-2" label={t("ncm")} hint={t("ncmHint")} error={error("ncm")} required>
              {(c) => <Input {...c} inputMode="numeric" maxLength={10} placeholder={t("ncmPlaceholder")} value={maskNcm(item.ncm)} onChange={(e) => set(index, { ncm: e.target.value.replace(/\D/g, "").slice(0, 8) })} />}
            </Field>
            <Field className="sm:col-span-2" label={t("cfop")} hint={t("cfopHint")} error={error("cfop")} required>{(c) => <Input {...c} inputMode="numeric" maxLength={4} placeholder="5102" value={item.cfop} onChange={(e) => set(index, { cfop: e.target.value.replace(/\D/g, "").slice(0, 4), cfopManual: true })} />}</Field>
            <Field className="sm:col-span-2" label={t("csosn")} hint={t("csosnHint")} error={error("tax.csosn")}>
              {(c) => (
                <Select {...c} value={item.csosn} onChange={(e) => set(index, { csosn: e.target.value as NfeItemForm["csosn"] })}>
                  <option value="">{defaultCsosn ? t("csosnDefaultWith", { csosn: defaultCsosn }) : t("csosnDefault")}</option>
                  <option value="102">102</option>
                  <option value="400">400</option>
                </Select>
              )}
            </Field>
            <p className="-mt-1 text-[12.5px] text-text-3 sm:col-span-6"><a href={NCM_LOOKUP} target="_blank" rel="noreferrer" className="underline">{t("ncmLookup")}</a></p>
            <Field className="sm:col-span-2" label={t("unit")} error={error("unit")}>{(c) => <Input {...c} maxLength={6} placeholder="UN" value={item.unit} onChange={(e) => set(index, { unit: e.target.value.toUpperCase() })} />}</Field>
            <Field className="sm:col-span-2" label={t("quantity")} error={error("quantity")} required>{(c) => <Input {...c} inputMode="decimal" placeholder="1" value={item.quantity} onChange={(e) => set(index, { quantity: e.target.value.replace(/[^\d.,]/g, "") })} />}</Field>
            <Field className="sm:col-span-2" label={t("unitPrice")} error={error("unitPrice")} required>{(c) => <Input {...c} inputMode="decimal" placeholder="0,00" value={item.unitPrice} onChange={(e) => set(index, { unitPrice: maskCurrency(e.target.value) })} />}</Field>
            <p className="text-right text-sm text-text-2 sm:col-span-6">{t("lineTotal")}: <strong className="font-mono">{money(lineTotal(item))}</strong></p>
            {error("") && <p role="alert" className="text-[12.5px] text-danger sm:col-span-6">{error("")}</p>}
            {items.length > 1 && (
              <div className="sm:col-span-6">
                <Button variant="ghost" onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label={t("remove", { number: index + 1 })}><Trash2 size={14} aria-hidden />{t("removeShort")}</Button>
              </div>
            )}
          </fieldset>
        );
      })}
      <div><Button variant="secondary" onClick={() => add()}><Plus size={14} aria-hidden />{t("add")}</Button></div>
    </div>
  );
}
