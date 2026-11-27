"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { integrations, type IntegrationConnection, type IntegrationProvider } from "@/lib/api";
import { useApiErrorText } from "@/lib/use-api-error";
import { Select } from "@/components/ui/select";

interface ConnectionCredentialsProps {
  connection: IntegrationConnection;
  provider?: IntegrationProvider;
  canManage: boolean;
  onUpdated: (connection: IntegrationConnection) => void;
}

/** Lists what the client typed when connecting (never its value) and lets them replace it. */
export function ConnectionCredentials({ connection, provider, canManage, onUpdated }: ConnectionCredentialsProps) {
  const t = useTranslations("Integrations");
  const apiError = useApiErrorText();
  const { success, error: toastError } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const fields = (provider?.credentialFields ?? []).filter((field) => !field.generate);
  if (fields.length === 0 || connection.state === "disconnected") return null;

  async function save(key: string) {
    setBusy(true);
    try {
      const options = fields.find((field) => field.key === key)?.options;
      onUpdated(await integrations.updateCredentials(connection.id, { [key]: (value || options?.[0] || "").trim() }));
      success(t("detail.credentials.saved"));
      setEditing(null);
      setValue("");
    } catch (cause) {
      toastError(apiError(cause, String(cause)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="credentials-title" className="flex flex-col gap-2">
      <h3 id="credentials-title" className="text-[14px] font-medium text-text">{t("detail.credentials.title")}</h3>
      <p className="field-hint">{t("detail.credentials.hint")}</p>
      <ul className="flex flex-col divide-y divide-border rounded-[12px] border border-border">
        {fields.map((field) => (
          <li key={field.key} className="flex flex-col gap-2 px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[14px] text-text">{field.options && t.has(`wizard.fields.${field.key}`) ? t(`wizard.fields.${field.key}`) : field.label}</p>
                {!field.options &&<p className="text-[12.5px] text-text-4">{t("detail.credentials.stored")} · ••••••••</p>}
              </div>
              {canManage && editing !== field.key && (
                <Button size="sm" variant="secondary" onClick={() => { setEditing(field.key); setValue(""); }}>{t("detail.credentials.change")}</Button>
              )}
            </div>
            {editing === field.key && (
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim() || field.options) void save(field.key); }}>
                <Field label={t("detail.credentials.newValue")} className="min-w-[14rem] flex-1">
                  {(control) => field.options ? (
                    <Select {...control} value={value || field.options[0]} onChange={(e) => setValue(e.target.value)}>
                      {field.options.map((option) => <option key={option} value={option}>{t.has(`wizard.options.${field.key}.${option}`) ? t(`wizard.options.${field.key}.${option}`) : option}</option>)}
                    </Select>
                  ) : <Input {...control} type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />}
                </Field>
                <Button type="submit" variant="accent" size="sm" disabled={!value.trim() && !field.options} loading={busy}>{t("detail.credentials.save")}</Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setEditing(null); setValue(""); }}>{t("detail.credentials.cancel")}</Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
