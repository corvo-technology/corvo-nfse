"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, FlaskConical, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { ServiceCodeCombobox } from "@/components/ui/service-code-combobox";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/lib/auth";
import { mapIssues } from "@/lib/api-errors";
import { ApiError, companies as companiesApi, invoices as invoicesApi } from "@/lib/api";
import { isValidCnpj, isValidCpf, maskCurrency, maskDigits, maskState, cleanTaxId, maskTaxId, parseCurrency } from "@/lib/masks";
import type { Company, InvoiceCalculation } from "@/lib/types";
import { InvoiceCalculationPanel } from "@/components/dashboard/invoice-calculation-panel";

const FORM_ID = "new-invoice-form";

function Section({ n, title, hint, delay, children }: { n: number; title: string; hint?: string; delay: number; children: React.ReactNode }) {
  return (
    <section className={`surface dash-in dash-in-${delay} p-5 sm:p-6`}>
      <header className="mb-5 flex items-start gap-3.5">
        <span aria-hidden className="mt-px flex h-6 w-6 flex-none items-center justify-center rounded-full border border-border-strong bg-active font-mono text-[11px] text-text-2">{n}</span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium leading-6 text-text">{title}</h2>
          {hint && <p className="text-[12.5px] text-text-4">{hint}</p>}
        </div>
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
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
  });

  const inFlight = useRef(false);
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [calc, setCalc] = useState<{ key: string; result: InvoiceCalculation } | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    companiesApi
      .list({ limit: 100 })
      .then((data) => {
        if (cancelled) return;
        const list = data.items;
        setCompanies(list);
        setNextCursor(data.hasMore ? data.nextCursor : null);
        setForm((prev) => ({ ...prev, companyId: list[0]?.id ?? "", serviceCode: "", municipalityCode: "" }));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? t("fields.companiesFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t, fiscalEnvironment]);

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
      customer: {
        taxId: cleanTaxId(form.customerTaxId),
        name: form.customerName,
        email: form.customerEmail || undefined,
        address: form.city || form.state ? { city: form.city || undefined, state: form.state.toUpperCase() || undefined } : undefined,
      },
      service: {
        description: form.serviceDescription,
        code: form.serviceCode || undefined,
        municipalityCode: form.municipalityCode || undefined,
      },
      amount,
      competenceDate: form.competenceDate,
      email: sendEmail,
    };
  }

  async function calculate() {
    if (calculating || !canSubmit) return;
    setCalculating(true);
    setCalcError(null);
    const key = JSON.stringify([form, sendEmail, fiscalEnvironment]);
    try {
      const result = await invoicesApi.calculate(buildInput(parseCurrency(form.amount), form.externalId || "dashboard-calculate"));
      setCalc({ key, result });
    } catch (err: unknown) {
      setCalc(null);
      setCalcError(err instanceof ApiError && err.status === 503 ? t("calculate.unavailable") : err instanceof Error && err.message ? err.message : t("calculate.failed"));
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
      router.push(`/app/invoices/${created.id}`);
    } catch (err: unknown) {
      if (err instanceof ApiError && [0, 409, 502, 503].includes(err.status)) setUncertain(true);
      const { _form, ...perField } = mapIssues(err, { "customer.taxId": "customerTaxId", "customer.name": "customerName", "customer.email": "customerEmail", "customer.address": "city", "customer.address.city": "city", "customer.address.state": "state", "service.code": "serviceCode", "service.municipalityCode": "municipalityCode", "service.description": "serviceDescription", amount: "amount", competenceDate: "competenceDate", companyId: "companyId", companyTaxId: "companyId", "company.municipalityCode": "companyId" }, (code, fallback) => (te.has(code) ? te(code) : fallback));
      setFieldErrors(perField);
      setError(_form ?? (Object.keys(perField).length > 0 ? t("fields.fixFields") : err instanceof Error && err.message ? err.message : t("fields.createFailed")));
    } finally { inFlight.current = false; setSubmitting(false); }
  }

  const set = (key: keyof typeof form, mask?: (value: string) => string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    { setForm((f) => ({ ...f, [key]: mask ? mask(e.target.value) : e.target.value })); setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev)); };

  const company = companies.find((c) => c.id === form.companyId && c.environment === fiscalEnvironment);
  const serviceCode = form.serviceCode || company?.defaultServiceCode || "";
  const municipalityCode = form.municipalityCode || company?.municipalityCode || "";
  const amountNumber = parseCurrency(form.amount);
  const hasAmount = form.amount !== "" && amountNumber > 0;
  const money = useMemo(() => new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US", { style: "currency", currency: "BRL" }), [locale]);
  const competence = form.competenceDate
    ? new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", { dateStyle: "medium" }).format(new Date(`${form.competenceDate}T12:00:00`))
    : "";
  const isLive = fiscalEnvironment === "live";

  // Required fields, validated as the user types. The submit button stays
  // disabled until this list is empty; the summary tells what is missing.
  const today = new Date().toLocaleDateString("sv-SE");
  const taxDigits = cleanTaxId(form.customerTaxId);
  const missing: string[] = [];
  if (!company || company.status === "blocked" || (isLive && company.status !== "ready") || !/^\d{7}$/.test(company.municipalityCode ?? "")) missing.push(t("fields.company"));
  if (!(taxDigits.length === 11 ? isValidCpf(taxDigits) : taxDigits.length === 14 && isValidCnpj(taxDigits))) missing.push(t("fields.taxId"));
  if (!form.customerName.trim()) missing.push(t("fields.name"));
  if (!form.serviceDescription.trim()) missing.push(t("fields.description"));
  if (!/^\d{6}$/.test(serviceCode)) missing.push(t("fields.serviceCode"));
  if (!/^\d{7}$/.test(municipalityCode)) missing.push(t("fields.municipalityCode"));
  if (!form.competenceDate || form.competenceDate > today) missing.push(t("fields.competence"));
  if (!hasAmount) missing.push(t("fields.amount"));
  if ((sendEmail || form.customerEmail) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail.trim())) missing.push(t("fields.email"));
  if (Boolean(form.city.trim()) !== Boolean(form.state)) missing.push(form.city.trim() ? t("fields.state") : t("fields.city"));
  const canSubmit = missing.length === 0 && !uncertain;

  return (
    <div className="flex flex-col gap-7">
      <PageHeader title={t("newTitle")} subtitle={t("newSubtitle")} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form id={FORM_ID} onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-5" aria-busy={submitting}>
          <Section n={1} title={t("form.company")} hint={t("form.companyHint")} delay={1}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("fields.company")} error={fieldErrors.companyId || undefined} required>
                {(c) => (
                  <select {...c} className="field" value={form.companyId} onChange={(event) => { setForm((previous) => ({ ...previous, companyId: event.target.value, serviceCode: "", municipalityCode: "" })); setFieldErrors({}); }} disabled={loading} required>
                    {loading && <option value="">{t("fields.loadingCompanies")}</option>}
                    {!loading && companies.length === 0 && <option value="">{t("fields.noCompanies")}</option>}
                    {companies.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.tradeName || item.legalName}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t("fields.reference")} optionalLabel={t("fields.optional")} hint={t("hints.reference")}>
                {(c) => (
                  <input {...c} type="text" className="field" placeholder={t("placeholders.reference")} value={form.externalId} onChange={set("externalId")} autoComplete="off" spellCheck={false} />
                )}
              </Field>
            </div>
            {company && (company.status === "blocked" || (isLive && company.status !== "ready") || !/^\d{7}$/.test(company.municipalityCode ?? "")) && <p className="banner banner-warn">{t("fields.companyNotReady")} <Link href={`/app/companies/${company.id}`} className="underline">{t("fields.configureCompany")}</Link></p>}
            {nextCursor && <Button variant="ghost" onClick={loadMoreCompanies} loading={loadingMore}>{t("fields.loadMoreCompanies")}</Button>}
          </Section>

          <Section n={2} title={t("form.customer")} hint={t("form.customerHint")} delay={2}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("fields.taxId")} error={fieldErrors.customerTaxId || undefined} required>
                {(c) => (
                  <input {...c} type="text" inputMode="text" autoCapitalize="characters" className="field font-mono tabular-nums" placeholder={t("placeholders.taxId")} value={form.customerTaxId} onChange={set("customerTaxId", maskTaxId)} maxLength={18} autoComplete="off" required />
                )}
              </Field>
              <Field label={t("fields.name")} error={fieldErrors.customerName || undefined} required>
                {(c) => (
                  <input {...c} type="text" className="field" placeholder={t("placeholders.name")} value={form.customerName} onChange={set("customerName")} autoComplete="organization" required />
                )}
              </Field>
            </div>
            <Field label={t("fields.email")} error={fieldErrors.customerEmail || undefined} required={sendEmail} optionalLabel={sendEmail ? undefined : t("fields.optional")} hint={t("hints.email")}>
              {(c) => (
                <input {...c} type="email" inputMode="email" className="field" placeholder={t("placeholders.email")} value={form.customerEmail} onChange={set("customerEmail")} autoComplete="email" spellCheck={false} />
              )}
            </Field>
            <label className="choice items-start">
              <input type="checkbox" checked={sendEmail} onChange={(event) => { setSendEmail(event.target.checked); setFieldErrors((prev) => (prev.customerEmail ? { ...prev, customerEmail: "" } : prev)); }} className="mt-0.5 h-4 w-4 flex-none accent-[var(--accent)]" />
              <span className="min-w-0">
                <span className="block text-[14px] text-text">{t("sendEmail.label")}</span>
                <span className="block text-[12.5px] text-text-4">{isLive ? t("sendEmail.hint") : t("sendEmail.hintTest")}</span>
              </span>
            </label>
            <div className="grid grid-cols-[1fr_96px] gap-4">
              <Field label={t("fields.city")} error={fieldErrors.city || undefined} optionalLabel={t("fields.optional")}>
                {(c) => (
                  <input {...c} type="text" className="field" placeholder={t("placeholders.city")} value={form.city} onChange={set("city")} autoComplete="address-level2" />
                )}
              </Field>
              <Field label={t("fields.state")} error={fieldErrors.state || undefined} optionalLabel={t("fields.optional")}>
                {(c) => (
                  <input {...c} type="text" className="field font-mono uppercase" maxLength={2} placeholder={t("placeholders.state")} value={form.state} onChange={set("state", maskState)} autoComplete="address-level1" />
                )}
              </Field>
            </div>
          </Section>

          <Section n={3} title={t("form.service")} hint={t("form.serviceHint")} delay={3}>
            <Field label={t("fields.description")} error={fieldErrors.serviceDescription || undefined} required>
              {(c) => (
                <textarea {...c} className="field resize-y" rows={3} placeholder={t("placeholders.description")} value={form.serviceDescription} onChange={set("serviceDescription")} required />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("fields.serviceCode")} error={fieldErrors.serviceCode || undefined} required={!company?.defaultServiceCode} optionalLabel={company?.defaultServiceCode ? t("fields.optional") : undefined} hint={company?.defaultServiceCode ? t("hints.serviceCodeDefault", { code: company.defaultServiceCode }) : t("hints.serviceCode")}>
                {(c) => <ServiceCodeCombobox id={c.id} aria-describedby={c["aria-describedby"]} aria-invalid={c["aria-invalid"]} value={form.serviceCode} onChange={(code) => { setForm((f) => ({ ...f, serviceCode: code })); setFieldErrors((previous) => ({ ...previous, serviceCode: "" })); }} placeholder={company?.defaultServiceCode} required={!company?.defaultServiceCode} />}
              </Field>
              <Field label={t("fields.municipalityCode")} error={fieldErrors.municipalityCode || undefined} required={!company?.municipalityCode} optionalLabel={company?.municipalityCode ? t("fields.optional") : undefined} hint={company?.municipalityCode ? t("hints.municipalityDefault", { code: company.municipalityCode }) : t("hints.municipalityCode")}>
                {(c) => <input {...c} type="text" inputMode="numeric" className="field font-mono tabular-nums" placeholder={company?.municipalityCode ?? t("placeholders.municipalityCode")} value={form.municipalityCode} onChange={set("municipalityCode", maskDigits(7))} pattern="[0-9]{7}" maxLength={7} autoComplete="off" required={!company?.municipalityCode} />}
              </Field>
              <Field label={t("fields.competence")} error={fieldErrors.competenceDate || undefined} required>
                {(c) => <input {...c} type="date" className="field" max={today} value={form.competenceDate} onChange={set("competenceDate")} required />}
              </Field>
              <Field label={t("fields.amount")} error={fieldErrors.amount || undefined} required>
                {(c) => (
                  <div className="relative">
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-[13px] text-text-4">R$</span>
                    <input {...c} type="text" inputMode="numeric" className="field pl-10 text-right font-mono tabular-nums" placeholder="0,00" value={form.amount} onChange={set("amount", maskCurrency)} autoComplete="off" required />
                  </div>
                )}
              </Field>
            </div>
          </Section>

          {uncertain && <div className="banner banner-warn flex-col"><p>{t("fields.uncertain")}</p><Button onClick={() => router.push("/app/invoices")}>{t("fields.checkInvoices")}</Button></div>}
          {error && (
            <div role="alert" className="banner banner-danger">
              <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-none" />
              {error}
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
            <SummaryRow label={t("summary.customer")} value={form.customerName} />
            <SummaryRow label={t("summary.taxId")} value={form.customerTaxId} mono />
            <SummaryRow label={t("fields.serviceCode")} value={serviceCode} mono />
            <SummaryRow label={t("fields.municipalityCode")} value={municipalityCode} mono />
            <SummaryRow label={t("summary.competence")} value={competence} />
            <SummaryRow label={t("summary.email")} value={sendEmail ? form.customerEmail || t("summary.emailPending") : t("summary.emailOff")} />
          </dl>

          {isLive && (
            <p className="flex items-start gap-2 rounded-[9px] border border-warn/30 bg-warn/5 p-3 text-[12.5px] text-text-3">
              <ShieldAlert size={14} aria-hidden className="mt-0.5 flex-none text-warn" />
              {t("summary.liveWarning")}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <Button variant="ghost" onClick={calculate} loading={calculating} disabled={!canSubmit || submitting} className="w-full">
              {calculating ? t("calculate.calculating") : t("calculate.button")}
            </Button>
            {calcError && <p role="alert" className="text-[12.5px] text-danger">{calcError}</p>}
            {calc && (calc.key === JSON.stringify([form, sendEmail, fiscalEnvironment])
              ? <InvoiceCalculationPanel result={calc.result} format={(value) => money.format(Number(value))} />
              : <p role="status" className="text-[12.5px] text-text-4">{t("calculate.stale")}</p>)}
          </div>

          <div className="flex flex-col gap-2.5">
            <Button type="submit" form={FORM_ID} variant="accent" loading={submitting} disabled={!canSubmit} aria-describedby="invoice-missing" className="w-full">
              {submitting ? t("submitting") : t("submit")}
            </Button>
            <p id="invoice-missing" role="status" className={`text-[12.5px] ${missing.length ? "text-text-4" : "text-accent"}`}>
              {missing.length ? t("summary.missing", { fields: missing.join(", ") }) : t("summary.ready")}
            </p>
            <Button variant="ghost" onClick={() => router.back()} disabled={submitting} className="w-full">
              {tc("cancel")}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
