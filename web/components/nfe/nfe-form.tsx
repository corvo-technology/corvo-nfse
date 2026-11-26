"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { fieldIssues } from "@/lib/api-errors";
import { createNfe, resubmitNfe, validateNfe } from "@/lib/nfe";
import { emptyPayment, issueErrors, paidPreview, PAYMENT_MEANS, toCreateInput, totalsPreview, type NfeFormState } from "@/lib/nfe-form";
import type { Company } from "@/lib/types";
import { useApiErrorText } from "@/lib/use-api-error";
import { NfeItemsEditor } from "@/components/nfe/nfe-items-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

interface NfeFormProps {
  companies: Company[];
  initial: NfeFormState;
  /** Set when a rejected note is being fixed: the form then sends `PUT` to the same note. */
  resubmitId?: string;
}

const TOP_LEVEL = ["companyId", "natOp", "change", "additionalInfo"];
/** Fields the form draws; a problem on any other field is listed on top, so it is never lost. */
const isPlaced = (field: string) => /^(items|payments)\[\d+\]\./.test(field) || /^recipient\.(taxId|name|indIeDest|stateRegistration|email|address\.(street|number|complement|district|zip|cityCode|city|state))$/.test(field) || TOP_LEVEL.includes(field);

export function NfeForm({ companies, initial, resubmitId }: NfeFormProps) {
  const t = useTranslations("Nfe.form");
  const tPay = useTranslations("Nfe.form.paymentMeans");
  const te = useTranslations("ApiErrors");
  const locale = useLocale();
  const router = useRouter();
  const apiError = useApiErrorText();
  const [form, setForm] = useState<NfeFormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"validate" | "submit" | null>(null);
  const inFlight = useRef(false);
  // One key for what is on the screen: a double click or a retry sends the same key (so the same note);
  // another content gets another key, because the API refuses one key with two contents.
  const key = useRef<{ body: string; value: string } | null>(null);

  const setRecipient = (patch: Partial<NfeFormState["recipient"]>) => setForm((current) => ({ ...current, recipient: { ...current.recipient, ...patch } }));
  const err = (field: string) => errors[field];
  const money = (value: number) => new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL" }).format(value);
  const total = totalsPreview(form.items);
  const paid = paidPreview(form.payments, form.change);
  const translate = (code: string, fallback: string) => (te.has(code) ? te(code) : fallback);

  function show(cause: unknown) {
    const found = issueErrors(cause, translate);
    setErrors(found);
    const unplaced = fieldIssues(cause).filter((issue) => !isPlaced(issue.field)).map((issue) => `${issue.field}: ${translate(issue.code.replace(/^ERROR_/i, "").toLowerCase(), issue.message)}`);
    const general = apiError(cause, t("failed"));
    setBanner(unplaced.length > 0 ? [general, ...unplaced].join(" · ") : Object.keys(found).length > 0 ? t("fixFields") : general);
  }

  async function run(kind: "validate" | "submit") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(kind); setBanner(null); setErrors({}); setPreview(null);
    try {
      const input = toCreateInput(form);
      if (kind === "validate") {
        const result = await validateNfe(input);
        setPreview(result.accessKeyPreview);
        return;
      }
      const body = JSON.stringify(input);
      if (key.current?.body !== body) key.current = { body, value: crypto.randomUUID() };
      const accepted = resubmitId ? await resubmitNfe(resubmitId, input, key.current.value) : await createNfe(input, key.current.value);
      router.push(`/app/nfe/${accepted.id}`);
    } catch (cause) { show(cause); }
    finally { inFlight.current = false; setBusy(null); }
  }

  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void run("submit"); }} className="flex flex-col gap-6">
      <p role="note" className="banner">{t("homologation")}</p>
      {banner && <p role="alert" className="banner banner-danger">{banner}</p>}
      {preview && <p role="status" className="banner banner-ok">{t("validOk", { key: preview })}</p>}

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="font-medium sm:col-span-2">{t("issuer")}</h2>
        <Field label={t("company")} error={err("companyId")} required>
          {(c) => (
            <select {...c} className="field" value={form.companyId} disabled={resubmitId !== undefined} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
              <option value="">{t("companyChoose")}</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.tradeName || company.legalName}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("natOp")} hint={t("natOpHint")} error={err("natOp")}>{(c) => <Input {...c} maxLength={60} value={form.natOp} onChange={(e) => setForm({ ...form, natOp: e.target.value })} />}</Field>
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-6">
        <h2 className="font-medium sm:col-span-6">{t("recipient")}</h2>
        <Field className="sm:col-span-3" label={t("name")} error={err("recipient.name")} required>{(c) => <Input {...c} maxLength={60} value={form.recipient.name} onChange={(e) => setRecipient({ name: e.target.value })} />}</Field>
        <Field className="sm:col-span-3" label={t("taxId")} hint={t("taxIdHint")} error={err("recipient.taxId")} required>{(c) => <Input {...c} inputMode="text" value={form.recipient.taxId} onChange={(e) => setRecipient({ taxId: e.target.value })} />}</Field>
        <Field className="sm:col-span-3" label={t("indIeDest")} hint={t("indIeDestHint")} error={err("recipient.indIeDest")} required>
          {(c) => (
            <select {...c} className="field" value={form.recipient.indIeDest} onChange={(e) => setRecipient({ indIeDest: e.target.value as "1" | "2" | "9" })}>
              <option value="9">{t("ie9")}</option>
              <option value="1">{t("ie1")}</option>
              <option value="2">{t("ie2")}</option>
            </select>
          )}
        </Field>
        {form.recipient.indIeDest === "1" && <Field className="sm:col-span-3" label={t("stateRegistration")} error={err("recipient.stateRegistration")} required>{(c) => <Input {...c} value={form.recipient.stateRegistration} onChange={(e) => setRecipient({ stateRegistration: e.target.value })} />}</Field>}
        <Field className="sm:col-span-3" label={t("email")} hint={t("emailHint")} error={err("recipient.email")}>{(c) => <Input {...c} type="email" value={form.recipient.email} onChange={(e) => setRecipient({ email: e.target.value })} />}</Field>
        <Field className="sm:col-span-4" label={t("street")} error={err("recipient.address.street")} required>{(c) => <Input {...c} maxLength={60} value={form.recipient.street} onChange={(e) => setRecipient({ street: e.target.value })} />}</Field>
        <Field className="sm:col-span-2" label={t("number")} error={err("recipient.address.number")} required>{(c) => <Input {...c} maxLength={60} value={form.recipient.number} onChange={(e) => setRecipient({ number: e.target.value })} />}</Field>
        <Field className="sm:col-span-3" label={t("complement")} error={err("recipient.address.complement")}>{(c) => <Input {...c} maxLength={60} value={form.recipient.complement} onChange={(e) => setRecipient({ complement: e.target.value })} />}</Field>
        <Field className="sm:col-span-3" label={t("district")} error={err("recipient.address.district")} required>{(c) => <Input {...c} maxLength={60} value={form.recipient.district} onChange={(e) => setRecipient({ district: e.target.value })} />}</Field>
        <Field className="sm:col-span-2" label={t("zip")} error={err("recipient.address.zip")} required>{(c) => <Input {...c} inputMode="numeric" value={form.recipient.zip} onChange={(e) => setRecipient({ zip: e.target.value })} />}</Field>
        <Field className="sm:col-span-2" label={t("city")} error={err("recipient.address.city")} required>{(c) => <Input {...c} maxLength={60} value={form.recipient.city} onChange={(e) => setRecipient({ city: e.target.value })} />}</Field>
        <Field className="sm:col-span-1" label={t("state")} error={err("recipient.address.state")} required>{(c) => <Input {...c} maxLength={2} value={form.recipient.state} onChange={(e) => setRecipient({ state: e.target.value })} />}</Field>
        <Field className="sm:col-span-1" label={t("cityCode")} hint={t("cityCodeHint")} error={err("recipient.address.cityCode")} required>{(c) => <Input {...c} inputMode="numeric" maxLength={7} value={form.recipient.cityCode} onChange={(e) => setRecipient({ cityCode: e.target.value })} />}</Field>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-medium">{t("items.title")}</h2>
        <p className="text-sm text-text-3">{t("taxNotice")}</p>
        <NfeItemsEditor items={form.items} onChange={(items) => setForm({ ...form, items })} errors={errors} />
        <p className="text-right text-sm text-text-2">{t("totalPreview")}: <strong className="font-mono">{money(total)}</strong></p>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-medium">{t("payments.title")}</h2>
        {form.payments.map((payment, index) => (
          <div key={index} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field label={t("payments.means")} error={err(`payments[${index}].tPag`)}>
              {(c) => (
                <select {...c} className="field" value={payment.tPag} onChange={(e) => setForm({ ...form, payments: form.payments.map((p, i) => (i === index ? { ...p, tPag: e.target.value } : p)) })}>
                  {PAYMENT_MEANS.map((means) => <option key={means} value={means}>{tPay(means)}</option>)}
                </select>
              )}
            </Field>
            <Field label={t("payments.amount")} error={err(`payments[${index}].amount`)} required>{(c) => <Input {...c} inputMode="decimal" value={payment.amount} onChange={(e) => setForm({ ...form, payments: form.payments.map((p, i) => (i === index ? { ...p, amount: e.target.value } : p)) })} />}</Field>
            {form.payments.length > 1 && <Button variant="ghost" onClick={() => setForm({ ...form, payments: form.payments.filter((_, i) => i !== index) })} aria-label={t("payments.remove", { number: index + 1 })}><Trash2 size={14} aria-hidden /></Button>}
          </div>
        ))}
        <div><Button variant="secondary" onClick={() => setForm({ ...form, payments: [...form.payments, emptyPayment()] })}><Plus size={14} aria-hidden />{t("payments.add")}</Button></div>
        <Field label={t("payments.change")} hint={t("payments.changeHint")} error={err("change")}>{(c) => <Input {...c} inputMode="decimal" value={form.change} onChange={(e) => setForm({ ...form, change: e.target.value })} />}</Field>
        <p className={`text-right text-sm ${Math.abs(paid - total) < 0.005 ? "text-text-2" : "text-warn"}`}>{t("payments.balance", { paid: money(paid), total: money(total) })}</p>
      </Card>

      <Card className="grid gap-4 p-5">
        <Field label={t("additionalInfo")} error={err("additionalInfo")}>{(c) => <textarea {...c} className="field resize-y" rows={3} maxLength={5000} value={form.additionalInfo} onChange={(e) => setForm({ ...form, additionalInfo: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-sm text-text-2"><input type="checkbox" checked={form.sendEmail} onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })} />{t("sendEmail")}</label>
      </Card>

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" loading={busy === "validate"} disabled={busy !== null} onClick={() => void run("validate")}>{t("validate")}</Button>
        <Button type="submit" variant="accent" loading={busy === "submit"} disabled={busy !== null}>{resubmitId ? t("resubmit") : t("issue")}</Button>
      </div>
    </form>
  );
}
