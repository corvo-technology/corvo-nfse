"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import type { IntegrationProvider } from "@/lib/api";
import type { Company } from "@/lib/types";
import { ConnectError, connectProvider } from "@/lib/integrations";

interface ConnectFlowProps {
  providers: IntegrationProvider[];
  companies: Company[];
  /** The dashboard-wide Test/Production switch; connections follow it. */
  environment: "test" | "live";
  /** Skips the platform step, e.g. when the client picked it from the empty state. */
  initialProvider?: string | null;
}

type Step = "platform" | "details" | "done";

export function providerDescriptionKey(id: string): "woovi" | "abacatepay" | "other" {
  return id === "woovi" || id === "abacatepay" ? id : "other";
}

export function ConnectFlow({ providers, companies, environment, initialProvider }: ConnectFlowProps) {
  const router = useRouter();
  const backToList = () => router.push("/app/integrations");
  const t = useTranslations("Integrations");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const [step, setStep] = useState<Step>(initialProvider ? "details" : "platform");
  const [providerId, setProviderId] = useState<string | null>(initialProvider ?? null);
  const [companyId, setCompanyId] = useState(companies.length === 1 ? companies[0].id : "");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copied, setCopied] = useState(false);

  const provider = providers.find((p) => p.id === providerId) ?? null;
  const askedFields = provider?.credentialFields.filter((field) => !field.generate) ?? [];
  const urlHasSecret = provider?.credentialFields.some((field) => field.inWebhookUrl) ?? false;
  const ready = Boolean(provider && companyId && askedFields.every((field) => (credentials[field.key] ?? "").trim()));

  async function submit() {
    if (!provider || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await connectProvider({
        provider: provider.id,
        companyId,
        environment,
        credentials: Object.fromEntries(askedFields.map((field) => [field.key, credentials[field.key].trim()])),
        sendEmail,
      });
      setWebhookUrl(result.webhookUrl);
      setSecrets(result.secrets);
      setStep("done");
    } catch (cause) {
      const failed = cause instanceof ConnectError;
      setError(`${failed ? t(`wizard.errors.${cause.step}`) : t("wizard.errors.create")}: ${cause instanceof Error ? cause.message : ""}`.trim());
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copySecret(value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  }

  return (
    <Card className="flex max-w-[640px] flex-col gap-4 p-5 sm:p-6">
      {step === "done" && <h2 className="text-[17px] font-medium text-text">{t("wizard.done.title")}</h2>}
      {step === "platform" && (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] text-text-3">{t("wizard.stepPlatform")}</p>
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setProviderId(p.id); setStep("details"); }}
              className="flex flex-col gap-1 rounded-[12px] border border-border bg-surface px-4 py-3.5 text-left transition-colors hover:border-accent-border hover:bg-accent-surface"
            >
              <span className="text-[15px] font-medium text-text">{p.name}</span>
              <span className="text-[13px] text-text-3">{t(`providers.${providerDescriptionKey(p.id)}`)}</span>
            </button>
          ))}
        </div>
      )}

      {step === "details" && provider && (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <p className="text-[14px] font-medium text-text">{provider.name}</p>
          {companies.length === 0 ? (
            <p role="alert" className="text-[13.5px] text-warn">{t("wizard.noCompanies")}</p>
          ) : (
            <Field label={t("wizard.company")} required>
              {(control) => (
                <select {...control} className="field" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  <option value="">{t("wizard.companyPlaceholder")}</option>
                  {companies.map((company) => <option key={company.id} value={company.id}>{company.tradeName || company.legalName}</option>)}
                </select>
              )}
            </Field>
          )}
          {askedFields.map((field) => (
            <Field key={field.key} label={field.label} required>
              {(control) => (
                <Input {...control} type={field.secret ? "password" : "text"} autoComplete="off" value={credentials[field.key] ?? ""} onChange={(e) => setCredentials({ ...credentials, [field.key]: e.target.value })} />
              )}
            </Field>
          ))}
          <Toggle checked={sendEmail} onChange={setSendEmail} label={t("wizard.sendEmail")} />
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          <div className="flex justify-between gap-2.5">
            {!initialProvider && <Button variant="ghost" onClick={() => setStep("platform")} disabled={busy}>{t("wizard.back")}</Button>}
            <Button type="submit" variant="accent" className="ml-auto" disabled={!ready} loading={busy}>{busy ? t("wizard.connecting") : t("wizard.connect")}</Button>
          </div>
        </form>
      )}

      {step === "done" && provider && (
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-text-2">{t("wizard.done.body")}</p>
          <div className="flex flex-col gap-1.5">
            <span className="field-label">{t("wizard.done.urlLabel")}</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-[10px] border border-border bg-black/20 px-3 py-2 font-mono text-[12.5px] text-text-2">{webhookUrl}</code>
              <Button variant="secondary" size="sm" onClick={() => void copy()} aria-label={tc("copy")}>
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {copied ? tc("copied") : tc("copy")}
              </Button>
            </div>
          </div>
          {Object.entries(secrets).map(([key, value]) => (
            <div key={key} className="flex flex-col gap-1.5">
              <span className="field-label">{t("wizard.done.secretLabel")}</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-[10px] border border-border bg-black/20 px-3 py-2 font-mono text-[12.5px] text-text-2">{value}</code>
                <Button variant="secondary" size="sm" onClick={() => void copySecret(value)} aria-label={t("wizard.done.copySecret")}>
                  {copiedSecret ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                  {copiedSecret ? tc("copied") : tc("copy")}
                </Button>
              </div>
              <p className="field-hint">{t("wizard.done.secretHint")}</p>
            </div>
          ))}
          <p className="text-[13.5px] text-text-3">{provider.webhookInstructions[locale === "pt" ? "pt" : "en"]}</p>
          {urlHasSecret && <p role="alert" className="text-[13px] text-warn">{t("wizard.done.secretWarning")}</p>}
          <Button variant="accent" className="ml-auto" onClick={backToList}>{t("wizard.done.finish")}</Button>
        </div>
      )}
    </Card>
  );
}
