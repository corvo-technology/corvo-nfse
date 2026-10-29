"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { integrations, type IntegrationRule, type IntegrationRuleInput } from "@/lib/api";

interface ConnectionSettingsProps {
  connectionId: string;
  canManage: boolean;
}

const toInput = (rule: IntegrationRule): IntegrationRuleInput => ({
  externalProductId: rule.externalProductId,
  service: rule.service,
  sendEmail: rule.sendEmail,
  allowAnonymousCustomer: rule.allowAnonymousCustomer,
});

/** Edits the connection's default rule; rules created per product through the API are kept as they are. */
export function ConnectionSettings({ connectionId, canManage }: ConnectionSettingsProps) {
  const t = useTranslations("Integrations");
  const tc = useTranslations("Common");
  const { success, error: toastError } = useToast();
  const [rules, setRules] = useState<IntegrationRule[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [description, setDescription] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [anonymous, setAnonymous] = useState(false);
  const [saved, setSaved] = useState({ description: "", sendEmail: true, anonymous: false });
  const [busy, setBusy] = useState(false);

  function adopt(list: IntegrationRule[]) {
    const main = list.find((rule) => rule.externalProductId === null);
    const values = { description: main?.service.description ?? "", sendEmail: main?.sendEmail ?? true, anonymous: main?.allowAnonymousCustomer ?? false };
    setRules(list);
    setSaved(values);
    setDescription(values.description);
    setSendEmail(values.sendEmail);
    setAnonymous(values.anonymous);
  }

  useEffect(() => {
    let alive = true;
    integrations.rules(connectionId).then((list) => { if (alive) adopt(list); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [connectionId]);

  if (failed) return <p role="alert" className="text-[13.5px] text-danger">{t("detail.settings.loadError")}</p>;
  if (rules === null) return <p className="text-[13px] text-text-4">{tc("loading")}</p>;

  const others = rules.filter((rule) => rule.externalProductId !== null);
  const dirty = description.trim() !== saved.description || sendEmail !== saved.sendEmail || anonymous !== saved.anonymous;

  async function save() {
    const main = rules?.find((rule) => rule.externalProductId === null);
    const service = { ...main?.service };
    const text = description.trim();
    if (text) service.description = text;
    else delete service.description;
    const edited: IntegrationRuleInput = { externalProductId: null, service, sendEmail, allowAnonymousCustomer: anonymous };
    setBusy(true);
    try {
      await integrations.putRules(connectionId, [edited, ...others.map(toInput)]);
      adopt(await integrations.rules(connectionId));
      success(t("detail.settings.saved"));
    } catch (cause) {
      toastError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (dirty) void save(); }}>
      <Field label={t("detail.settings.description")} hint={t("detail.settings.descriptionHint")}>
        {(control) => <Input {...control} value={description} maxLength={200} disabled={!canManage} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <Toggle checked={sendEmail} onChange={setSendEmail} disabled={!canManage} label={t("detail.settings.sendEmail")} />
      <Toggle checked={anonymous} onChange={setAnonymous} disabled={!canManage} label={t("detail.settings.anonymous")} description={t("detail.settings.anonymousHint")} />
      {others.length > 0 && <p className="text-[13px] text-text-3">{t("detail.settings.otherRules", { count: others.length })}</p>}
      {canManage && (
        <Button type="submit" variant="accent" className="self-end" disabled={!dirty} loading={busy}>{t("detail.settings.save")}</Button>
      )}
    </form>
  );
}
