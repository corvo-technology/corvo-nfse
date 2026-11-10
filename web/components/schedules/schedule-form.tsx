"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { schedules as schedulesApi, type CreateScheduleInput, type UpdateScheduleInput } from "@/lib/api";
import type { InvoiceSchedule, ScheduleFrequency } from "@/lib/types";
import { apiErrorMessage } from "@/lib/api-errors";
import { maskTaxId } from "@/lib/masks";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export interface ScheduleCompanyOption { id: string; name: string }
interface Props {
  open: boolean;
  onClose: () => void;
  companies: ScheduleCompanyOption[];
  /** Present when editing; absent when creating. */
  schedule?: InvoiceSchedule;
  onSaved: (schedule: InvoiceSchedule) => void;
}

const FREQUENCIES: ScheduleFrequency[] = ["WEEKLY", "BIWEEKLY", "MONTHLY"];
type Body = Record<string, unknown>;

/** Tomorrow in São Paulo as YYYY-MM-DD: the earliest date a schedule can start. */
export function tomorrowInSaoPaulo(now: Date = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
const digits = (value: string) => value.replace(/\D/g, "");
const toNumber = (value: string) => Number(value.trim().replace(",", "."));
const sub = (body: Body, key: string): Body => (body[key] as Body | undefined) ?? {};

export function ScheduleForm({ open, onClose, companies, schedule, onSaved }: Props) {
  const t = useTranslations("Schedules");
  const te = useTranslations("ApiErrors");
  const editing = schedule !== undefined;
  const stored = schedule?.invoice ?? {};
  const customer = sub(stored, "customer");
  const [companyId, setCompanyId] = useState(schedule?.companyId ?? "");
  const [kind, setKind] = useState<"once" | "recurring">(schedule?.kind ?? "once");
  const [frequency, setFrequency] = useState<ScheduleFrequency>(schedule?.frequency ?? "MONTHLY");
  const [firstDate, setFirstDate] = useState(schedule?.anchorOn ?? "");
  const [endsOn, setEndsOn] = useState(schedule?.endsOn ?? "");
  const [amount, setAmount] = useState(typeof stored.amount === "number" ? String(stored.amount) : "");
  const [description, setDescription] = useState(String(sub(stored, "service").description ?? ""));
  const [purchaseOrder, setPurchaseOrder] = useState(typeof stored.purchaseOrder === "string" ? stored.purchaseOrder : "");
  const [notes, setNotes] = useState(typeof stored.notes === "string" ? stored.notes : "");
  const [name, setName] = useState(String(customer.name ?? ""));
  const [taxId, setTaxId] = useState(maskTaxId(String(customer.taxId ?? "")));
  const [email, setEmail] = useState(String(customer.email ?? ""));
  const [sendEmail, setSendEmail] = useState(Boolean(sub(sub(stored, "options"), "email").send));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const required = t("form.required");
  const recurring = kind === "recurring";

  const validate = (): boolean => {
    const found: Record<string, string> = {};
    if (!editing && !companyId) found.company = required;
    if (!firstDate) found.firstDate = required;
    if (!(toNumber(amount) > 0)) found.amount = required;
    if ((name.trim() || email.trim()) && !digits(taxId)) found.taxId = required;
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const customerBody = (): Body | undefined => {
    const body: Body = {};
    if (name.trim()) body.name = name.trim();
    if (digits(taxId)) body.taxId = digits(taxId);
    if (email.trim()) body.email = email.trim();
    return Object.keys(body).length > 0 ? body : undefined;
  };

  const createPayload = (): CreateScheduleInput => ({
    companyId,
    amount: toNumber(amount),
    competenceDate: firstDate,
    ...(customerBody() ? { customer: customerBody() } : {}),
    ...(description.trim() ? { service: { description: description.trim() } } : {}),
    ...(purchaseOrder.trim() ? { purchaseOrder: purchaseOrder.trim() } : {}),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    options: {
      type: recurring ? "RECURRING" : "SCHEDULE",
      ...(recurring ? { recurrence: { frequency, ...(endsOn ? { endsOn } : {}) } } : {}),
      ...(sendEmail ? { email: { send: true } } : {}),
    },
  });

  /** Only what changed: objects the API merges shallowly are sent whole. */
  const updatePayload = (): UpdateScheduleInput => {
    const patch: UpdateScheduleInput = {};
    const invoice: Body = {};
    if (toNumber(amount) !== stored.amount) invoice.amount = toNumber(amount);
    const service = sub(stored, "service");
    if (description.trim() !== String(service.description ?? "")) invoice.service = { ...service, description: description.trim() };
    // An empty text clears the field: the API drops a blank value when the note is issued.
    if (purchaseOrder.trim() !== (typeof stored.purchaseOrder === "string" ? stored.purchaseOrder : "")) invoice.purchaseOrder = purchaseOrder.trim();
    if (notes.trim() !== (typeof stored.notes === "string" ? stored.notes : "")) invoice.notes = notes.trim();
    const now = customerBody() ?? {};
    if (JSON.stringify(now) !== JSON.stringify(Object.fromEntries(Object.entries(customer).filter(([k]) => ["name", "taxId", "email"].includes(k) && customer[k])))) invoice.customer = { ...customer, ...now };
    const options = sub(stored, "options");
    if (sendEmail !== Boolean(sub(options, "email").send)) invoice.options = { ...options, email: { send: sendEmail } };
    if (Object.keys(invoice).length > 0) patch.invoice = invoice;
    if (recurring && frequency !== schedule?.frequency) patch.frequency = frequency;
    if (recurring && endsOn !== (schedule?.endsOn ?? "")) patch.endsOn = endsOn || null;
    if (firstDate && firstDate !== schedule?.anchorOn) patch.anchorOn = firstDate;
    return patch;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !validate()) return;
    setApiError(null);
    if (editing && schedule) {
      const patch = updatePayload();
      if (Object.keys(patch).length === 0) return onClose();
      setSaving(true);
      try { onSaved(await schedulesApi.update(schedule.id, patch)); onClose(); }
      catch (cause) { setApiError(apiErrorMessage(cause, te.has, te, t("form.failed"))); }
      finally { setSaving(false); }
      return;
    }
    setSaving(true);
    try { onSaved(await schedulesApi.create(createPayload())); onClose(); }
    catch (cause) { setApiError(apiErrorMessage(cause, te.has, te, t("form.failed"))); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? t("form.titleEdit") : t("form.titleNew")} wide>
      <form className="flex flex-col gap-5" onSubmit={(e) => void submit(e)} noValidate>
        {editing && <p className="text-[13px] text-text-3">{t("form.editHint")}</p>}
        {!editing && (
          <Field label={t("form.company")} error={errors.company} required>
            {(c) => (
              <select {...c} className="field" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">{t("form.companyPlaceholder")}</option>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            )}
          </Field>
        )}
        {!editing && (
          <fieldset className="flex flex-col gap-2">
            <legend className="field-label">{t("form.type")}</legend>
            <div className="flex flex-wrap gap-4">
              {(["once", "recurring"] as const).map((value) => (
                <label key={value} className="flex items-center gap-2 text-[14px] text-text">
                  <input type="radio" name="schedule-kind" checked={kind === value} onChange={() => setKind(value)} />
                  {t(`form.${value}`)}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {recurring && (
          <Field label={t("form.frequency")}>
            {(c) => (
              <select {...c} className="field" value={frequency} onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}>
                {FREQUENCIES.map((value) => <option key={value} value={value}>{t(`frequency.${value}`)}</option>)}
              </select>
            )}
          </Field>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("form.firstDate")} hint={t("form.firstDateHint")} error={errors.firstDate} required>
            {(c) => <input {...c} type="date" className="field" min={tomorrowInSaoPaulo()} value={firstDate} onChange={(e) => setFirstDate(e.target.value)} />}
          </Field>
          {recurring && (
            <Field label={t("form.endsOn")} hint={t("form.endsOnHint")} optionalLabel={t("form.optional")}>
              {(c) => <input {...c} type="date" className="field" min={firstDate || tomorrowInSaoPaulo()} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}
            </Field>
          )}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("form.amount")} error={errors.amount} required>
            {(c) => <input {...c} type="text" inputMode="decimal" className="field" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Field label={t("form.description")} optionalLabel={t("form.optional")}>
            {(c) => <input {...c} type="text" className="field" value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("form.purchaseOrder")} optionalLabel={t("form.optional")} hint={t("form.purchaseOrderHint")}>
            {(c) => <input {...c} type="text" className="field" maxLength={60} value={purchaseOrder} onChange={(e) => setPurchaseOrder(e.target.value)} autoComplete="off" />}
          </Field>
          <Field label={t("form.notes")} optionalLabel={t("form.optional")} hint={t("form.notesHint")}>
            {(c) => <textarea {...c} className="field resize-y" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-text-3">{t("form.customerHint")}</p>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label={t("form.customerName")}>
              {(c) => <input {...c} type="text" className="field" value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label={t("form.customerTaxId")} error={errors.taxId}>
              {(c) => <input {...c} type="text" inputMode="numeric" className="field" value={taxId} onChange={(e) => setTaxId(maskTaxId(e.target.value))} />}
            </Field>
            <Field label={t("form.customerEmail")}>
              {(c) => <input {...c} type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[14px] text-text">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          {t("form.sendEmail")}
        </label>
        {apiError && <p role="alert" className="text-[13px] text-danger">{apiError}</p>}
        <div className="flex justify-end gap-3">
          <Button type="submit" variant="accent" loading={saving}>{editing ? t("form.save") : t("form.create")}</Button>
        </div>
      </form>
    </Modal>
  );
}
