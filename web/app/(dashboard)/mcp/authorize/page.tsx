"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Calculator, Check, CreditCard, FileKey2, FileSearch, Loader2, ReceiptText, ShieldCheck, WalletCards, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApiError, mcp, type McpConsentContext, type McpConsentParams } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CorvoWordmark } from "@/components/ui/corvo-logo";

const REQUIRED = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"] as const;

function readParams(search: URLSearchParams): McpConsentParams | null {
  for (const key of REQUIRED) if (!search.get(key)) return null;
  return {
    client_id: search.get("client_id")!,
    redirect_uri: search.get("redirect_uri")!,
    scope: search.get("scope") || undefined,
    state: search.get("state")!,
    code_challenge: search.get("code_challenge")!,
    code_challenge_method: search.get("code_challenge_method")!,
  };
}

type Outcome = { kind: "allowed" | "denied"; url: string };

const TOOL_GROUPS = {
  "nfse:read": [
    { icon: Building2, title: "tools.read.company", detail: "tools.read.companyDetail" },
    { icon: Calculator, title: "tools.read.calculate", detail: "tools.read.calculateDetail" },
    { icon: FileSearch, title: "tools.read.invoices", detail: "tools.read.invoicesDetail" },
    { icon: WalletCards, title: "tools.read.usage", detail: "tools.read.usageDetail" },
  ],
  "nfse:write": [
    { icon: Building2, title: "tools.write.company", detail: "tools.write.companyDetail" },
    { icon: ReceiptText, title: "tools.write.invoices", detail: "tools.write.invoicesDetail" },
  ],
  "nfse:certificates": [
    { icon: FileKey2, title: "tools.certificates.upload", detail: "tools.certificates.uploadDetail" },
  ],
  "billing:purchase": [
    { icon: CreditCard, title: "tools.purchase.credits", detail: "tools.purchase.creditsDetail" },
  ],
} as const;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-4 py-10 text-text">
      <CorvoWordmark size={18} variant="green" />
      <Card className="w-full max-w-[460px] p-6">{children}</Card>
    </div>
  );
}

function AuthorizeContent() {
  const t = useTranslations("McpAuthorize");
  const search = useSearchParams();
  const router = useRouter();
  const { status, tenantId: activeTenantId } = useAuth();
  const params = useMemo(() => readParams(search), [search]);
  const [context, setContext] = useState<McpConsentContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<"test" | "live">("test");
  const [extras, setExtras] = useState<string[]>([]);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // Not logged in: go through the normal login and come back to this exact URL.
  useEffect(() => {
    if (status !== "anonymous") return;
    const next = encodeURIComponent(`/mcp/authorize?${search.toString()}`);
    router.replace(`/login?mode=login&next=${next}`);
  }, [status, search, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!params) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- missing query parameters are only known after hydration
      setError(t("errors.invalid"));
      return;
    }
    const controller = new AbortController();
    mcp.consentContext(params, controller.signal).then((value) => {
      setContext(value);
      const full = (id: string) => value.tenants.find((tenant) => tenant.id === id)?.allowed_scopes.length === value.scopes.length;
      setSelected(activeTenantId && full(activeTenantId) ? activeTenantId : (value.tenants.find((tenant) => full(tenant.id))?.id ?? null));
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof ApiError && cause.status === 400 ? t("errors.invalid") : t("errors.generic"));
    });
    return () => controller.abort();
  }, [status, params, activeTenantId, t]);

  // An extra only counts if the chosen workspace's role can grant it.
  const grantedExtras = extras.filter((name) => context?.tenants.find((tenant) => tenant.id === selected)?.allowed_optional_scopes?.includes(name));

  const decide = async (decision: "allow" | "deny") => {
    if (!params || busy) return;
    setBusy(decision);
    setError(null);
    try {
      const allowing = decision === "allow";
      const scopes = context ? [...context.scopes.map((scope) => scope.name), ...grantedExtras] : undefined;
      const { redirect_url } = await mcp.decide(params, decision, allowing ? (selected ?? undefined) : undefined, allowing ? environment : undefined, allowing ? scopes : undefined);
      setOutcome({ kind: decision === "allow" ? "allowed" : "denied", url: redirect_url });
      window.location.assign(redirect_url);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 403 ? t("errors.forbidden") : t("errors.generic"));
      setBusy(null);
    }
  };

  if (outcome) {
    const allowed = outcome.kind === "allowed";
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className={cn("flex h-11 w-11 items-center justify-center rounded-full", allowed ? "bg-accent-surface text-accent" : "bg-danger-surface text-danger")}>
            {allowed ? <Check size={22} aria-hidden /> : <X size={22} aria-hidden />}
          </span>
          <h1 className="text-[18px] font-medium">{allowed ? t("allowedTitle") : t("deniedTitle")}</h1>
          <p className="text-sm text-text-3">{allowed ? t("allowedBody") : t("deniedBody")}</p>
          {allowed && <p className="text-[13px] text-text-3">{t("allowedHint")}</p>}
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {allowed && <a href={outcome.url} className="btn btn-secondary">{t("open")}</a>}
            <Link href="/app" className="btn btn-ghost">{t("goDashboard")}</Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (error && !context) {
    return (
      <Shell>
        <p role="alert" className="text-sm text-danger">{error}</p>
        <Link href="/app" className="btn btn-ghost mt-4">{t("goDashboard")}</Link>
      </Shell>
    );
  }

  if (!context) {
    return (
      <Shell>
        <p className="flex items-center justify-center gap-2 text-sm text-text-3"><Loader2 size={14} className="animate-spin" aria-hidden />{t("loading")}</p>
      </Shell>
    );
  }

  const selectable = context.tenants.filter((tenant) => tenant.allowed_scopes.length === context.scopes.length);
  const optional = context.optional_scopes ?? [];
  const selectedTenant = context.tenants.find((tenant) => tenant.id === selected);
  const scopeLabel = (name: string, fallback: string) => (t.has(`scopes.${name}`) ? t(`scopes.${name}`) : fallback);

  return (
    <Shell>
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-surface text-accent"><ShieldCheck size={18} aria-hidden /></span>
          <div className="flex flex-col gap-1">
            <h1 className="text-[17px] font-medium leading-snug">{t("wants", { name: context.client.name })}</h1>
            <p className="text-[13px] text-text-3">{t("returnTo", { host: context.redirect_host })}</p>
          </div>
        </div>

        <div className="border-y border-border py-4">
          <p className="mb-3 text-[13px] font-medium">{t("canDo")}</p>
          <div className="flex flex-col gap-3">
            {context.scopes.map((scope) => {
              const tools = TOOL_GROUPS[scope.name as keyof typeof TOOL_GROUPS];
              return (
                <section key={scope.name} className="border-l-2 border-accent pl-3">
                  <div className="flex items-center gap-2">
                    <Check size={14} className="text-accent" aria-hidden />
                    <p className="text-sm font-medium text-text">{scopeLabel(scope.name, scope.description)}</p>
                  </div>
                  {tools && <div className="mt-2 grid grid-cols-1 gap-1.5">
                    {tools.map(({ icon: Icon, title, detail }) => (
                      <div key={title} className="flex items-start gap-2 rounded-md bg-surface-alt px-2.5 py-2">
                        <Icon size={15} className="mt-0.5 shrink-0 text-text-3" aria-hidden />
                        <p className="text-[12px] leading-4 text-text-2"><span className="font-medium text-text">{t(title)}</span><span className="text-text-3"> · {t(detail)}</span></p>
                      </div>
                    ))}
                  </div>}
                </section>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] leading-4 text-text-3">{t("certificateNote")}</p>
        </div>

        {optional.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-medium">{t("optional.title")}</legend>
            {optional.map((scope) => {
              const grantable = selectedTenant?.allowed_optional_scopes?.includes(scope.name) ?? false;
              const tools = TOOL_GROUPS[scope.name as keyof typeof TOOL_GROUPS];
              return (
                <label key={scope.name} className={cn("flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 text-sm", grantedExtras.includes(scope.name) ? "border-accent-border bg-accent-surface" : "border-border", !grantable && "cursor-not-allowed opacity-50")}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={grantedExtras.includes(scope.name)}
                    disabled={!grantable}
                    onChange={(event) => setExtras((current) => (event.target.checked ? [...current, scope.name] : current.filter((name) => name !== scope.name)))}
                  />
                  <span className="flex flex-col">
                    <span>{scopeLabel(scope.name, scope.description)}</span>
                    {tools && <span className="text-[12px] text-text-3">{t(tools[0].detail)}</span>}
                    {!grantable && <span className="text-[12px] text-text-3">{t("optional.blocked")}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">{t("workspace")}</legend>
          {context.tenants.map((tenant) => {
            const allowed = tenant.allowed_scopes.length === context.scopes.length;
            return (
              <label
                key={tenant.id}
                className={cn("flex cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2.5 text-sm", selected === tenant.id ? "border-accent-border bg-accent-surface" : "border-border", !allowed && "cursor-not-allowed opacity-50")}
              >
                <input type="radio" name="tenant" value={tenant.id} checked={selected === tenant.id} disabled={!allowed} onChange={() => setSelected(tenant.id)} />
                <span className="flex flex-col">
                  <span>{tenant.name || tenant.id.slice(0, 8)}</span>
                  {!allowed && <span className="text-[12px] text-text-3">{t("workspaceBlocked")}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">{t("environment")}</legend>
          {(["test", "live"] as const).map((value) => (
            <label key={value} className={cn("flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 text-sm", environment === value ? "border-accent-border bg-accent-surface" : "border-border")}>
              <input type="radio" name="environment" value={value} checked={environment === value} onChange={() => setEnvironment(value)} className="mt-1" />
              <span className="flex flex-col">
                <span>{t(value === "test" ? "envTest" : "envLive")}</span>
                <span className="text-[12px] text-text-3">{t(value === "test" ? "envTestHint" : "envLiveHint")}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="text-[12.5px] text-text-3">{t("manage")}</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={busy !== null} loading={busy === "deny"} onClick={() => void decide("deny")}>{t("deny")}</Button>
          <Button className="flex-1" disabled={busy !== null || selectable.length === 0 || !selected} loading={busy === "allow"} onClick={() => void decide("allow")}>{t("allow")}</Button>
        </div>
      </div>
    </Shell>
  );
}

export default function McpAuthorizePage() {
  return (
    <Suspense fallback={null}>
      <AuthorizeContent />
    </Suspense>
  );
}
