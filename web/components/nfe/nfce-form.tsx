"use client";

import { Select } from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { fieldIssues } from "@/lib/api-errors";
import { createNfce, getNfeSettings, resubmitNfe, validateNfce, type NfeSettings } from "@/lib/nfe";
import { CARD_BRANDS, CARD_MEANS, deliveryProblems, emptyNfcePayment, toNfceInput, type NfceFormState } from "@/lib/nfce-form";
import { maskCurrency, maskState, maskTaxId, maskZip } from "@/lib/masks";
import { rememberProducts } from "@/lib/nfe-products";
import { issueErrors, paidPreview, PAYMENT_MEANS, toMoneyText, totalsPreview, type NfeFormState, type NfeItemForm } from "@/lib/nfe-form";
import type { Company } from "@/lib/types";
import { useApiErrorText } from "@/lib/use-api-error";
import { NfeItemsEditor } from "@/components/nfe/nfe-items-editor";
import { useRecipientAutofill } from "@/components/nfe/use-recipient-autofill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

interface NfceFormProps {
  companies: Company[];
  initial: NfceFormState;
  /** Set when a rejected NFC-e is being fixed: the form then sends `PUT` to the same note. */
  resubmitId?: string;
}

/** Fields the form draws; a problem on any other field is listed on top, so it is never lost. */
const isPlaced = (field: string) => /^(items|payments)\[\d+\]\./.test(field) || /^recipient\.(taxId|name|email|address\.(street|number|complement|district|zip|cityCode|city|state))$/.test(field) || ["companyId", "change", "additionalInfo", "indPres"].includes(field);

/** The quick sale to the consumer (NFC-e): items, how it was paid and, if the consumer wants, the CPF. */
export function NfceForm({ companies, initial, resubmitId }: NfceFormProps) {
  const t = useTranslations("Nfe.consumer");
  const tf = useTranslations("Nfe.form");
  const tPay = useTranslations("Nfe.form.paymentMeans");
  const te = useTranslations("ApiErrors");
  const locale = useLocale();
  const router = useRouter();
  const apiError = useApiErrorText();
  const [form, setForm] = useState<NfceFormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"validate" | "submit" | null>(null);
  const inFlight = useRef(false);
  const key = useRef<{ body: string; value: string } | null>(null);
  const [settings, setSettings] = useState<NfeSettings | null>(null);
  const [payTouched, setPayTouched] = useState(resubmitId !== undefined || initial.payments.some((payment) => payment.amount.trim() !== ""));

  useEffect(() => {
    if (!form.companyId) return;
    const abort = new AbortController();
    getNfeSettings(form.companyId, abort.signal).then((value) => { if (!abort.signal.aborted) setSettings(value); }).catch(() => undefined);
    return () => abort.abort();
  }, [form.companyId]);

  const setItems = (changed: NfeItemForm[]) => setForm((current) => ({
    ...current, items: changed,
    payments: !payTouched && current.payments.length === 1 ? [{ ...current.payments[0], amount: totalsPreview(changed) > 0 ? toMoneyText(totalsPreview(changed)) : "" }] : current.payments,
  }));
  const setConsumer = (patch: Partial<NfceFormState["consumer"]>) => setForm((current) => ({ ...current, consumer: { ...current.consumer, ...patch } }));
  const setAddress = (patch: Partial<NfceFormState["address"]>) => setForm((current) => ({ ...current, address: { ...current.address, ...patch } }));
  // The consumer helpers work on the same shape as the NF-e recipient: the CPF/CNPJ finds the saved customer, the CEP the address.
  const asRecipient: NfeFormState["recipient"] = { ...form.consumer, indIeDest: "9", stateRegistration: "", ...form.address };
  const autofilled = useRecipientAutofill(asRecipient, (patch) => {
    const { taxId, name, email, indIeDest: _ie, stateRegistration: _sr, ...address } = patch;
    if (taxId !== undefined || name !== undefined || email !== undefined) setConsumer({ ...(taxId !== undefined ? { taxId } : {}), ...(name !== undefined ? { name } : {}), ...(email !== undefined ? { email } : {}) });
    if (Object.keys(address).length > 0) setAddress(address);
  });
  const setPayment = (index: number, patch: Partial<NfceFormState["payments"][number]>) => setForm((current) => ({ ...current, payments: current.payments.map((payment, i) => (i === index ? { ...payment, ...patch } : payment)) }));
  const err = (field: string) => errors[field];
  const money = (value: number) => new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL" }).format(value);
  const total = totalsPreview(form.items);
  const paid = paidPreview(form.payments, form.change);
  const translate = (code: string, fallback: string) => (te.has(code) ? te(code) : fallback);
  const delivery = form.indPres === "4";

  function show(cause: unknown) {
    const found = issueErrors(cause, translate);
    setErrors(found);
    const unplaced = fieldIssues(cause).filter((issue) => !isPlaced(issue.field)).map((issue) => `${issue.field}: ${translate(issue.code.replace(/^ERROR_/i, "").toLowerCase(), issue.message)}`);
    const general = apiError(cause, tf("failed"));
    setBanner(unplaced.length > 0 ? [general, ...unplaced].join(" · ") : Object.keys(found).length > 0 ? tf("fixFields") : general);
  }

  async function run(kind: "validate" | "submit") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(kind); setBanner(null); setErrors({}); setPreview(null);
    try {
      const missing = deliveryProblems(form);
      if (Object.keys(missing).length > 0) {
        setErrors(Object.fromEntries(Object.keys(missing).map((field) => [field, t("required")])));
        setBanner(t("deliveryNeeds"));
        return;
      }
      const input = toNfceInput(form);
      if (kind === "validate") {
        const result = await validateNfce(input);
        setPreview(result.accessKeyPreview);
        return;
      }
      const body = JSON.stringify(input);
      if (key.current?.body !== body) key.current = { body, value: crypto.randomUUID() };
      const accepted = resubmitId ? await resubmitNfe(resubmitId, input, key.current.value) : await createNfce(input, key.current.value);
      rememberProducts(form.items);
      router.push(`/app/nfe/${accepted.id}`);
    } catch (cause) { show(cause); }
    finally { inFlight.current = false; setBusy(null); }
  }

  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); void run("submit"); }} className="flex flex-col gap-6">
      <p role="note" className="banner">{tf("homologation")} {t("tip")}</p>
      {banner && <p role="alert" className="banner banner-danger">{banner}</p>}
      {preview && <p role="status" className="banner banner-ok">{tf("validOk", { key: preview })}</p>}

      <Card className="grid items-start gap-4 p-5 sm:grid-cols-2">
        <Field label={tf("company")} error={err("companyId")} required>
          {(c) => (
            <Select {...c} value={form.companyId} disabled={resubmitId !== undefined} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
              <option value="">{tf("companyChoose")}</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.tradeName || company.legalName}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t("indPres")} hint={t("indPresHint")} error={err("indPres")}>
          {(c) => (
            <Select {...c} value={form.indPres} onChange={(e) => setForm({ ...form, indPres: e.target.value as NfceFormState["indPres"] })}>
              <option value="1">{t("indPres1")}</option>
              <option value="4">{t("indPres4")}</option>
              <option value="5">{t("indPres5")}</option>
            </Select>
          )}
        </Field>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-medium">{t("items")}</h2>
        <p className="text-sm text-text-3">{tf("taxNotice")}</p>
        <NfeItemsEditor items={form.items} onChange={setItems} errors={errors} defaultCsosn={settings?.defaultCsosn} />
        <p className="text-right text-sm text-text-2">{tf("totalPreview")}: <strong className="font-mono">{money(total)}</strong></p>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-medium">{tf("payments.title")}</h2>
        {form.payments.map((payment, index) => (
          <div key={index} className="flex flex-col gap-3">
            <div className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label={tf("payments.means")} error={err(`payments[${index}].tPag`)}>
                {(c) => (
                  <Select {...c} value={payment.tPag} onChange={(e) => setPayment(index, { tPag: e.target.value })}>
                    {PAYMENT_MEANS.map((means) => <option key={means} value={means}>{tPay(means)}</option>)}
                  </Select>
                )}
              </Field>
              <Field label={tf("payments.amount")} hint={index === 0 && !payTouched ? tf("payments.amountAuto") : undefined} error={err(`payments[${index}].amount`)} required>{(c) => <Input {...c} inputMode="decimal" placeholder="0,00" value={payment.amount} onChange={(e) => { setPayTouched(true); setPayment(index, { amount: maskCurrency(e.target.value) }); }} />}</Field>
              {form.payments.length > 1 && <Button variant="ghost" className="sm:mt-[26px]" onClick={() => { setPayTouched(true); setForm({ ...form, payments: form.payments.filter((_, i) => i !== index) }); }} aria-label={tf("payments.remove", { number: index + 1 })}><Trash2 size={14} aria-hidden /></Button>}
            </div>
            {(CARD_MEANS as readonly string[]).includes(payment.tPag) && (
              <div className="grid items-start gap-3 sm:grid-cols-3">
                <Field label={t("cardBrand")} hint={t("cardHint")} error={err(`payments[${index}].card.tBand`)} optionalLabel={tf("optional")}>
                  {(c) => (
                    <Select {...c} value={payment.cardBrand} onChange={(e) => setPayment(index, { cardBrand: e.target.value })}>
                      <option value="">{t("cardBrandNone")}</option>
                      {CARD_BRANDS.map((brand) => <option key={brand} value={brand}>{t(`brands.${brand}`)}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label={t("cardAuth")} error={err(`payments[${index}].card.cAut`)} optionalLabel={tf("optional")}>{(c) => <Input {...c} maxLength={128} placeholder={t("cardAuthPlaceholder")} value={payment.cardAuth} onChange={(e) => setPayment(index, { cardAuth: e.target.value })} />}</Field>
                <Field label={t("cardCnpj")} hint={t("cardCnpjHint")} error={err(`payments[${index}].card.cnpj`)} optionalLabel={tf("optional")}>{(c) => <Input {...c} inputMode="numeric" placeholder="00.000.000/0000-00" value={payment.cardCnpj} onChange={(e) => setPayment(index, { cardCnpj: maskTaxId(e.target.value) })} />}</Field>
              </div>
            )}
          </div>
        ))}
        <div><Button variant="secondary" onClick={() => { setPayTouched(true); setForm({ ...form, payments: [...form.payments, emptyNfcePayment()] }); }}><Plus size={14} aria-hidden />{tf("payments.add")}</Button></div>
        {form.payments.some((payment) => payment.tPag === "01") && <Field label={tf("payments.change")} hint={tf("payments.changeHint")} error={err("change")} optionalLabel={tf("optional")}>{(c) => <Input {...c} inputMode="decimal" placeholder="0,00" value={form.change} onChange={(e) => setForm({ ...form, change: maskCurrency(e.target.value) })} />}</Field>}
        {Math.abs(paid - total) < 0.005
          ? <p className="text-right text-sm text-text-2">{tf("payments.balanceOk", { total: money(total) })}</p>
          : <p role="alert" className="text-right text-sm text-warn">{tf("payments.balanceDiffers", { paid: money(paid), total: money(total) })}</p>}
      </Card>

      <Card className="grid items-start gap-4 p-5 sm:grid-cols-6">
        <h2 className="font-medium sm:col-span-6">{delivery ? t("consumerRequired") : t("consumerOptional")}</h2>
        <Field className="sm:col-span-3" label={tf("taxId")} hint={t("taxIdHint")} error={err("recipient.taxId")} optionalLabel={delivery ? undefined : tf("optional")} required={delivery}>{(c) => <Input {...c} inputMode="text" autoComplete="off" placeholder={tf("taxIdPlaceholder")} value={form.consumer.taxId} onChange={(e) => setConsumer({ taxId: maskTaxId(e.target.value) })} />}</Field>
        <Field className="sm:col-span-3" label={tf("name")} error={err("recipient.name")} optionalLabel={delivery ? undefined : tf("optional")} required={delivery}>{(c) => <Input {...c} maxLength={60} placeholder={tf("namePlaceholder")} value={form.consumer.name} onChange={(e) => setConsumer({ name: e.target.value })} />}</Field>
        {autofilled && <p role="status" className="text-[12.5px] text-text-3 sm:col-span-6">{tf(`autofilled.${autofilled}`)}</p>}
        <Field className="sm:col-span-6" label={tf("email")} hint={t("emailHint")} error={err("recipient.email")} optionalLabel={tf("optional")}>{(c) => <Input {...c} type="email" placeholder={tf("emailPlaceholder")} value={form.consumer.email} onChange={(e) => setConsumer({ email: e.target.value })} />}</Field>
        {delivery && (
          <>
            <Field className="sm:col-span-2" label={tf("zip")} hint={tf("zipHint")} error={err("recipient.address.zip")} required>{(c) => <Input {...c} inputMode="numeric" autoComplete="postal-code" placeholder="01001-000" value={form.address.zip} onChange={(e) => setAddress({ zip: maskZip(e.target.value) })} />}</Field>
            <Field className="sm:col-span-3" label={tf("street")} error={err("recipient.address.street")} required>{(c) => <Input {...c} maxLength={60} placeholder={tf("streetPlaceholder")} value={form.address.street} onChange={(e) => setAddress({ street: e.target.value })} />}</Field>
            <Field className="sm:col-span-1" label={tf("number")} error={err("recipient.address.number")} required>{(c) => <Input {...c} maxLength={60} placeholder="123" value={form.address.number} onChange={(e) => setAddress({ number: e.target.value })} />}</Field>
            <Field className="sm:col-span-3" label={tf("complement")} error={err("recipient.address.complement")} optionalLabel={tf("optional")}>{(c) => <Input {...c} maxLength={60} placeholder={tf("complementPlaceholder")} value={form.address.complement} onChange={(e) => setAddress({ complement: e.target.value })} />}</Field>
            <Field className="sm:col-span-3" label={tf("district")} error={err("recipient.address.district")} required>{(c) => <Input {...c} maxLength={60} placeholder={tf("districtPlaceholder")} value={form.address.district} onChange={(e) => setAddress({ district: e.target.value })} />}</Field>
            <Field className="sm:col-span-4" label={tf("city")} error={err("recipient.address.city")} required>{(c) => <Input {...c} maxLength={60} placeholder={tf("cityPlaceholder")} value={form.address.city} onChange={(e) => setAddress({ city: e.target.value })} />}</Field>
            <Field className="sm:col-span-2" label={tf("state")} error={err("recipient.address.state")} required>{(c) => <Input {...c} maxLength={2} placeholder="SP" value={form.address.state} onChange={(e) => setAddress({ state: maskState(e.target.value) })} />}</Field>
            <Field className="sm:col-span-3" label={tf("cityCode")} hint={tf("cityCodeHint")} error={err("recipient.address.cityCode")} required>{(c) => <Input {...c} inputMode="numeric" maxLength={7} placeholder="3550308" value={form.address.cityCode} onChange={(e) => setAddress({ cityCode: e.target.value.replace(/\D/g, "") })} />}</Field>
          </>
        )}
      </Card>

      <Card className="grid gap-4 p-5">
        <Field label={tf("additionalInfo")} error={err("additionalInfo")} optionalLabel={tf("optional")}>{(c) => <textarea {...c} className="field resize-y" rows={2} placeholder={tf("additionalInfoPlaceholder")} maxLength={5000} value={form.additionalInfo} onChange={(e) => setForm({ ...form, additionalInfo: e.target.value })} />}</Field>
        {form.consumer.email.trim() !== "" && <label className="flex items-center gap-2 text-sm text-text-2"><input type="checkbox" checked={form.sendEmail} onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })} />{t("sendEmail")}</label>}
      </Card>

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" loading={busy === "validate"} disabled={busy !== null} onClick={() => void run("validate")}>{tf("validate")}</Button>
        <Button type="submit" variant="accent" loading={busy === "submit"} disabled={busy !== null}>{resubmitId ? t("resubmit") : t("issue")}</Button>
      </div>
    </form>
  );
}
