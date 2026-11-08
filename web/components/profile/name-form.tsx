"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { auth } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";

/** Asks for the person's name and saves it. Used in the first-access screen and in Settings. */
export function NameForm({ initial = "", submitLabel, onDone }: { initial?: string; submitLabel: string; onDone?: () => void }) {
  const t = useTranslations("Profile");
  const apiError = useApiErrorText();
  const { refreshSession } = useAuth();
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = name.trim();
    if (!value || saving) return;
    setSaving(true);
    setError(null);
    try {
      await auth.updateProfile(value);
      await refreshSession();
      onDone?.();
    } catch (cause: unknown) {
      setError(apiError(cause, t("saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Field label={t("nameLabel")}>
        {(c) => (
          <input {...c} type="text" autoComplete="name" maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} className="field" />
        )}
      </Field>
      {error && <div role="alert" className="banner banner-danger">{error}</div>}
      <div>
        <Button type="submit" variant="accent" loading={saving} disabled={!name.trim()}>{submitLabel}</Button>
      </div>
    </form>
  );
}
