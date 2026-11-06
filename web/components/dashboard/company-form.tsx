"use client";
import { useState, useRef } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { ServiceCodeCombobox } from "@/components/ui/service-code-combobox";
import { allowsSpecialTaxRegime, isSimpleNational, SPECIAL_TAX_REGIME_CODES, SUPPORTED_TAX_REGIMES, simplesRateError } from "@/lib/company-fiscal";
import { CertificateUpload } from "@/components/dashboard/certificate-upload";
import { useAuth } from "@/lib/auth";
import { cleanTaxId, isValidCnpj, maskCnpj, maskDigits, maskState, maskZip, onlyDigits } from "@/lib/masks";
import { lookupCep } from "@/lib/viacep";
import { mapIssues } from "@/lib/api-errors";
import { isCompanyLimitError } from "@/lib/api";
import type { Company, CompanyFormInput, TaxRegime } from "@/lib/types";

const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

const STEPS = ["company", "address", "fiscal", "certificate"] as const;
type Step = (typeof STEPS)[number];

interface CompanyFormProps {
  /** Present → edit mode (single form). Absent → create wizard. */
  company?: Company;
  onSave: (input: CompanyFormInput) => Promise<Company | void>;
  onCancel: () => void;
  /** Wizard only: called when the user leaves the flow after the company exists. */
  onFinish?: (company: Company) => void;
}

function Stepper({ current, reached, labels }: { current: number; reached: number; labels: string[] }) {
  return (
    <ol className="mb-6 flex items-center" aria-label={labels.join(", ")}>
      {labels.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={label} aria-current={active ? "step" : undefined} className={`flex items-center ${index < labels.length - 1 ? "flex-1" : ""}`}>
            <span className="flex items-center gap-2">
              <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border font-mono text-[11px] transition-colors ${done ? "border-accent bg-accent text-bg" : active ? "border-accent text-accent" : index <= reached ? "border-border-strong text-text-3" : "border-border text-text-5"}`}>
                {done ? <Check size={12} strokeWidth={3} aria-hidden /> : index + 1}
              </span>
              <span className={`text-[13px] max-sm:sr-only ${active ? "font-medium text-text" : done ? "text-text-3" : "text-text-4"}`}>{label}</span>
            </span>
            {index < labels.length - 1 && <span aria-hidden className={`mx-3 h-px flex-1 transition-colors ${done ? "bg-accent/60" : "bg-border"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export function CompanyForm({ company, onSave, onCancel, onFinish }: CompanyFormProps) {
  const t = useTranslations("CompanyForm");
  const td = useTranslations("CompanyDetail");
  const te = useTranslations("ApiErrors");
  const { can } = useAuth();
  const wizard = !company;
  const canUploadCertificate = can("nfse.certificates.manage");
  const address = company?.address;
  const [values, setValues] = useState<Record<string, string>>({
    legalName: company?.legalName ?? "", tradeName: company?.tradeName ?? "", taxId: maskCnpj(company?.taxId ?? ""), taxRegime: company?.taxRegime ?? "", municipalReg: company?.municipalReg ?? "", municipalityCode: company?.municipalityCode ?? "", defaultServiceCode: company?.defaultServiceCode ?? "", simplesRate: company?.simplesRate ?? "", simplesIssRate: company?.simplesIssRate ?? "", specialRegime: company?.specialRegime ?? "0",
    street: address?.street ?? "", number: address?.number ?? "", complement: address?.complement ?? "", district: address?.district ?? "", city: address?.city ?? "", state: address?.state ?? "", zip: maskZip(address?.zip ?? ""),
  });
  const [sendMunicipalReg, setSendMunicipalReg] = useState(company?.sendMunicipalReg ?? false);
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null); const busy = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [reached, setReached] = useState(0);
  const [created, setCreated] = useState<Company | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const step: Step = wizard ? STEPS[stepIndex] : "company";
  // The rate is asked only of a Simples Nacional company; a MEI sees no extra field.
  const isSimples = (wizard ? values.taxRegime : company?.taxRegime) === "Simples Nacional";
  const rateValue = (name: string) => values[name].trim().replace(",", ".");
  const show = (name: Step) => !wizard || step === name;

  const set = (name: string, value: string) => {
    setValues((previous) => ({ ...previous, [name]: value }));
    setFieldErrors((previous) => (previous[name] ? { ...previous, [name]: "" } : previous));
  };
  const [cepState, setCepState] = useState<"idle" | "loading" | "found" | "notFound" | "error">("idle");
  const cepRequest = useRef<AbortController | null>(null);
  const onZipChange = (raw: string) => {
    const zip = maskZip(raw);
    set("zip", zip);
    cepRequest.current?.abort();
    if (onlyDigits(zip).length !== 8) { setCepState("idle"); return; }
    const controller = new AbortController(); cepRequest.current = controller; setCepState("loading");
    lookupCep(zip, controller.signal).then((result) => {
      if (!result) { setCepState("notFound"); return; }
      setValues((previous) => ({ ...previous, street: result.street || previous.street, district: result.district || previous.district, city: result.city || previous.city, state: result.state || previous.state, municipalityCode: result.ibge || previous.municipalityCode }));
      setCepState("found");
    }).catch(() => { if (!controller.signal.aborted) setCepState("error"); });
  };

  type FieldOptions = { required?: boolean; maxLength?: number; mask?: (value: string) => string; inputMode?: "numeric" | "text"; autoComplete?: string; mono?: boolean; span?: boolean; hint?: string; readOnly?: boolean };
  const field = (name: string, { required = false, maxLength = 200, mask, inputMode, autoComplete, mono, span, hint, readOnly }: FieldOptions = {}) => (
    <Field key={name} label={t(name)} error={fieldErrors[name] || undefined} required={required} optionalLabel={required ? undefined : t("optional")} hint={hint} className={span ? "sm:col-span-2" : undefined}>
      {(props) => <input {...props} className={mono ? "field font-mono tabular-nums" : "field"} value={values[name]} required={required} readOnly={readOnly} aria-readonly={readOnly} maxLength={maxLength} inputMode={inputMode} autoComplete={autoComplete ?? "off"} spellCheck={false} placeholder={t.has(`placeholders.${name}`) ? t(`placeholders.${name}`) : undefined} onChange={(event) => set(name, mask ? mask(event.target.value) : event.target.value)} />}
    </Field>
  );

  function validateCompany(): string | null {
    if (!values.legalName.trim() || (wizard && !values.taxId.trim())) return t("required");
    if (wizard && !isValidCnpj(values.taxId)) return t("cnpjInvalid");
    return null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy.current) return;
    if (wizard && step === "company") {
      const problem = validateCompany();
      if (problem) { setError(problem); return; }
      setError(null); setStepIndex(1); setReached((r) => Math.max(r, 1)); return;
    }
    if (wizard && step === "address") { setStepIndex(2); setReached((r) => Math.max(r, 2)); return; }
    if (wizard && step === "certificate") return;
    const fiscalErrors: Record<string, string> = {};
    if (wizard && !(SUPPORTED_TAX_REGIMES as readonly string[]).includes(values.taxRegime)) fiscalErrors.taxRegime = t("regimeRequired");
    if (isSimples) {
      const reasons = { invalid: t("rateInvalid"), range: t("rateRange"), decimals: t("rateDecimals") };
      const total = values.simplesRate.trim() === "" ? "invalid" : simplesRateError(rateValue("simplesRate"));
      if (total) fiscalErrors.simplesRate = values.simplesRate.trim() === "" ? t("simplesRateRequired") : reasons[total];
      const iss = values.simplesIssRate.trim() === "" ? null : simplesRateError(rateValue("simplesIssRate"));
      if (iss) fiscalErrors.simplesIssRate = reasons[iss];
    }
    if (!/^\d{7}$/.test(values.municipalityCode)) fiscalErrors.municipalityCode = t("municipalityInvalid");
    if (values.defaultServiceCode && !/^\d{6}$/.test(values.defaultServiceCode)) fiscalErrors.defaultServiceCode = t("serviceCodeInvalid");
    if (Object.keys(fiscalErrors).length) { setFieldErrors(fiscalErrors); setError(t("fixFields")); return; }
    busy.current = true; setSaving(true); setError(null);
    try {
      const problem = validateCompany();
      if (problem) throw new Error(problem);
      const optional = (value: string) => value.trim() || undefined;
      const addressFields = { street: optional(values.street), number: optional(values.number), complement: optional(values.complement), district: optional(values.district), city: optional(values.city), state: optional(values.state.toUpperCase()), zip: onlyDigits(values.zip) || undefined };
      const hasAddress = Object.values(addressFields).some(Boolean);
      const municipalReg = optional(values.municipalReg);
      const result = await onSave({
        legalName: values.legalName.trim(), ...(wizard ? { taxId: cleanTaxId(values.taxId) } : {}),
        ...(wizard ? { taxRegime: values.taxRegime as TaxRegime, simpleNational: isSimpleNational(values.taxRegime as TaxRegime), specialRegime: !allowsSpecialTaxRegime(values.taxRegime as TaxRegime) || values.specialRegime === "0" ? undefined : values.specialRegime } : {}),
        ...(isSimples ? { simplesRate: rateValue("simplesRate"), simplesIssRate: rateValue("simplesIssRate") || (company?.simplesIssRate ? null : undefined) } : {}),
        tradeName: optional(values.tradeName), municipalityCode: values.municipalityCode,
        defaultServiceCode: optional(values.defaultServiceCode) ?? (company?.defaultServiceCode ? null : undefined),
        // Optional text is omitted when empty; null explicitly clears on update.
        municipalReg: municipalReg ?? (company?.municipalReg ? null : undefined),
        // Off by default: the Receita rejects the registration when the city has no data for the company.
        sendMunicipalReg: Boolean(municipalReg) && sendMunicipalReg,
        address: hasAddress ? addressFields : company && Object.values(company.address).some(Boolean) ? null : undefined,
      });
      if (wizard && result) {
        if (posthogConfigured) {
          posthog.capture("company_created", {
            tax_regime: values.taxRegime,
            has_default_service_code: Boolean(values.defaultServiceCode),
          });
        }
        setCreated(result); setStepIndex(3); setReached(3);
        if (!canUploadCertificate) onFinish?.(result);
      }
    } catch (cause) {
      const issues = mapIssues(cause, { legalName: "legalName", tradeName: "tradeName", taxId: "taxId", municipalReg: "municipalReg", municipalityCode: "municipalityCode", defaultServiceCode: "defaultServiceCode", specialRegime: "specialRegime", simplesRate: "simplesRate", simplesIssRate: "simplesIssRate", "address.street": "street", "address.number": "number", "address.complement": "complement", "address.district": "district", "address.city": "city", "address.state": "state", "address.zip": "zip" }, (code, fallback) => (te.has(code) ? te(code) : fallback));
      const { _form, ...perField } = issues;
      setFieldErrors(perField);
      if (wizard && Object.keys(perField).length > 0) setStepIndex((index) => (perField.legalName || perField.taxId ? 0 : perField.street || perField.zip || perField.city || perField.state || perField.number ? 1 : index));
      setError(isCompanyLimitError(cause) ? t("companyLimit") : (_form ?? (Object.keys(perField).length > 0 ? t("fixFields") : cause instanceof Error ? cause.message : t("failed"))));
    }
    finally { busy.current = false; setSaving(false); }
  }

  const section = (title: string, description?: string) => (
    <legend className="col-span-full mb-1 w-full">
      <span className="eyebrow block border-b border-border-soft pb-2">{title}</span>
      {description && <span className="mt-2 block text-[13px] text-text-3">{description}</span>}
    </legend>
  );

  // Step 4: certificate (the company already exists and its fiscal profile is declared).
  if (wizard && step === "certificate" && created) {
    return (
      <div className="company-sheet flex flex-col gap-5">
        <Stepper current={uploaded ? 4 : 3} reached={3} labels={STEPS.map((s) => t(`steps.${s}`))} />
        <div className="banner banner-ok">
          <Check size={16} aria-hidden className="mt-0.5 flex-none" />
          <p>{t("created", { name: created.tradeName || created.legalName })}</p>
        </div>
        {uploaded ? (
          <div className="flex flex-col items-start gap-3 rounded-[12px] border border-accent-border bg-accent-surface px-5 py-8 text-left">
            <ShieldCheck size={28} aria-hidden className="text-accent" />
            <p className="text-[15px] font-medium text-text">{t("certificateDone")}</p>
            <p className="max-w-[44ch] text-[13px] text-text-3">{t("certificateDoneHint")}</p>
          </div>
        ) : (
          <>
            <div>
              <h3 className="text-[15px] font-medium text-text">{t("certificateTitle")}</h3>
              <p className="mt-1 text-[13px] text-text-3">{t("certificateIntro")}</p>
            </div>
            <CertificateUpload companyId={created.id} onUploaded={() => setUploaded(true)} />
          </>
        )}
        <div className="flex justify-end gap-3 border-t border-border-soft pt-4">
          <Button variant={uploaded ? "accent" : "ghost"} onClick={() => onFinish?.(created)}>{uploaded ? t("finish") : t("later")}</Button>
        </div>
      </div>
    );
  }

  const last = !wizard || step === "fiscal";
  return <form onSubmit={submit} className="company-sheet flex flex-col gap-6" aria-busy={saving} noValidate={wizard && step !== "company"}>
    {wizard && <Stepper current={stepIndex} reached={reached} labels={STEPS.map((s) => t(`steps.${s}`))} />}

    {show("company") && <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
      {section(t("sectionCompany"), wizard ? t("stepHint.company") : undefined)}
      {field("legalName", { required: true, span: true })}
      {field("tradeName")}
      {field("taxId", { required: true, maxLength: 18, mask: maskCnpj, inputMode: "text", mono: true, readOnly: !wizard, hint: wizard ? undefined : t("hints.taxIdLocked") })}
    </fieldset>}

    {show("address") && <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-6">
      {section(t("address"), wizard ? t("stepHint.address") : undefined)}
      <div className="grid gap-4 sm:col-span-6 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <Field label={t("zip")} error={fieldErrors.zip || undefined} optionalLabel={t("optional")} hint={cepState === "idle" ? t("cep.hint") : undefined}>
            {(props) => <div className="relative"><input {...props} className="field pr-9 font-mono tabular-nums" value={values.zip} maxLength={9} inputMode="numeric" autoComplete="postal-code" placeholder={t("placeholders.zip")} onChange={(event) => onZipChange(event.target.value)} />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center">{cepState === "loading" ? <Loader2 size={15} className="animate-spin text-text-4" /> : cepState === "found" ? <Check size={15} className="text-ok" /> : null}</span></div>}
          </Field>
          <p role="status" className={`mt-1.5 text-[12px] ${cepState === "found" ? "text-ok" : cepState === "idle" || cepState === "loading" ? "sr-only" : "text-danger"}`}>{cepState === "found" ? t("cep.found") : cepState === "notFound" ? t("cep.notFound") : cepState === "error" ? t("cep.error") : cepState === "loading" ? t("cep.loading") : ""}</p>
        </div>
        <div className="sm:col-span-4">{field("street", { autoComplete: "address-line1" })}</div>
        <div className="sm:col-span-2">{field("number", { maxLength: 20 })}</div>
        <div className="sm:col-span-4">{field("complement", { maxLength: 100 })}</div>
        <div className="sm:col-span-2">{field("district", { maxLength: 100 })}</div>
        <div className="sm:col-span-3">{field("city", { maxLength: 100, autoComplete: "address-level2" })}</div>
        <div className="sm:col-span-1">{field("state", { maxLength: 2, mask: maskState, autoComplete: "address-level1", mono: true })}</div>
      </div>
    </fieldset>}

    {show("fiscal") && <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
      {section(t("sectionFiscal"), wizard ? t("stepHint.fiscal") : undefined)}
      {wizard && <><Field label={t("taxRegime")} required error={fieldErrors.taxRegime}>{(props) => <select {...props} className="field" value={values.taxRegime} onChange={(event) => { set("taxRegime", event.target.value); if (!allowsSpecialTaxRegime(event.target.value as TaxRegime)) set("specialRegime", "0"); }}><option value="">{t("selectTaxRegime")}</option>{SUPPORTED_TAX_REGIMES.map((regime) => <option key={regime}>{regime}</option>)}</select>}</Field>
      {allowsSpecialTaxRegime(values.taxRegime as TaxRegime) && <Field label={t("specialRegime")} hint={t("specialRegimeHint")} error={fieldErrors.specialRegime}>{(props) => <select {...props} className="field" value={values.specialRegime} onChange={(event) => set("specialRegime", event.target.value)}>{SPECIAL_TAX_REGIME_CODES.map((code) => <option key={code} value={code}>{t(`specialRegimes.${code}`)}</option>)}</select>}</Field>}
      <p className="text-sm text-text-3 sm:col-span-2">{t("regimeDerived")}</p></>}
      {isSimples && <>
        {field("simplesRate", { required: true, maxLength: 6, mono: true, inputMode: "text", hint: t("hints.simplesRate") })}
        {field("simplesIssRate", { maxLength: 6, mono: true, inputMode: "text", hint: t("hints.simplesIssRate") })}
      </>}
      {field("municipalReg", { maxLength: 20, mono: true, hint: t("hints.municipalReg") })}
      {values.municipalReg.trim() && (
        <label className="flex items-start gap-2.5 text-[13px] text-text-2 sm:col-span-2">
          <input type="checkbox" className="mt-0.5" checked={sendMunicipalReg} onChange={(event) => setSendMunicipalReg(event.target.checked)} />
          <span>{t("sendMunicipalReg")}<span className="mt-0.5 block text-[12px] text-text-4">{t("hints.sendMunicipalReg")}</span></span>
        </label>
      )}
      {field("municipalityCode", { required: true, maxLength: 7, mask: maskDigits(7), inputMode: "numeric", mono: true })}
      <Field label={t("defaultServiceCode")} optionalLabel={t("optional")} error={fieldErrors.defaultServiceCode || undefined} hint={t("hints.defaultServiceCode")} className="sm:col-span-2">
        {(props) => <ServiceCodeCombobox {...props} value={values.defaultServiceCode} onChange={(code) => set("defaultServiceCode", code)} />}
      </Field>
      {!wizard && <p className="field-hint sm:col-span-2">{t("editFiscalHint")}</p>}
    </fieldset>}

    {error && <p role="alert" className="banner banner-danger">{error}</p>}
    <div className="flex items-center justify-between gap-3 border-t border-border-soft pt-4">
      <div>{wizard && stepIndex > 0 && <Button variant="ghost" onClick={() => { setError(null); setStepIndex((i) => i - 1); }} disabled={saving}>{t("back")}</Button>}</div>
      <div className="flex gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>{t("cancel")}</Button>
        <Button type="submit" variant="accent" loading={saving}>{last ? (wizard ? t("createCompany") : t("save")) : t("next")}</Button>
      </div>
    </div>
    {wizard && last && <p className="-mt-3 text-left text-[12.5px] text-text-4">{canUploadCertificate ? t("certificateNext") : td("noCertificatePermission")}</p>}
  </form>;
}
