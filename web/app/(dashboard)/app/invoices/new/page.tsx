"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, FlaskConical, ShieldAlert } from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { ServiceCodeCombobox } from "@/components/ui/service-code-combobox";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/lib/auth";
import { apiErrorMessage, errorCodeKey, fieldIssues, mapIssues } from "@/lib/api-errors";
import { ApiError, companies as companiesApi, invoices as invoicesApi, schedules as schedulesApi, type CreateScheduleInput } from "@/lib/api";
import { firstRecurringDate, todayInSaoPaulo } from "@/lib/recurrence";
import type { ScheduleFrequency } from "@/lib/types";
import { isValidCnpj, isValidCpf, maskCurrency, maskDigits, maskState, cleanTaxId, maskTaxId, parseCurrency } from "@/lib/masks";
import type { Company, CustomerRegistryInfo, InvoiceCalculation, SavedCustomer } from "@/lib/types";
import { InvoiceCalculationPanel } from "@/components/dashboard/invoice-calculation-panel";
import { DEFAULT_SERVICE_CODE } from "@/lib/service-defaults";
import { invoiceToFormValues } from "@/lib/invoice-copy";
import { useSavedCustomer } from "@/components/invoices/use-saved-customer";
import { ServiceShortcuts, type ServiceFill } from "@/components/invoices/service-shortcuts";
import { CustomerPicker } from "@/components/invoices/customer-picker";
import { countryOptions } from "@/lib/countries";
import { FixCompanyDialog, type CompanyFix } from "@/components/invoices/fix-company-dialog";
import { clearInvoiceDraft, readInvoiceDraft, writeInvoiceDraft } from "@/lib/invoice-draft";
import { Select } from "@/components/ui/select";

const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

const FORM_ID = "new-invoice-form";
/** Problems the user fixes on the company, not on this form. */
const FIX_ON_COMPANY = new Set(["simples_rate_required", "company_not_ready", "certificate_not_found", "certificate_invalid", "certificate_expired", "certificate_tax_id_mismatch"]);

function Section({ title, delay, children }: { title: string; delay: number; children: React.ReactNode }) {
  return (
    <section className={`surface dash-in dash-in-${delay} p-5 sm:p-6`}>
      <h2 className="mb-4 border-b border-border-soft pb-3 text-[15px] font-medium leading-6 text-text">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 text-[13px]">
      <dt className="flex-none text-text-4">{label}</dt>
      <dd className={`min-w-0 truncate text-right ${value ? "text-text-2" : "text-text-5"} ${mono ? "font-mono tabular-nums" : ""}`}>{value || "—"}</dd>
    </div>
  );
}

export default function NewInvoicePage() {
  const t = useTranslations("Invoices");
  const tc = useTranslations("Common");
  const te = useTranslations("ApiErrors");
  const locale = useLocale();
  const router = useRouter();
  const { fiscalEnvironment } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixOnCompany, setFixOnCompany] = useState(false);
  const [certError, setCertError] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    companyId: "",
    externalId: "",
    customerTaxId: "",
    customerName: "",
    customerEmail: "",
    city: "",
    state: "",
    serviceDescription: "",
    serviceCode: "",
    municipalityCode: "",
    competenceDate: new Date().toLocaleDateString("sv-SE"),
    amount: "",
    deduction: "",
    purchaseOrder: "",
    notes: "",
    // Customer abroad: replaces the CPF/CNPJ and the Brazilian address.
    abroad: "",
    foreignTaxId: "",
    noTaxIdReason: "",
    country: "",
    postalCode: "",
    foreignCity: "",
    region: "",
    street: "",
    number: "",
    district: "",
    complement: "",
  });
  const abroad = form.abroad === "yes";
  const countries = useMemo(() => countryOptions(locale), [locale]);

  // What the saved customer filled last. A field the person typed over is never replaced.
  const filledFromSaved = useRef<{ name: string; email: string } | null>(null);
  const filledFromRegistry = useRef<CustomerRegistryInfo | null>(null);
  const [registryName, setRegistryName] = useState<string | null>(null);
  const savedCustomer = useSavedCustomer(abroad ? "" : cleanTaxId(form.customerTaxId), (customer) => {
    const previous = filledFromSaved.current;
    const email = customer.email ?? "";
    filledFromSaved.current = { name: customer.name, email };
    setForm((f) => ({
      ...f,
      customerName: !f.customerName.trim() || f.customerName === previous?.name ? customer.name : f.customerName,
      customerEmail: !f.customerEmail.trim() || f.customerEmail === previous?.email ? email : f.customerEmail,
    }));
  }, (info) => {
    // New customer: name, city and UF from the public registry, never over what the person typed. No email.
    const previous = filledFromRegistry.current;
    filledFromRegistry.current = info;
    setRegistryName(info.name);
    setForm((f) => ({
      ...f,
      customerName: !f.customerName.trim() || f.customerName === previous?.name ? info.name : f.customerName,
      city: info.city && (!f.city.trim() || f.city === previous?.city) ? info.city : f.city,
      state: info.state && (!f.state || f.state === previous?.state) ? info.state : f.state,
    }));
  });
  const pickCustomer = (customer: SavedCustomer) => {
    filledFromSaved.current = { name: customer.name, email: customer.email ?? "" };
    setForm((f) => ({ ...f, customerTaxId: maskTaxId(customer.taxId), customerName: customer.name, customerEmail: customer.email ?? "" }));
  };

  const inFlight = useRef(false);
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<ScheduleFrequency>("MONTHLY");
  const [endsOn, setEndsOn] = useState("");
  const [calculating, setCalculating] = useState(false);
  const [calc, setCalc] = useState<{ key: string; result: InvoiceCalculation } | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyApplied = useRef(false);

  useEffect(() => {
    let cancelled = false;
    companiesApi
      .list({ limit: 100 })
      .then((data) => {
        if (cancelled) return;
        const list = data.items;
        setCompanies(list);
        setNextCursor(data.hasMore ? data.nextCursor : null);
        // Coming back to the form (e.g. after leaving to fix something) restores what was typed; a copy (?from=) starts fresh.
        const draft = new URLSearchParams(window.location.search).get("from") ? null : readInvoiceDraft(list.map((item) => item.id));
        if (draft) {
          setForm((prev) => ({ ...prev, ...(draft.form as Partial<typeof prev>), companyId: draft.companyId }));
          setSendEmail(draft.sendEmail);
        } else setForm((prev) => ({ ...prev, companyId: list[0]?.id ?? "", serviceCode: "", municipalityCode: "" }));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(apiErrorMessage(err, te.has, te, t("fields.companiesFailed")));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t, fiscalEnvironment]);

  // Keeps the draft while the person works, so leaving and coming back loses nothing.
  useEffect(() => {
    if (!loading && form.companyId) writeInvoiceDraft(form.companyId, form, sendEmail);
  }, [loading, form, sendEmail]);

  // `?from=<invoiceId>` pre-fills the form with an existing invoice; applied once, after the companies are known.
  useEffect(() => {
    if (loading || copyApplied.current) return;
    const from = new URLSearchParams(window.location.search).get("from");
    copyApplied.current = true;
    if (!from) return;
    invoicesApi.get(from)
      .then((invoice) => {
        const { sendEmail: email, companyId, ...values } = invoiceToFormValues(invoice, new Date().toLocaleDateString("sv-SE"));
        setForm((prev) => ({ ...prev, ...values, companyId: companies.some((item) => item.id === companyId) ? companyId : prev.companyId }));
        setSendEmail(email);
        setCopiedFrom(invoice.customerName || t("anonymousCustomer"));
      })
      .catch(() => setCopyFailed(true));
  }, [loading, companies, t]);

  async function loadMoreCompanies() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await companiesApi.list({ limit: 100, cursor: nextCursor });
      setCompanies((previous) => [...previous, ...page.items]);
      setNextCursor(page.hasMore ? page.nextCursor : null);
    } catch { setError(t("fields.companiesFailed")); }
    finally { setLoadingMore(false); }
  }

  function buildInput(amount: number, externalId: string) {
    return {
      companyTaxId: company?.taxId ?? "",
      externalId,
      // No customer data at all issues an anonymous-consumer invoice (no tomador).
      customer: abroad ? {
        name: form.customerName.trim() || undefined,
        email: form.customerEmail || undefined,
        foreign: {
          ...(form.noTaxIdReason ? { noTaxIdReason: form.noTaxIdReason as "exempt" | "not_required" } : { taxId: form.foreignTaxId.trim() }),
          country: form.country,
          postalCode: form.postalCode.trim(),
          city: form.foreignCity.trim(),
          region: form.region.trim(),
          street: form.street.trim(),
          number: form.number.trim(),
          district: form.district.trim(),
          ...(form.complement.trim() ? { complement: form.complement.trim() } : {}),
        },
      } : hasCustomer ? {
        taxId: cleanTaxId(form.customerTaxId),
        name: form.customerName.trim() || undefined,
        email: form.customerEmail || undefined,
        address: form.city || form.state ? { city: form.city || undefined, state: form.state.toUpperCase() || undefined } : undefined,
      } : undefined,
      service: {
        description: form.serviceDescription.trim() || undefined,
        code: form.serviceCode || undefined,
        municipalityCode: form.municipalityCode || undefined,
      },
      amount,
      // Declared by the issuer; empty or zero sends nothing.
      deduction: hasDeduction ? deductionNumber : undefined,
      // Printed on the invoice; neither changes any tax. Empty sends nothing.
      purchaseOrder: form.purchaseOrder.trim() || undefined,
      notes: form.notes.trim() || undefined,
      competenceDate: form.competenceDate,
      email: sendEmail,
    };
  }

  const firstRepeatOn = firstRecurringDate(frequency, todayInSaoPaulo());

  /** The same note as a recurrence body: starts one period from today, the company by id. */
  function recurrenceInput(input: ReturnType<typeof buildInput>): CreateScheduleInput {
    return {
      companyId: form.companyId,
      amount: input.amount,
      competenceDate: firstRepeatOn,
      ...(input.customer ? { customer: input.customer } : {}),
      service: { ...(input.service.description ? { description: input.service.description } : {}), ...(input.service.code ? { code: input.service.code } : {}), ...(input.service.municipalityCode ? { municipalityCode: input.service.municipalityCode } : {}) },
      ...(input.deduction ? { deduction: input.deduction } : {}),
      ...(input.purchaseOrder ? { purchaseOrder: input.purchaseOrder } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      options: { type: "RECURRING", recurrence: { frequency, ...(endsOn ? { endsOn } : {}) }, ...(sendEmail ? { email: { send: true } } : {}) },
    };
  }

  async function calculate() {
    if (calculating || !canSubmit) return;
    setCalculating(true);
    setCalcError(null);
    const key = JSON.stringify([form, sendEmail, fiscalEnvironment]);
    try {
      const result = await invoicesApi.calculate(buildInput(parseCurrency(form.amount), form.externalId || "dashboard-calculate"));
      if (posthogConfigured) {
        posthog.capture("invoice_calculated", {
          fiscal_environment: fiscalEnvironment,
          has_customer: hasCustomer,
          email_delivery_requested: sendEmail,
        });
      }
      setCalc({ key, result });
    } catch (err: unknown) {
      setCalc(null);
      setCalcError(err instanceof ApiError && err.status === 503 ? t("calculate.unavailable") : apiErrorMessage(err, te.has, te, t("calculate.failed")));
    } finally { setCalculating(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || uncertain || !canSubmit || !company) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const amount = parseCurrency(form.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error(t("fields.invalidAmount"));
      }
      const formSnapshot = JSON.stringify([form, sendEmail]);
      if (attempt.current && attempt.current.payload !== formSnapshot) attempt.current = null;
      const key = attempt.current?.key ?? crypto.randomUUID();
      const input = buildInput(amount, form.externalId || `dashboard-${key}`);
      attempt.current = { key, payload: formSnapshot };
      const created = await invoicesApi.create(input, key);
      if (repeat) {
        // The first note is already issued; the recurrence takes over from the next period. Same key
        // on a retry: the note is not issued twice and the schedule is not created twice.
        try { await schedulesApi.create(recurrenceInput(input), `${key}:recurrence`); }
        catch (cause) {
          const reason = apiErrorMessage(cause, te.has, te, "");
          setError(reason ? t("repeat.createdButFailedWith", { reason }) : t("repeat.createdButFailed"));
          return;
        }
      }
      if (posthogConfigured) {
        posthog.capture("invoice_created", {
          fiscal_environment: fiscalEnvironment,
          has_customer: hasCustomer,
          email_delivery_requested: sendEmail,
        });
      }
      clearInvoiceDraft();
      router.push(`/app/invoices/${created.id}`);
    } catch (err: unknown) {
      if (err instanceof ApiError && [0, 409, 502, 503].includes(err.status)) setUncertain(true);
      const { _form, ...perField } = mapIssues(err, { "customer.taxId": "customerTaxId", "customer.name": "customerName", "customer.email": "customerEmail", "customer.address": "city", "customer.address.city": "city", "customer.address.state": "state", "customer.foreign": "foreignTaxId", "customer.foreign.taxId": "foreignTaxId", "customer.foreign.noTaxIdReason": "foreignTaxId", "customer.foreign.country": "country", "customer.foreign.postalCode": "postalCode", "customer.foreign.city": "foreignCity", "customer.foreign.region": "region", "customer.foreign.street": "street", "customer.foreign.number": "number", "customer.foreign.district": "district", "customer.foreign.complement": "complement", "service.code": "serviceCode", "service.municipalityCode": "municipalityCode", "service.description": "serviceDescription", amount: "amount", deduction: "deduction", purchaseOrder: "purchaseOrder", notes: "notes", competenceDate: "competenceDate", companyId: "companyId", companyTaxId: "companyId", "company.municipalityCode": "companyId" }, (code) => (te.has(code) ? te(code) : te("invalid")));
      setFieldErrors(perField);
      const errorCodes = [...fieldIssues(err).map((issue) => errorCodeKey(issue.code)), ...(err instanceof ApiError && err.code ? [errorCodeKey(err.code)] : [])];
      setFixOnCompany(errorCodes.some((code) => FIX_ON_COMPANY.has(code)));
      setCertError(errorCodes.some((code) => code.startsWith("certificate_")));
      setError(_form ?? (Object.keys(perField).length > 0 ? t("fields.fixFields") : apiErrorMessage(err, te.has, te, t("fields.createFailed"))));
    } finally { inFlight.current = false; setSubmitting(false); }
  }

  const set = (key: keyof typeof form, mask?: (value: string) => string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    { setForm((f) => ({ ...f, [key]: mask ? mask(e.target.value) : e.target.value })); setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev)); };

  const company = companies.find((c) => c.id === form.companyId && c.environment === fiscalEnvironment);
  const serviceCode = form.serviceCode || company?.defaultServiceCode || DEFAULT_SERVICE_CODE;
  const municipalityCode = form.municipalityCode || company?.municipalityCode || "";
  const amountNumber = parseCurrency(form.amount);
  const hasAmount = form.amount !== "" && amountNumber > 0;
  const deductionNumber = parseCurrency(form.deduction);
  const hasDeduction = form.deduction !== "" && deductionNumber > 0;
  // The deduction is taken from the ISS base, so it has to leave something to tax.
  const deductionInvalid = hasDeduction && hasAmount && deductionNumber >= amountNumber;
  const money = useMemo(() => new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL" }), [locale]);
  const competence = form.competenceDate
    ? new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", { dateStyle: "medium" }).format(new Date(`${form.competenceDate}T12:00:00`))
    : "";
  const isLive = fiscalEnvironment === "live";

  // Required fields, validated as the user types. The submit button stays
  // disabled until this list is empty; the summary tells what is missing.
  const today = new Date().toLocaleDateString("sv-SE");
  const taxDigits = cleanTaxId(form.customerTaxId);
  const hasCustomer = abroad || Boolean(taxDigits || form.customerName.trim() || form.customerEmail.trim() || form.city.trim() || form.state || sendEmail);
  const missing: string[] = [];
  if (!company || company.status === "blocked" || (isLive && company.status !== "ready") || !/^\d{7}$/.test(company.municipalityCode ?? "")) missing.push(t("fields.company"));
  // A customer needs a valid CPF/CNPJ; with no customer data the invoice has no tomador.
  if (abroad) {
    // A customer abroad needs its name, its tax id (or the reason it has none) and the whole address.
    if (!form.customerName.trim()) missing.push(t("fields.name"));
    if (!form.noTaxIdReason && !form.foreignTaxId.trim()) missing.push(t("foreign.taxId"));
    if (!form.country) missing.push(t("foreign.country"));
    for (const [value, label] of [[form.postalCode, "postalCode"], [form.foreignCity, "city"], [form.region, "region"], [form.street, "street"], [form.number, "number"], [form.district, "district"]] as const) if (!value.trim()) missing.push(t(`foreign.${label}`));
  } else if (hasCustomer && !(taxDigits.length === 11 ? isValidCpf(taxDigits) : taxDigits.length === 14 && isValidCnpj(taxDigits))) missing.push(t("fields.taxId"));
  if (!/^\d{6}$/.test(serviceCode)) missing.push(t("fields.serviceCode"));
  if (!/^\d{7}$/.test(municipalityCode)) missing.push(t("fields.municipalityCode"));
  if (!form.competenceDate || form.competenceDate > today) missing.push(t("fields.competence"));
  if (!hasAmount) missing.push(t("fields.amount"));
  if (deductionInvalid) missing.push(t("fields.deduction"));
  if ((sendEmail || form.customerEmail) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail.trim())) missing.push(t("fields.email"));
  if (!abroad && Boolean(form.city.trim()) !== Boolean(form.state)) missing.push(form.city.trim() ? t("fields.state") : t("fields.city"));
  const canSubmit = missing.length === 0 && !uncertain;
  /** What the person can fix right here, without leaving the form. */
  const fixes: CompanyFix[] = company ? [...(company.setupGaps?.includes("certificate") || certError ? ["certificate" as const] : []), ...(!/^\d{7}$/.test(company.municipalityCode ?? "") ? ["municipality_code" as const] : [])] : [];

  // "More options" holds what most invoices do not need. It opens by itself when something in it is filled,
  // wrong, or required (a company without a municipality); the person can still close it.
  const MORE_ERROR_KEYS = ["serviceCode", "municipalityCode", "deduction", "purchaseOrder", "notes", "city", "state", "externalId"];
  const moreFilled = [form.externalId, form.purchaseOrder, form.notes, form.deduction, form.serviceCode, form.municipalityCode, form.city, form.state].filter((value) => value.trim()).length + (repeat ? 1 : 0);
  const needsMore = moreFilled > 0 || MORE_ERROR_KEYS.some((key) => fieldErrors[key]) || Boolean(company && !company.municipalityCode);
  const [moreState, setMoreState] = useState<"auto" | "open" | "closed">("auto");
  const moreOpen = moreState === "open" || (moreState === "auto" && needsMore);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader title={t("newTitle")} subtitle={t("newSubtitle")} />
      {copiedFrom && <p role="status" className="banner banner-accent">{t("copyBanner", { name: copiedFrom })}</p>}
      {copyFailed && <p role="alert" className="banner banner-warn">{t("copyFailed")}</p>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form id={FORM_ID} onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-6" aria-busy={submitting}>
          <div className="dash-in dash-in-1 flex flex-col gap-3">
              <Field label={t("fields.company")} error={fieldErrors.companyId || undefined} required>
                {(c) => (
                  <Select {...c} value={form.companyId} onChange={(event) => { setForm((previous) => ({ ...previous, companyId: event.target.value, serviceCode: "", municipalityCode: "" })); setFieldErrors({}); }} disabled={loading} required>
                    {loading && <option value="">{t("fields.loadingCompanies")}</option>}
                    {!loading && companies.length === 0 && <option value="">{t("fields.noCompanies")}</option>}
                    {companies.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.tradeName || item.legalName}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            {company && (company.status === "blocked" || (isLive && company.status !== "ready") || !/^\d{7}$/.test(company.municipalityCode ?? "")) && <p className="banner banner-warn">{t("fields.companyNotReady")} <Link href={`/app/companies/${company.id}`} className="underline">{t("fields.configureCompany")}</Link>{fixes.length > 0 && <> <Button variant="ghost" onClick={() => setFixOpen(true)}>{t("fix.fixHere")}</Button></>}</p>}
            {company && fixOpen && <FixCompanyDialog company={company} fixes={fixes} open={fixOpen} onClose={() => setFixOpen(false)} onFixed={(updated) => { setCompanies((previous) => previous.map((item) => (item.id === updated.id ? updated : item))); setCertError(false); setError(null); setFixOnCompany(false); setFixOpen(false); }} />}
            {nextCursor && <Button variant="ghost" onClick={loadMoreCompanies} loading={loadingMore}>{t("fields.loadMoreCompanies")}</Button>}
          </div>

          <Section title={t("form.customer")} delay={2}>
            <div role="radiogroup" aria-label={t("foreign.groupLabel")} className="inline-flex self-start rounded-[9px] border border-border-strong p-0.5">
              {([["", t("foreign.brazil")], ["yes", t("foreign.abroad")]] as const).map(([value, label]) => (
                <label key={value} className={`cursor-pointer rounded-[7px] px-3.5 py-1.5 text-[13px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--accent)] ${form.abroad === value ? "bg-active text-text" : "text-text-3 hover:text-text-2"}`}>
                  <input type="radio" name="customer-origin" value={value} checked={form.abroad === value} onChange={() => { setForm((f) => ({ ...f, abroad: value })); setFieldErrors({}); }} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>
            {!abroad && (
              <Field label={t("fields.pickCustomer")} optionalLabel={t("fields.optional")}>
                {(c) => <CustomerPicker id={c.id} onPick={pickCustomer} />}
              </Field>
            )}
            {!abroad && (
              <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("fields.taxId")} error={fieldErrors.customerTaxId || undefined} required={hasCustomer} optionalLabel={hasCustomer ? undefined : t("fields.optional")}>
                {(c) => (
                  <input {...c} type="text" inputMode="text" autoCapitalize="characters" className="field font-mono tabular-nums" placeholder={t("placeholders.taxId")} value={form.customerTaxId} onChange={set("customerTaxId", maskTaxId)} maxLength={18} autoComplete="off" required={hasCustomer} />
                )}
              </Field>
              <Field label={t("fields.name")} error={fieldErrors.customerName || undefined} optionalLabel={t("fields.optional")} hint={savedCustomer && form.customerName === savedCustomer.name ? t("hints.savedCustomer") : !savedCustomer && registryName !== null && form.customerName === registryName && cleanTaxId(form.customerTaxId).length === 14 ? t("hints.registryCustomer") : undefined}>
                {(c) => (
                  <input {...c} type="text" placeholder={t("placeholders.name")} value={form.customerName} onChange={set("customerName")} autoComplete="organization" />
                )}
              </Field>
              </div>
            )}
            {abroad && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("fields.name")} error={fieldErrors.customerName || undefined} required>
                    {(c) => <input {...c} type="text" placeholder={t("placeholders.name")} value={form.customerName} onChange={set("customerName")} autoComplete="organization" required />}
                  </Field>
                  <Field label={t("foreign.country")} error={fieldErrors.country || undefined} required>
                    {(c) => (
                      <Select {...c} value={form.country} onChange={set("country")} required>
                        <option value="">{t("foreign.countryPlaceholder")}</option>
                        {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
                      </Select>
                    )}
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2.5">
                  <Field label={t("foreign.taxId")} error={fieldErrors.foreignTaxId || undefined} required={!form.noTaxIdReason} hint={t("foreign.taxIdHint")}>
                    {(c) => <input {...c} type="text" className="field font-mono" maxLength={40} value={form.foreignTaxId} onChange={set("foreignTaxId")} disabled={Boolean(form.noTaxIdReason)} autoComplete="off" required={!form.noTaxIdReason} />}
                  </Field>
                    <label className="choice items-center">
                      <input type="checkbox" checked={Boolean(form.noTaxIdReason)} onChange={(event) => setForm((f) => ({ ...f, noTaxIdReason: event.target.checked ? "exempt" : "", foreignTaxId: event.target.checked ? "" : f.foreignTaxId }))} className="h-4 w-4 flex-none accent-[var(--accent)]" />
                      <span className="text-[13.5px] text-text-2">{t("foreign.noTaxIdToggle")}</span>
                    </label>
                  </div>
                  {form.noTaxIdReason && (
                    <Field label={t("foreign.reasonLabel")}>
                      {(c) => (
                        <Select {...c} value={form.noTaxIdReason} onChange={set("noTaxIdReason")}>
                          <option value="exempt">{t("foreign.reason.exempt")}</option>
                          <option value="not_required">{t("foreign.reason.not_required")}</option>
                        </Select>
                      )}
                    </Field>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
                  <Field label={t("foreign.street")} error={fieldErrors.street || undefined} required>
                    {(c) => <input {...c} type="text" maxLength={255} value={form.street} onChange={set("street")} autoComplete="address-line1" required />}
                  </Field>
                    <Field label={t("foreign.number")} error={fieldErrors.number || undefined} required>
                      {(c) => <input {...c} type="text" maxLength={60} value={form.number} onChange={set("number")} autoComplete="off" required />}
                    </Field>
                    <Field label={t("foreign.complement")} error={fieldErrors.complement || undefined} optionalLabel={t("fields.optional")}>
                      {(c) => <input {...c} type="text" maxLength={156} value={form.complement} onChange={set("complement")} autoComplete="address-line2" />}
                    </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("foreign.district")} error={fieldErrors.district || undefined} required>
                    {(c) => <input {...c} type="text" maxLength={60} value={form.district} onChange={set("district")} autoComplete="off" required />}
                  </Field>
                  <Field label={t("foreign.city")} error={fieldErrors.foreignCity || undefined} required>
                    {(c) => <input {...c} type="text" maxLength={60} value={form.foreignCity} onChange={set("foreignCity")} autoComplete="address-level2" required />}
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("foreign.region")} error={fieldErrors.region || undefined} required>
                    {(c) => <input {...c} type="text" maxLength={60} value={form.region} onChange={set("region")} autoComplete="address-level1" required />}
                  </Field>
                  <Field label={t("foreign.postalCode")} error={fieldErrors.postalCode || undefined} required>
                    {(c) => <input {...c} type="text" className="field font-mono" maxLength={11} value={form.postalCode} onChange={set("postalCode")} autoComplete="postal-code" required />}
                  </Field>
                </div>
                <p className="banner banner-accent text-[13px]">{t("foreign.notExport")}</p>
              </>
            )}
            <div className="flex flex-col gap-2.5">
            <Field label={t("fields.email")} error={fieldErrors.customerEmail || undefined} required={sendEmail} optionalLabel={sendEmail ? undefined : t("fields.optional")} hint={t("hints.email")}>
              {(c) => (
                <input {...c} type="email" inputMode="email" placeholder={t("placeholders.email")} value={form.customerEmail} onChange={set("customerEmail")} autoComplete="email" spellCheck={false} />
              )}
            </Field>
            <label className="choice items-start">
              <input type="checkbox" checked={sendEmail} onChange={(event) => { setSendEmail(event.target.checked); setFieldErrors((prev) => (prev.customerEmail ? { ...prev, customerEmail: "" } : prev)); }} className="mt-0.5 h-4 w-4 flex-none accent-[var(--accent)]" />
              <span className="min-w-0">
                <span className="block text-[14px] text-text">{t("sendEmail.label")}</span>
                <span className="block text-[12.5px] text-text-4">{isLive ? t("sendEmail.hint") : t("sendEmail.hintTest")}</span>
              </span>
            </label>
            </div>
          </Section>

          <Section title={t("form.service")} delay={3}>
            <ServiceShortcuts
              companyId={form.companyId}
              savedCustomerTaxId={savedCustomer ? cleanTaxId(form.customerTaxId) : null}
              current={{ description: form.serviceDescription, serviceCode, municipalityCode: form.municipalityCode, amountCents: hasAmount ? Math.round(amountNumber * 100) : 0 }}
              onApply={(fill: ServiceFill) => { setForm((f) => ({ ...f, ...fill })); setFieldErrors((previous) => ({ ...previous, serviceDescription: "", serviceCode: "", municipalityCode: "", amount: "" })); }}
            />
            <Field label={t("fields.description")} error={fieldErrors.serviceDescription || undefined} optionalLabel={t("fields.optional")} hint={t("hints.description")}>
              {(c) => (
                <textarea {...c} className="field resize-y" rows={3} placeholder={t("placeholders.description")} value={form.serviceDescription} onChange={set("serviceDescription")} />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("fields.amount")} error={fieldErrors.amount || undefined} required>
                {(c) => (
                  <div className="relative">
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-[13px] text-text-4">R$</span>
                    <input {...c} type="text" inputMode="numeric" className="field pl-10 text-right font-mono tabular-nums" placeholder="0,00" value={form.amount} onChange={set("amount", maskCurrency)} autoComplete="off" required />
                  </div>
                )}
              </Field>
              <Field label={t("fields.competence")} error={fieldErrors.competenceDate || undefined} required>
                {(c) => <input {...c} type="date" max={today} value={form.competenceDate} onChange={set("competenceDate")} required />}
              </Field>
            </div>
          </Section>

          <details open={moreOpen} onToggle={(event) => setMoreState(event.currentTarget.open ? "open" : "closed")} className="dash-in dash-in-3 surface group p-5 sm:p-6">
            <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 text-[15px] font-medium text-text [&::-webkit-details-marker]:hidden">
              <span>{t("more.title")}</span>
              <span className="text-[12.5px] font-normal text-text-4">{moreFilled > 0 ? t("more.filled", { count: moreFilled }) : t("more.hint")}</span>
            </summary>
            <div className="mt-5 flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("fields.serviceCode")} error={fieldErrors.serviceCode || undefined} optionalLabel={t("fields.optional")} hint={company?.defaultServiceCode ? t("hints.serviceCodeDefault", { code: company.defaultServiceCode }) : t("hints.serviceCodeFallback", { code: DEFAULT_SERVICE_CODE })}>
                {(c) => <ServiceCodeCombobox id={c.id} aria-describedby={c["aria-describedby"]} aria-invalid={c["aria-invalid"]} value={form.serviceCode} onChange={(code) => { setForm((f) => ({ ...f, serviceCode: code })); setFieldErrors((previous) => ({ ...previous, serviceCode: "" })); }} placeholder={company?.defaultServiceCode ?? DEFAULT_SERVICE_CODE} />}
              </Field>
              <Field label={t("fields.municipalityCode")} error={fieldErrors.municipalityCode || undefined} required={!company?.municipalityCode} optionalLabel={company?.municipalityCode ? t("fields.optional") : undefined} hint={company?.municipalityCode ? t("hints.municipalityDefault", { code: company.municipalityCode }) : t("hints.municipalityCode")}>
                {(c) => <input {...c} type="text" inputMode="numeric" className="field font-mono tabular-nums" placeholder={company?.municipalityCode ?? t("placeholders.municipalityCode")} value={form.municipalityCode} onChange={set("municipalityCode", maskDigits(7))} pattern="[0-9]{7}" maxLength={7} autoComplete="off" required={!company?.municipalityCode} />}
              </Field>
              </div>
                <Field label={t("fields.deduction")} error={fieldErrors.deduction || (deductionInvalid ? t("fields.invalidDeduction") : undefined)} optionalLabel={t("fields.optional")} hint={t("hints.deduction")}>
                  {(c) => (
                    <div className="relative">
                      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-[13px] text-text-4">R$</span>
                      <input {...c} type="text" inputMode="numeric" className="field pl-10 text-right font-mono tabular-nums" placeholder="0,00" value={form.deduction} onChange={set("deduction", maskCurrency)} autoComplete="off" />
                    </div>
                  )}
                </Field>
            <Field label={t("fields.purchaseOrder")} error={fieldErrors.purchaseOrder || undefined} optionalLabel={t("fields.optional")} hint={t("hints.purchaseOrder")}>
              {(c) => (
                <input {...c} type="text" maxLength={60} placeholder={t("placeholders.purchaseOrder")} value={form.purchaseOrder} onChange={set("purchaseOrder")} autoComplete="off" />
              )}
            </Field>
            <Field label={t("fields.notes")} error={fieldErrors.notes || undefined} optionalLabel={t("fields.optional")} hint={t("hints.notes")}>
              {(c) => (
                <textarea {...c} className="field resize-y" rows={2} maxLength={2000} placeholder={t("placeholders.notes")} value={form.notes} onChange={set("notes")} />
              )}
            </Field>
              <Field label={t("fields.reference")} optionalLabel={t("fields.optional")} hint={t("hints.reference")}>
                {(c) => (
                  <input {...c} type="text" placeholder={t("placeholders.reference")} value={form.externalId} onChange={set("externalId")} autoComplete="off" spellCheck={false} />
                )}
              </Field>
              {!abroad && (
                <div className="grid grid-cols-[1fr_96px] gap-4">
              <Field label={t("fields.city")} error={fieldErrors.city || undefined} optionalLabel={t("fields.optional")}>
                {(c) => (
                  <input {...c} type="text" placeholder={t("placeholders.city")} value={form.city} onChange={set("city")} autoComplete="address-level2" />
                )}
              </Field>
              <Field label={t("fields.state")} error={fieldErrors.state || undefined} optionalLabel={t("fields.optional")}>
                {(c) => (
                  <input {...c} type="text" className="field font-mono uppercase" maxLength={2} placeholder={t("placeholders.state")} value={form.state} onChange={set("state", maskState)} autoComplete="address-level1" />
                )}
              </Field>
                </div>
              )}
                <label className="choice items-start">
                  <input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} className="mt-0.5 h-4 w-4 flex-none accent-[var(--accent)]" />
                  <span className="min-w-0">
                    <span className="block text-[14px] text-text">{t("repeat.label")}</span>
                    <span className="block text-[12.5px] text-text-4">{t("repeat.hint")}</span>
                  </span>
                </label>
              {repeat && (
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t("repeat.frequency")}>
                      {(c) => (
                        <Select {...c} value={frequency} onChange={(event) => setFrequency(event.target.value as ScheduleFrequency)}>
                          {(["WEEKLY", "BIWEEKLY", "MONTHLY"] as const).map((value) => <option key={value} value={value}>{t(`repeat.${value}`)}</option>)}
                        </Select>
                      )}
                    </Field>
                    <Field label={t("repeat.endsOn")} optionalLabel={t("fields.optional")} hint={t("repeat.next", { date: firstRepeatOn.split("-").reverse().join("/") })}>
                      {(c) => <input {...c} type="date" min={firstRepeatOn} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />}
                    </Field>
                </div>
              )}
            </div>
          </details>

          {uncertain && <div className="banner banner-warn flex-col"><p>{t("fields.uncertain")}</p><Button onClick={() => router.push("/app/invoices")}>{t("fields.checkInvoices")}</Button></div>}
          {error && (
            <div role="alert" className="banner banner-danger">
              <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-none" />
              <span>{error}{fixOnCompany && form.companyId && <> <Link href={`/app/companies/${form.companyId}`} className="underline">{t("fields.openCompany")}</Link></>}{certError && company && fixes.length > 0 && <> <Button variant="ghost" onClick={() => setFixOpen(true)}>{t("fix.fixHere")}</Button></>}</span>
            </div>
          )}
        </form>

        <aside aria-label={t("summary.title")} className="surface dash-in dash-in-2 flex flex-col gap-5 p-5 sm:p-6 lg:sticky lg:top-20">
          <div className="flex items-center justify-between">
            <p className="eyebrow">{t("summary.title")}</p>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] ${
                isLive ? "border-accent-border bg-accent-surface text-accent" : "border-warn/40 bg-warn/10 text-warn"
              }`}
            >
              {isLive ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" /> : <FlaskConical size={11} aria-hidden />}
              {isLive ? t("summary.live") : t("summary.test")}
            </span>
          </div>

          <div>
            <p className="text-[12.5px] text-text-4">{t("fields.amount")}</p>
            <p aria-live="polite" className={`mt-1 font-mono text-[32px] font-medium leading-none tracking-[-0.03em] tabular-nums transition-colors ${hasAmount ? "text-text" : "text-text-5"}`}>
              {hasAmount ? money.format(amountNumber) : money.format(0)}
            </p>
          </div>

          <dl className="flex flex-col gap-2.5 border-t border-border-soft pt-4">
            <SummaryRow label={t("summary.issuer")} value={company ? company.tradeName || company.legalName : ""} />
            <SummaryRow label={t("summary.customer")} value={hasCustomer ? form.customerName : t("summary.noCustomer")} />
            <SummaryRow label={t("summary.taxId")} value={abroad ? form.foreignTaxId || (form.noTaxIdReason ? t(`foreign.reason.${form.noTaxIdReason}`) : "") : form.customerTaxId} mono />
            <SummaryRow label={t("fields.serviceCode")} value={serviceCode} mono />
            <SummaryRow label={t("fields.municipalityCode")} value={municipalityCode} mono />
            <SummaryRow label={t("summary.competence")} value={competence} />
            {hasDeduction && <SummaryRow label={t("summary.deduction")} value={money.format(deductionNumber)} mono />}
            <SummaryRow label={t("summary.email")} value={sendEmail ? form.customerEmail : t("summary.emailOff")} />
          </dl>

          {isLive && (
            <p className="flex items-start gap-2 rounded-[9px] border border-warn/30 bg-warn/5 p-3 text-[12.5px] text-text-3">
              <ShieldAlert size={14} aria-hidden className="mt-0.5 flex-none text-warn" />
              {t("summary.liveWarning")}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <p id="invoice-missing" role="status" className={`text-[13px] leading-5 ${missing.length ? "text-text-3" : "text-accent"}`}>
              {missing.length ? t("summary.missing", { fields: missing.join(", ") }) : t("summary.ready")}
            </p>
            <Button type="submit" form={FORM_ID} variant="accent" loading={submitting} disabled={!canSubmit} aria-describedby="invoice-missing" className="w-full">
              {submitting ? t("submitting") : t("submit")}
            </Button>
            <Button variant="ghost" onClick={calculate} loading={calculating} disabled={!canSubmit || submitting} className="w-full">
              {calculating ? t("calculate.calculating") : t("calculate.button")}
            </Button>
            {calcError && <p role="alert" className="text-[12.5px] text-danger">{calcError}</p>}
            {calc && (calc.key === JSON.stringify([form, sendEmail, fiscalEnvironment])
              ? <InvoiceCalculationPanel result={calc.result} format={(value) => money.format(Number(value))} />
              : <p role="status" className="text-[12.5px] text-text-4">{t("calculate.stale")}</p>)}
            <Button variant="ghost" onClick={() => router.back()} disabled={submitting} className="w-full">
              {tc("cancel")}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
