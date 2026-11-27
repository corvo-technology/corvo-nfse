"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { cnpj as cnpjApi, integrations, type IntegrationSaleDetail, type ResolveSaleInput } from "@/lib/api";
import { cleanTaxId, maskTaxId } from "@/lib/masks";
import { lookupCep } from "@/lib/viacep";
import { useApiErrorText } from "@/lib/use-api-error";
import { useIntegrationErrorText } from "@/lib/use-integration-error";

const TAX_ID = /^([0-9]{11}|[0-9A-Z]{14})$/;

interface SaleResolveFormProps {
  sale: IntegrationSaleDetail;
  /** Called after the sale changed (issued or ignored) so the page reloads it. */
  onChanged: () => void;
}

/** Completes the data of a sale that waits for the client and issues its invoice. Works the same for every platform. */
export function SaleResolveForm({ sale, onChanged }: SaleResolveFormProps) {
  const t = useTranslations("Integrations.resolve");
  const apiError = useApiErrorText();
  const errorText = useIntegrationErrorText();
  const { success, error: toastError } = useToast();
  const customer = sale.customer;

  const [taxId, setTaxId] = useState(customer?.taxId ? maskTaxId(customer.taxId) : "");
  const [name, setName] = useState(customer?.name ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [sendEmail, setSendEmail] = useState(sale.sendEmail);
  const [zip, setZip] = useState(customer?.address?.zip ?? "");
  const [street, setStreet] = useState(customer?.address?.street ?? "");
  const [city, setCity] = useState(customer?.address?.city ?? "");
  const [state, setState] = useState(customer?.address?.state ?? "");
  const [municipalityCode, setMunicipalityCode] = useState(customer?.address?.municipalityCode ?? "");
  const [code, setCode] = useState(sale.service.code ?? "");
  const [description, setDescription] = useState(sale.service.description ?? "");
  const [busy, setBusy] = useState(false);
  const [lookupNote, setLookupNote] = useState("");
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string; invoiceId?: string | null } | null>(null);
  const [ignoring, setIgnoring] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState("");

  const digits = cleanTaxId(taxId);
  const taxIdOk = TAX_ID.test(digits);
  // City and state go together: the invoice refuses one without the other.
  const addressOk = Boolean(city.trim()) === Boolean(state.trim());
  const canSubmit = taxIdOk && addressOk && !busy;

  async function lookupDocument() {
    setLookupNote("");
    try {
      if (digits.length === 14) {
        const found = await cnpjApi.lookup(digits);
        setName(found.legalName || found.tradeName || name);
        setZip(found.address.zip);
        setStreet([found.address.street, found.address.number].filter(Boolean).join(", "));
        setCity(found.address.city);
        setState(found.address.state);
        setMunicipalityCode(found.municipalityCode ?? "");
        setLookupNote(t("lookupFound"));
      }
    } catch {
      setLookupNote(t("lookupFail"));
    }
  }

  async function lookupZip(value: string) {
    setZip(value);
    if (value.replace(/\D/g, "").length !== 8) return;
    try {
      const found = await lookupCep(value);
      if (!found) return;
      setStreet(found.street);
      setCity(found.city);
      setState(found.state);
      setMunicipalityCode(found.ibge);
    } catch {
      // The address is optional: a failed lookup only leaves the fields to be typed.
    }
  }

  async function submit() {
    const address = {
      ...(zip.replace(/\D/g, "").length === 8 ? { zip: zip.replace(/\D/g, "") } : {}),
      ...(street.trim() ? { street: street.trim() } : {}),
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(state.trim() ? { state: state.trim().toUpperCase() } : {}),
      ...(/^\d{7}$/.test(municipalityCode) ? { municipalityCode } : {}),
    };
    const input: ResolveSaleInput = {
      customer: {
        taxId: digits,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(Object.keys(address).length > 0 ? { address } : {}),
      },
      service: {
        ...(/^\d{6}$/.test(code) && code !== (sale.service.code ?? "") ? { code } : {}),
        ...(description.trim() && description.trim() !== (sale.service.description ?? "") ? { description: description.trim() } : {}),
      },
      sendEmail: sendEmail && Boolean(email.trim()),
    };
    setBusy(true);
    setOutcome(null);
    try {
      const result = await integrations.resolve(sale.id, input);
      if (result.outcome.state === "processed") {
        success(t("issued"));
        setOutcome({ ok: true, text: t("issued"), invoiceId: result.operation.invoiceId });
      } else {
        setOutcome({ ok: false, text: `${t("stillFailing")} ${errorText(result.outcome.lastError)}` });
      }
      onChanged();
    } catch (cause) {
      toastError(apiError(cause, String(cause)));
    } finally {
      setBusy(false);
    }
  }

  async function ignore() {
    setBusy(true);
    try {
      await integrations.ignore(sale.id, ignoreReason.trim());
      success(t("ignored"));
      onChanged();
    } catch (cause) {
      toastError(apiError(cause, String(cause)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (canSubmit) void submit(); }}>
        <section className="flex flex-col gap-3" aria-labelledby="sale-customer">
          <h2 id="sale-customer" className="text-[14.5px] font-medium text-text">{t("customerTitle")}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("taxId")} required error={taxId && !taxIdOk ? t("taxIdInvalid") : undefined} className="min-w-[14rem] flex-1">
              {(control) => <Input {...control} inputMode="text" autoComplete="off" value={taxId} onChange={(e) => setTaxId(maskTaxId(e.target.value))} />}
            </Field>
            {digits.length === 14 && <Button type="button" variant="secondary" onClick={() => void lookupDocument()}>{t("lookupCnpj")}</Button>}
          </div>
          {lookupNote && <p role="status" className="text-[13px] text-text-3">{lookupNote}</p>}
          <Field label={t("name")}>{(control) => <Input {...control} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label={t("email")} hint={t("emailHint")}>{(control) => <Input {...control} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Toggle checked={sendEmail && Boolean(email.trim())} disabled={!email.trim()} onChange={setSendEmail} label={t("sendEmail")} />
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="sale-address">
          <h2 id="sale-address" className="text-[14.5px] font-medium text-text">{t("addressTitle")}</h2>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label={t("zip")}>{(control) => <Input {...control} inputMode="numeric" value={zip} onChange={(e) => void lookupZip(e.target.value)} />}</Field>
            <Field label={t("street")}>{(control) => <Input {...control} value={street} onChange={(e) => setStreet(e.target.value)} />}</Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
            <Field label={t("city")} error={!addressOk ? t("addressIncomplete") : undefined}>{(control) => <Input {...control} value={city} onChange={(e) => setCity(e.target.value)} />}</Field>
            <Field label={t("state")}>{(control) => <Input {...control} maxLength={2} value={state} onChange={(e) => setState(e.target.value)} />}</Field>
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="sale-service">
          <h2 id="sale-service" className="text-[14.5px] font-medium text-text">{t("serviceTitle")}</h2>
          <p className="text-[13px] text-text-3">{t("serviceHint")}</p>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label={t("serviceCode")}>{(control) => <Input {...control} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />}</Field>
            <Field label={t("serviceDescription")}>{(control) => <Input {...control} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
          </div>
        </section>

        {outcome && (
          <p role="status" className={outcome.ok ? "banner" : "banner banner-warn"}>
            {outcome.text}{" "}
            {outcome.ok && outcome.invoiceId && <Link href={`/app/invoices/${outcome.invoiceId}`} className="underline">{t("viewInvoice")}</Link>}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" variant="accent" disabled={!canSubmit} loading={busy}>{t("emit")}</Button>
        </div>
      </form>

      {sale.blockReason === "customer_tax_id_missing" && (
        <p className="text-[13px] text-text-3">
          {t("anonymousTip")}{" "}
          {sale.connectionId && <Link href={`/app/integrations/${sale.connectionId}`} className="underline">{t("settingsLink")}</Link>}
        </p>
      )}

      <section className="flex flex-col gap-2 border-t border-border pt-5" aria-labelledby="sale-ignore">
        <h2 id="sale-ignore" className="text-[14.5px] font-medium text-text">{t("ignoreTitle")}</h2>
        <p className="text-[13px] text-text-3">{t("ignoreHint")}</p>
        {ignoring ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (ignoreReason.trim()) void ignore(); }}>
            <Field label={t("ignoreReason")} className="min-w-[16rem] flex-1">{(control) => <Input {...control} maxLength={200} value={ignoreReason} onChange={(e) => setIgnoreReason(e.target.value)} />}</Field>
            <Button type="submit" variant="danger" disabled={!ignoreReason.trim()} loading={busy}>{t("ignore")}</Button>
          </form>
        ) : (
          <Button type="button" variant="secondary" className="self-start" onClick={() => setIgnoring(true)}>{t("ignore")}</Button>
        )}
      </section>
    </div>
  );
}
