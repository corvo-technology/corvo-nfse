"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { emptyItem, type NfeItemForm } from "@/lib/nfe-form";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

interface NfeItemsEditorProps {
  items: NfeItemForm[];
  onChange: (items: NfeItemForm[]) => void;
  /** Problems by field path, as the API names them (`items[1].ncm`). */
  errors: Record<string, string>;
}

/** The products of the note: add, remove and edit. The totals shown elsewhere are only a preview. */
export function NfeItemsEditor({ items, onChange, errors }: NfeItemsEditorProps) {
  const t = useTranslations("Nfe.form.items");
  const set = (index: number, patch: Partial<NfeItemForm>) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  return (
    <div className="flex flex-col gap-4">
      {items.map((item, index) => {
        const error = (field: string) => errors[`items[${index}].${field}`];
        return (
          <fieldset key={index} className="grid gap-3 rounded-[12px] border border-border p-4 sm:grid-cols-6">
            <legend className="px-1 text-sm text-text-3">{t("item", { number: index + 1 })}</legend>
            <Field className="sm:col-span-2" label={t("code")} error={error("code")} required>{(c) => <Input {...c} maxLength={60} value={item.code} onChange={(e) => set(index, { code: e.target.value })} />}</Field>
            <Field className="sm:col-span-4" label={t("description")} error={error("description")} required>{(c) => <Input {...c} maxLength={120} value={item.description} onChange={(e) => set(index, { description: e.target.value })} />}</Field>
            <Field className="sm:col-span-2" label={t("ncm")} hint={t("ncmHint")} error={error("ncm")} required>{(c) => <Input {...c} inputMode="numeric" maxLength={10} value={item.ncm} onChange={(e) => set(index, { ncm: e.target.value })} />}</Field>
            <Field className="sm:col-span-2" label={t("cfop")} hint={t("cfopHint")} error={error("cfop")} required>{(c) => <Input {...c} inputMode="numeric" maxLength={4} value={item.cfop} onChange={(e) => set(index, { cfop: e.target.value })} />}</Field>
            <Field className="sm:col-span-2" label={t("csosn")} hint={t("csosnHint")} error={error("tax.csosn")}>
              {(c) => (
                <select {...c} className="field" value={item.csosn} onChange={(e) => set(index, { csosn: e.target.value as NfeItemForm["csosn"] })}>
                  <option value="">{t("csosnDefault")}</option>
                  <option value="102">102</option>
                  <option value="400">400</option>
                </select>
              )}
            </Field>
            <Field className="sm:col-span-2" label={t("unit")} error={error("unit")} required>{(c) => <Input {...c} maxLength={6} value={item.unit} onChange={(e) => set(index, { unit: e.target.value })} />}</Field>
            <Field className="sm:col-span-2" label={t("quantity")} error={error("quantity")} required>{(c) => <Input {...c} inputMode="decimal" value={item.quantity} onChange={(e) => set(index, { quantity: e.target.value })} />}</Field>
            <Field className="sm:col-span-2" label={t("unitPrice")} error={error("unitPrice")} required>{(c) => <Input {...c} inputMode="decimal" value={item.unitPrice} onChange={(e) => set(index, { unitPrice: e.target.value })} />}</Field>
            {error("") && <p role="alert" className="text-[12.5px] text-danger sm:col-span-6">{error("")}</p>}
            {items.length > 1 && (
              <div className="sm:col-span-6">
                <Button variant="ghost" onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label={t("remove", { number: index + 1 })}><Trash2 size={14} aria-hidden />{t("removeShort")}</Button>
              </div>
            )}
          </fieldset>
        );
      })}
      <div><Button variant="secondary" onClick={() => onChange([...items, emptyItem()])}><Plus size={14} aria-hidden />{t("add")}</Button></div>
    </div>
  );
}
