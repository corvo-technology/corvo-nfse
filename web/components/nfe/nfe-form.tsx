"use client";

import { Select } from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { fieldIssues } from "@/lib/api-errors";
import { schedules as schedulesApi } from "@/lib/api";
import { createNfe, getNfeSettings, resubmitNfe, validateNfe, type NfeSettings } from "@/lib/nfe";
import { maskCurrency, maskState, maskTaxId, maskZip } from "@/lib/masks";
import { rememberProducts } from "@/lib/nfe-products";
import { emptyPayment, ieExample, issueErrors, paidPreview, PAYMENT_MEANS, suggestedCfop, toCreateInput, toMoneyText, totalsPreview, type NfeFormState, type NfeItemForm } from "@/lib/nfe-form";
import type { Company } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { useApiErrorText } from "@/lib/use-api-error";
import { NfeItemsEditor } from "@/components/nfe/nfe-items-editor";
import { ISSUE_NOW, NfeScheduleOptions, type NfeWhen } from "@/components/nfe/nfe-schedule-options";
import { useRecipientAutofill } from "@/components/nfe/use-recipient-autofill";
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
  const { fiscalEnvironment, features } = useAuth();
  // Live notes are not open yet: say it, and keep the emit button off (the dry-run stays).
  const productionLocked = fiscalEnvironment === "live" && !features.nfeProduction;
  const [form, setForm] = useState<NfeFormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [when, setWhen] = useState<NfeWhen>(ISSUE_NOW);
  const scheduling = resubmitId === undefined && when.mode !== "now";
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"validate" | "submit" | null>(null);
  const inFlight = useRef(false);
  // One key for what is on the screen: a double click or a retry sends the same key (so the same note);
  // another content gets another key, because the API refuses one key with two contents.
  const key = useRef<{ body: string; value: string } | null>(null);

  const [settings, setSettings] = useState<NfeSettings | null>(null);
  const [editCityCode, setEditCityCode] = useState(false);
  // The payment follows the total of the items until the person types it themselves.
  const [payTouched, setPayTouched] = useState(resubmitId !== undefined || initial.payments.some((payment) => payment.amount.trim() !== ""));

  // What the company already defines (nature of the operation, CSOSN): shown as the placeholder. A failure is quiet.
  useEffect(() => {
    if (!form.companyId) return;
    const abort = new AbortController();
    getNfeSettings(form.companyId, abort.signal).then((value) => { if (!abort.signal.aborted) setSettings(value); }).catch(() => undefined);
    return () => abort.abort();
  }, [form.companyId]);

  const issuerState = companies.find((company) => company.id === form.companyId)?.address?.state;
  const cfop = suggestedCfop(issuerState, form.recipient.state);
  // 5102 inside the state, 6102 to another one: shown on the items whose CFOP the person did not type.
  const items = form.items.map((item) => (item.cfopManual || !cfop ? item : { ...item, cfop }));

  const setItems = (changed: NfeItemForm[]) => setForm((current) => ({
    ...current, items: changed,
    payments: !payTouched && current.payments.length === 1 ? [{ ...current.payments[0], amount: totalsPreview(changed) > 0 ? toMoneyText(totalsPreview(changed)) : "" }] : current.payments,
  }));
  const setRecipient = (patch: Partial<NfeFormState["recipient"]>) => setForm((current) => ({ ...current, recipient: { ...current.recipient, ...patch } }));
  const autofilled = useRecipientAutofill(form.recipient, (patch) => setRecipient(patch));
  const err = (field: string) => errors[field];
  const money = (value: number) => new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL" }).format(value);
  const total = totalsPreview(items);
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
      const input = toCreateInput({ ...form, items });
      if (kind === "validate") {
        const result = await validateNfe(input);
        setPreview(result.accessKeyPreview);
        return;
      }
      const body = JSON.stringify(scheduling ? { input, when } : input);
      if (key.current?.body !== body) key.current = { body, value: crypto.randomUUID() };
      if (scheduling) {
        if (!when.firstDate) { setErrors({ firstDate: t("schedule.dateRequired") }); setBanner(t("fixFields")); return; }
        // The NF-e is checked now, as a dry-run would: it never becomes a schedule while it is broken.
        const created = await schedulesApi.createNfe(input, { firstDate: when.firstDate, ...(when.mode === "recurring" ? { frequency: when.frequency, ...(when.endsOn ? { endsOn: when.endsOn } : {}) } : {}) }, key.current.value);
        rememberProducts(items);
        router.push(`/app/schedules/${created.id}`);
        return;
      }
      const accepted = resubmitId ? await resubmitNfe(resubmitId, input, key.current.value) : await createNfe(input, key.current.value);
      rememberProducts(items);
      router.push(`/app/nfe/${accepted.id}`);
    } catch (cause) { show(cause); }
    finally { inFlight.current = false; setBusy(null); }
  }

  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void run("submit"); }} className="flex flex-col gap-6">
      {fiscalEnvironment === "test" && <p role="note" className="banner">{t("homologation")}</p>}
      {productionLocked && <p role="note" className="banner banner-warn">{t("productionLocked")}</p>}
      {banner && <p role="alert" className="banner banner-danger">{banner}</p>}
      {preview && <p role="status" className="banner banner-ok">{t("validOk", { key: preview })}</p>}

      <Card className="grid items-start gap-4 p-5 sm:grid-cols-2">
        <h2 className="font-medium sm:col-span-2">{t("issuer")}</h2>
        <Field label={t("company")} error={err("companyId")} required>
          {(c) => (
            <Select {...c} value={form.companyId} disabled={resubmitId !== undefined} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
              <option value="">{t("companyChoose")}</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.tradeName || company.legalName}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t("natOp")} hint={t("natOpHint")} error={err("natOp")}>{(c) => <Input {...c} maxLength={60} placeholder={settings?.defaultNatOp ?? t("natOpPlaceholder")} value={form.natOp} onChange={(e) => setForm({ ...form, natOp: e.target.value })} />}</Field>
      </Card>

      <Card className="grid items-start gap-4 p-5 sm:grid-cols-6">
        <h2 className="font-medium sm:col-span-6">{t("recipient")}</h2>
        <Field className="sm:col-span-3" label={t("taxId")} hint={t("taxIdHint")} error={err("recipient.taxId")} required>{(c) => <Input {...c} inputMode="text" autoComplete="off" placeholder={t("taxIdPlaceholder")} value={form.recipient.taxId} onChange={(e) => setRecipient({ taxId: maskTaxId(e.target.value) })} />}</Field>
        <Field className="sm:col-span-3" label={t("name")} error={err("recipient.name")} required>{(c) => <Input {...c} maxLength={60} placeholder={t("namePlaceholder")} value={form.recipient.name} onChange={(e) => setRecipient({ name: e.target.value })} />}</Field>
        {autofilled && <p role="status" className="text-[12.5px] text-text-3 sm:col-span-6">{t(`autofilled.${autofilled}`)}</p>}
        <Field className="sm:col-span-3" label={t("indIeDest")} hint={t("indIeDestHint")} error={err("recipient.indIeDest")} required>
          {(c) => (
            <Select {...c} value={form.recipient.indIeDest} onChange={(e) => setRecipient({ indIeDest: e.target.value as "1" | "2" | "9" })}>
              <option value="9">{t("ie9")}</option>
              <option value="1">{t("ie1")}</option>
              <option value="2">{t("ie2")}</option>
            </Select>
          )}
        </Field>
        {form.recipient.indIeDest === "1" && <Field className="sm:col-span-3" label={t("stateRegistration")} error={err("recipient.stateRegistration")} required>{(c) => <Input {...c} autoComplete="off" placeholder={t("stateRegistrationPlaceholder", { example: ieExample(form.recipient.state) })} value={form.recipient.stateRegistration} onChange={(e) => setRecipient({ stateRegistration: e.target.value })} />}</Field>}
        <Field className="sm:col-span-3" label={t("email")} hint={t("emailHint")} error={err("recipient.email")} optionalLabel={t("optional")}>{(c) => <Input {...c} type="email" placeholder={t("emailPlaceholder")} value={form.recipient.email} onChange={(e) => setRecipient({ email: e.target.value })} />}</Field>
        <Field className="sm:col-span-2" label={t("zip")} hint={t("zipHint")} error={err("recipient.address.zip")} required>{(c) => <Input {...c} inputMode="numeric" autoComplete="postal-code" placeholder="01001-000" value={form.recipient.zip} onChange={(e) => setRecipient({ zip: maskZip(e.target.value) })} />}</Field>
        <Field className="sm:col-span-3" label={t("street")} error={err("recipient.address.street")} required>{(c) => <Input {...c} maxLength={60} placeholder={t("streetPlaceholder")} value={form.recipient.street} onChange={(e) => setRecipient({ street: e.target.value })} />}</Field>
        <Field className="sm:col-span-1" label={t("number")} error={err("recipient.address.number")} required>{(c) => <Input {...c} maxLength={60} placeholder="123" value={form.recipient.number} onChange={(e) => setRecipient({ number: e.target.value })} />}</Field>
        <Field className="sm:col-span-3" label={t("complement")} error={err("recipient.address.complement")} optionalLabel={t("optional")}>{(c) => <Input {...c} maxLength={60} placeholder={t("complementPlaceholder")} value={form.recipient.complement} onChange={(e) => setRecipient({ complement: e.target.value })} />}</Field>
        <Field className="sm:col-span-3" label={t("district")} error={err("recipient.address.district")} required>{(c) => <Input {...c} maxLength={60} placeholder={t("districtPlaceholder")} value={form.recipient.district} onChange={(e) => setRecipient({ district: e.target.value })} />}</Field>
        <Field className="sm:col-span-4" label={t("city")} error={err("recipient.address.city")} required>{(c) => <Input {...c} maxLength={60} placeholder={t("cityPlaceholder")} value={form.recipient.city} onChange={(e) => setRecipient({ city: e.target.value })} />}</Field>
        <Field className="sm:col-span-2" label={t("state")} error={err("recipient.address.state")} required>{(c) => <Input {...c} maxLength={2} placeholder="SP" value={form.recipient.state} onChange={(e) => setRecipient({ state: maskState(e.target.value) })} />}</Field>
        {/^\d{7}$/.test(form.recipient.cityCode) && !editCityCode && !err("recipient.address.cityCode") ? (
          <p className="text-[12.5px] text-text-3 sm:col-span-6">{t("cityCodeKnown", { code: form.recipient.cityCode })} <button type="button" className="underline" onClick={() => setEditCityCode(true)}>{t("cityCodeChange")}</button></p>
        ) : (
          <Field className="sm:col-span-3" label={t("cityCode")} hint={t("cityCodeHint")} error={err("recipient.address.cityCode")} required>{(c) => <Input {...c} inputMode="numeric" maxLength={7} placeholder="3550308" value={form.recipient.cityCode} onChange={(e) => setRecipient({ cityCode: e.target.value.replace(/\D/g, "") })} />}</Field>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-medium">{t("items.title")}</h2>
        <p className="text-sm text-text-3">{t("taxNotice")}</p>
        <NfeItemsEditor items={items} onChange={setItems} errors={errors} defaultCsosn={settings?.defaultCsosn} suggestedCfop={cfop} />
        <p className="text-right text-sm text-text-2">{t("totalPreview")}: <strong className="font-mono">{money(total)}</strong></p>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-medium">{t("payments.title")}</h2>
        {form.payments.map((payment, index) => (
          <div key={index} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field label={t("payments.means")} error={err(`payments[${index}].tPag`)}>
              {(c) => (
                <Select {...c} value={payment.tPag} onChange={(e) => setForm({ ...form, payments: form.payments.map((p, i) => (i === index ? { ...p, tPag: e.target.value } : p)) })}>
                  {PAYMENT_MEANS.map((means) => <option key={means} value={means}>{tPay(means)}</option>)}
                </Select>
              )}
            </Field>
            <Field label={t("payments.amount")} hint={index === 0 && !payTouched ? t("payments.amountAuto") : undefined} error={err(`payments[${index}].amount`)} required>{(c) => <Input {...c} inputMode="decimal" placeholder="0,00" value={payment.amount} onChange={(e) => { setPayTouched(true); setForm({ ...form, payments: form.payments.map((p, i) => (i === index ? { ...p, amount: maskCurrency(e.target.value) } : p)) }); }} />}</Field>
            {form.payments.length > 1 && <Button variant="ghost" className="sm:mt-[26px]" onClick={() => { setPayTouched(true); setForm({ ...form, payments: form.payments.filter((_, i) => i !== index) }); }} aria-label={t("payments.remove", { number: index + 1 })}><Trash2 size={14} aria-hidden /></Button>}
          </div>
        ))}
        <div><Button variant="secondary" onClick={() => { setPayTouched(true); setForm({ ...form, payments: [...form.payments, emptyPayment()] }); }}><Plus size={14} aria-hidden />{t("payments.add")}</Button></div>
        {form.payments.some((payment) => payment.tPag === "01") && <Field label={t("payments.change")} hint={t("payments.changeHint")} error={err("change")} optionalLabel={t("optional")}>{(c) => <Input {...c} inputMode="decimal" placeholder="0,00" value={form.change} onChange={(e) => setForm({ ...form, change: maskCurrency(e.target.value) })} />}</Field>}
        {Math.abs(paid - total) < 0.005
          ? <p className="text-right text-sm text-text-2">{t("payments.balanceOk", { total: money(total) })}</p>
          : <p role="alert" className="text-right text-sm text-warn">{t("payments.balanceDiffers", { paid: money(paid), total: money(total) })}</p>}
      </Card>

      <Card className="grid gap-4 p-5">
        <Field label={t("additionalInfo")} error={err("additionalInfo")}>{(c) => <textarea {...c} className="field resize-y" rows={3} placeholder={t("additionalInfoPlaceholder")} maxLength={5000} value={form.additionalInfo} onChange={(e) => setForm({ ...form, additionalInfo: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-sm text-text-2"><input type="checkbox" checked={form.sendEmail} onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })} />{t("sendEmail")}</label>
      </Card>

      {resubmitId === undefined && <NfeScheduleOptions value={when} onChange={setWhen} error={err("firstDate")} />}

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" loading={busy === "validate"} disabled={busy !== null} onClick={() => void run("validate")}>{t("validate")}</Button>
        <Button type="submit" variant="accent" loading={busy === "submit"} disabled={busy !== null || productionLocked}>{resubmitId ? t("resubmit") : scheduling ? t(when.mode === "recurring" ? "schedule.submitRecurring" : "schedule.submitOnce") : t("issue")}</Button>
      </div>
    </form>
  );
}
