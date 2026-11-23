"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { invoicePackages, type AccountantSendStatus, type AccountantSettings } from "@/lib/api";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function previousMonth(): string {
  const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Sends the month package to the company's accountant by e-mail on the 1st of each month. Off until an e-mail is given. */
export function AccountantPackageCard({ companyId, canManage, environment }: { companyId: string; canManage: boolean; environment: "test" | "live" }) {
  const t = useTranslations("AccountantPackage");
  const apiError = useApiErrorText();
  const [settings, setSettings] = useState<AccountantSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [month, setMonth] = useState(previousMonth);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    invoicePackages.accountant(companyId, abort.signal)
      .then((value) => { setSettings(value); setEnabled(Boolean(value.email)); setEmail(value.email ?? ""); })
      .catch(() => undefined);
    return () => abort.abort();
  }, [companyId]);

  async function save() {
    setMessage(null);
    const value = enabled ? email.trim() : "";
    if (enabled && !EMAIL.test(value)) return setError(t("invalid"));
    setError(null); setBusy("save");
    try {
      const next = await invoicePackages.setAccountant(companyId, value || null);
      setSettings(next); setEnabled(Boolean(next.email)); setEmail(next.email ?? "");
      setMessage(next.email ? t("saved", { email: next.email }) : t("off"));
    } catch (cause) { setError(apiError(cause, t("failed"))); }
    finally { setBusy(null); }
  }

  async function sendNow() {
    setMessage(null); setError(null); setBusy("send");
    try {
      const status: AccountantSendStatus = await invoicePackages.sendToAccountant(companyId, month);
      setMessage(t(`sendStatus.${status}`, { email: settings?.email ?? "" }));
    } catch (cause) { setError(apiError(cause, t("failed"))); }
    finally { setBusy(null); }
  }

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
      <Button variant="secondary" loading={busy === "send"} disabled={!/^\d{4}-\d{2}$/.test(month)} onClick={() => void sendNow()}>{t("sendNow")}</Button>
    </div>}
    {message && <p role="status" className="text-sm text-text-3">{message}</p>}
  </Card>;
}
