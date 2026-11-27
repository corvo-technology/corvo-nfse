"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { integrations, type IntegrationConnection, type IntegrationProvider } from "@/lib/api";
import { useApiErrorText } from "@/lib/use-api-error";

interface WebhookSecretFormProps {
  connectionId: string;
  /** The field the platform issues after the address is registered. */
  field: IntegrationProvider["credentialFields"][number];
  onActivated: (connection: IntegrationConnection) => void;
}

/** Saves the secret the platform showed after the address was registered, then turns the connection on. */
export function WebhookSecretForm({ connectionId, field, onActivated }: WebhookSecretFormProps) {
  const t = useTranslations("Integrations");
  const apiError = useApiErrorText();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await integrations.updateCredentials(connectionId, { [field.key]: value.trim() });
      onActivated(await integrations.activate(connectionId));
    } catch (cause) {
      setError(apiError(cause, t("wizard.awaitingSecret.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Field label={field.label} hint={t("wizard.awaitingSecret.hint")}>
        {(control) => <Input {...control} type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />}
      </Field>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <Button type="submit" variant="accent" className="self-start" disabled={!value.trim()} loading={busy}>{t("wizard.awaitingSecret.save")}</Button>
    </form>
  );
}
