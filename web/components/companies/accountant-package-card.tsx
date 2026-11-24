"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { invoicePackages, type AccountantSendRecord, type AccountantSendStatus, type AccountantSettings, type InvoicePackageSummary } from "@/lib/api";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZONE = "America/Sao_Paulo";

function previousMonth(): string {
  const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Sends the month package to the company's accountant by e-mail on the 1st of each month. Off until an e-mail is given. */
export function AccountantPackageCard({ companyId, canManage, environment }: { companyId: string; canManage: boolean; environment: "test" | "live" }) {
  const t = useTranslations("AccountantPackage");
  const locale = useLocale();
  const apiError = useApiErrorText();
  const [settings, setSettings] = useState<AccountantSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [month, setMonth] = useState(previousMonth);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [sends, setSends] = useState<AccountantSendRecord[]>([]);
  const [confirm, setConfirm] = useState<{ month: string; summary: InvoicePackageSummary | null; error: string | null } | null>(null);

  const loadSends = useCallback((signal?: AbortSignal) =>
    invoicePackages.accountantSends(companyId, signal).then(setSends).catch(() => undefined), [companyId]);

  useEffect(() => {
    const abort = new AbortController();
    invoicePackages.accountant(companyId, abort.signal)
      .then((value) => { setSettings(value); setEnabled(Boolean(value.email)); setEmail(value.email ?? ""); })
      .catch(() => undefined);
    void loadSends(abort.signal);
    return () => abort.abort();
  }, [companyId, loadSends]);

  const monthText = (value: string) => {
    const [year, number] = value.split("-").map(Number);
    const name = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, number - 1, 1)));
    return t("history.month", { name: name.charAt(0).toLocaleUpperCase(locale) + name.slice(1), year });
  };
  const when = (iso: string) => {
    const date = new Date(iso);
    return {
      date: new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: ZONE }).format(date),
      time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ZONE }).format(date),
    };
  };
  const historyLine = (item: AccountantSendRecord) => t(`history.${item.status}`, { month: monthText(item.month), email: item.recipient, count: item.invoiceCount, ...when(item.createdAt) });

  async function save() {
    setMessage(null);
    const value = enabled ? email.trim() : "";
    if (enabled && !EMAIL.test(value)) return setError(t("invalid"));
    setError(null); setBusy("save");
    try {
      const next = await invoicePackages.setAccountant(companyId, value || null);
      setSettings(next); setEnabled(Boolean(next.email)); setEmail(next.email ?? "");
      setMessage(next.email ? t(next.testEmailSent ? "savedWithTest" : "saved", { email: next.email }) : t("off"));
    } catch (cause) { setError(apiError(cause, t("failed"))); }
    finally { setBusy(null); }
  }

  /** Opens the confirmation with what is about to go out; nothing is sent yet. */
  async function review() {
    setMessage(null); setError(null);
    setConfirm({ month, summary: null, error: null });
    try {
      const summary = await invoicePackages.summary(companyId, month);
      setConfirm({ month, summary, error: null });
    } catch (cause) { setConfirm({ month, summary: null, error: apiError(cause, t("failed")) }); }
  }

  async function sendNow() {
    if (!confirm) return;
    const target = confirm.month;
    setConfirm(null); setMessage(null); setError(null); setBusy("send");
    try {
      const status: AccountantSendStatus = await invoicePackages.sendToAccountant(companyId, target);
      setMessage(t(`sendStatus.${status}`, { email: settings?.email ?? "" }));
      void loadSends();
    } catch (cause) { setError(apiError(cause, t("failed"))); void loadSends(); }
    finally { setBusy(null); }
  }

  const summary = confirm?.summary ?? null;
  const blocked = summary !== null && (summary.count === 0 || summary.count > summary.limit);
  const money = (value: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(Number(value));

  return <Card className="flex flex-col gap-4 p-5">
    <div>
      <h2 className="text-base font-medium">{t("title")}</h2>
      <p className="mt-1 text-sm text-text-3">{t("hint")}</p>
      {environment === "test" && <p className="mt-2 text-sm text-text-3">{t("testNote")}</p>}
    </div>
    {settings?.email && <p className="text-sm">{t("active", { email: settings.email })}</p>}
    {canManage && <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />{t("toggle")}</label>
      {enabled && <Field label={t("email")} hint={t("privacy")} error={error ?? undefined} className="w-full max-w-sm">{(control) => <Input {...control} type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />}</Field>}
      {!enabled && error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div><Button type="submit" loading={busy === "save"}>{t("save")}</Button></div>
    </form>}
    {canManage && settings?.email && <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
      <Field label={t("sendMonth")} className="w-48">{(control) => <Input {...control} type="month" value={month} onChange={(event) => setMonth(event.target.value)} />}</Field>
      <Button variant="secondary" loading={busy === "send"} disabled={!/^\d{4}-\d{2}$/.test(month)} onClick={() => void review()}>{t("sendNow")}</Button>
    </div>}
    {message && <p role="status" className="text-sm text-text-3">{message}</p>}
    {sends.length > 0 && <div className="border-t border-border pt-4">
      <h3 className="text-sm font-medium">{t("history.title")}</h3>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {sends.map((item) => <li key={item.id} className={item.status === "sent" ? undefined : "text-text-3"}>{historyLine(item)}</li>)}
      </ul>
      <p className="mt-2 text-xs text-text-3">{t("history.note")}</p>
    </div>}
    <Modal open={confirm !== null} onClose={() => setConfirm(null)} title={t("confirm.title")}>
      <div className="flex flex-col gap-4 text-sm">
        {confirm && !summary && !confirm.error && <p>{t("confirm.loading")}</p>}
        {confirm?.error && <p role="alert" className="text-danger">{confirm.error}</p>}
        {confirm && summary && summary.count === 0 && <p>{t("confirm.empty", { month: monthText(confirm.month) })}</p>}
        {confirm && summary && summary.count > summary.limit && <p>{t("confirm.tooLarge", { month: monthText(confirm.month), count: summary.count, limit: summary.limit })}</p>}
        {confirm && summary && !blocked && <p>{t("confirm.summary", { month: monthText(confirm.month), email: settings?.email ?? "", count: summary.count, total: money(summary.total) })}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>{blocked || confirm?.error ? t("confirm.close") : t("confirm.cancel")}</Button>
          {summary && !blocked && <Button onClick={() => void sendNow()}>{t("confirm.confirm")}</Button>}
        </div>
      </div>
    </Modal>
  </Card>;
}
