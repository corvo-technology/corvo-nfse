"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, KeyRound, Plus } from "lucide-react";
import posthog from "posthog-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, DataTableSkeleton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { apiKeys, collectAll, type ApiKey } from "@/lib/api";
import type { KeyEnvironment, KeyScope } from "@/lib/types";
import { timeAgo } from "@/lib/i18n-helpers";
import { useApiErrorText } from "@/lib/use-api-error";

const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

function getApiKeyErrorMessage(error: unknown, fallback: string, tError: (key: string) => string, apiError: (error: unknown, fallback: string) => string): string {
  if (!(error instanceof Error)) return fallback;

  const status = (error as Error & { status?: number }).status;
  if (status === 401) {
    return tError("authRequired");
  }
  if (status === 403 && /permission|required/i.test(error.message)) {
    return tError("permissionRequired");
  }

  return apiError(error, fallback);
}

function daysUntil(isoDate: string): number {
  const date = new Date(isoDate);
  const now = new Date();
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export default function ApiKeysPage() {
  const t = useTranslations("ApiKeys");
  const apiError = useApiErrorText();
  const tc = useTranslations("Common");

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState("never");

  // Newly created key (shown once)
  const [newKey, setNewKey] = useState<{ apiKey: string; name: string; createdAt: string } | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  // Revoking state
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await collectAll((cursor) => apiKeys.list({ cursor, limit: 1000 }));
      setKeys(data);
    } catch (err: unknown) {
      setError(getApiKeyErrorMessage(err, t("errors.loadFailed"), (key) => t(`errors.${key}`), apiError));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchKeys();
  }, [fetchKeys]);

  function computeExpiresAt(value: string): string | undefined {
    if (value === "never") return undefined;
    const days = parseInt(value, 10);
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = (formData.get("name") as string).trim();
    const environment = formData.get("environment") as KeyEnvironment;
    const scope = formData.get("scope") as KeyScope;

    if (!name) return;

    setCreating(true);
    setCreateError(null);

    try {
      const body: { name: string; environment: string; scope: string; expiresAt?: string } = {
        name,
        environment,
        scope,
      };
      const exp = computeExpiresAt(expiresAt);
      if (exp) body.expiresAt = exp;

      const created = await apiKeys.create(body);
      if (posthogConfigured) {
        posthog.capture("api_key_created", {
          environment,
          scope,
          expiration_days: expiresAt === "never" ? null : Number(expiresAt),
        });
      }

      setNewKey({
        apiKey: created.plaintext,
        name: created.apiKey.name,
        createdAt: created.apiKey.createdAt,
      });

      setModalOpen(false);
      form.reset();
      setExpiresAt("never");

      // Refresh list (the new key won't show its full value in the list)
      fetchKeys();
    } catch (err: unknown) {
      setCreateError(getApiKeyErrorMessage(err, t("errors.createFailed"), (key) => t(`errors.${key}`), apiError));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (revokingId) return;
    setRevokingId(id);

    try {
      await apiKeys.delete(id);
      if (posthogConfigured) posthog.capture("api_key_revoked");
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (err: unknown) {
      setError(getApiKeyErrorMessage(err, t("errors.revokeFailed"), (key) => t(`errors.${key}`), apiError));
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCopy() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey.apiKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch {
      // Fallback: do nothing silently if clipboard API is unavailable
    }
  }

  const closeModal = () => {
    setModalOpen(false);
    setExpiresAt("never");
    setCreateError(null);
  };

  const columns: Column<ApiKey>[] = [
    { id: "name", header: t("table.name"), primary: true, cell: (k) => <span className="text-text">{k.name}</span> },
    {
      id: "key",
      header: t("table.key"),
      cell: (k) => <span className="font-mono text-[12.5px] text-text-3">{k.keyPrefix}</span>,
    },
    {
      id: "env",
      header: t("table.env"),
      cell: (k) => <Badge variant={k.environment === "live" ? "accent" : "gray"}>{k.environment}</Badge>,
    },
    {
      id: "scope",
      header: t("table.scope"),
      cell: (k) => <span className="font-mono text-[12px] text-text-2">{k.scope.replace("_", " ")}</span>,
    },
    {
      id: "lastUsed",
      header: t("table.lastUsed"),
      cell: (k) => <span className="text-[13px] text-text-4">{k.lastUsedAt ? timeAgo(k.lastUsedAt, tc) : tc("never")}</span>,
    },
    {
      id: "expires",
      header: t("table.expires"),
      cell: (k) =>
        k.expiresAt ? (
          <span className={cn("text-[13px]", daysUntil(k.expiresAt) <= 7 ? "text-warn" : "text-text-3")}>
            {daysUntil(k.expiresAt)} {tc("days")}
          </span>
        ) : (
          <span className="text-[13px] text-text-4">{tc("never")}</span>
        ),
    },
    {
      id: "actions",
      header: tc("delete"),
      action: true,
      align: "right",
      cell: (k) => (
        <Button
          variant="danger"
          size="sm"
          disabled={revokingId === k.id}
          onClick={() => handleRevoke(k.id)}
          aria-label={`${tc("delete")}: ${k.name}`}
        >
          {revokingId === k.id ? tc("revoking") : tc("delete")}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button
            variant="accent"
            onClick={() => {
              setModalOpen(true);
              setCreateError(null);
            }}
          >
            <Plus size={15} aria-hidden />
            {t("createKey")}
          </Button>
        }
      />

      {error && (
        <div role="alert" className="banner banner-danger">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-none" />
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="sm" className="-my-1.5" onClick={() => setError(null)}>
            {tc("dismiss")}
          </Button>
        </div>
      )}

      {newKey && (
        <div role="status" className="banner banner-accent dash-in flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] text-text-2">{t("keyCreated")}</span>
            <Badge variant="accent">{tc("justNow")}</Badge>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-[8px] border border-accent-border bg-bg px-3 py-2 font-mono text-[13.5px] text-accent">
              {newKey.apiKey}
            </code>
            <Button variant="secondary" size="sm" onClick={handleCopy}>
              {keyCopied ? tc("copied") : tc("copy")}
            </Button>
          </div>
          <span className="text-[12px] text-text-4">{t("keyWarning")}</span>
          <Button
            variant="ghost"
            size="sm"
            className="self-end"
            onClick={() => {
              setNewKey(null);
              setKeyCopied(false);
            }}
          >
            {tc("dismiss")}
          </Button>
        </div>
      )}

      <Card className="dash-in dash-in-1 overflow-hidden" aria-live="polite">
        {loading ? (
          <DataTableSkeleton label={t("loading")} />
        ) : keys.length === 0 ? (
          <EmptyState icon={KeyRound} title={t("noKeys")} />
        ) : (
          <DataTable columns={columns} rows={keys} rowKey={(k) => k.id} caption={t("title")} />
        )}
      </Card>

      <Card className="dash-in dash-in-2 p-5">
        <h2 className="mb-3 text-[14.5px] font-medium text-text">{t("authentication")}</h2>
        <pre tabIndex={0} className="overflow-x-auto rounded-[9px] bg-bg p-4 font-mono text-[12.5px] leading-relaxed text-text-3">
          <code>
            <span className="text-text-4">curl</span> <span className="text-text-2">-H</span>{" "}
            <span className="text-text">
              &quot;X-API-KEY: <span className="text-accent">crv_live_****...****8f3a</span>&quot;
            </span>{" "}
            <span className="text-text-3">https://api.corvo.tech/v1/invoices</span>
          </code>
        </pre>
      </Card>

      <Modal open={modalOpen} onClose={closeModal} title={t("modal.title")}>
        <form className="flex flex-col gap-5" onSubmit={handleCreate}>
          <Field label={`${t("modal.name")} ${t("modal.nameRequired")}`} hint={t("modal.maxChars")}>
            {(c) => (
              <input
                {...c}
                type="text"
                name="name"
                maxLength={100}
                required
                autoFocus
                autoComplete="off"
                placeholder={t("modal.namePlaceholder")}
                className="field"
              />
            )}
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="field-label mb-1.5">
              {t("modal.environment")} <span className="text-danger">{t("modal.nameRequired")}</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { value: "live", label: t("modal.live"), desc: t("modal.liveDesc") },
                { value: "test", label: t("modal.test"), desc: t("modal.testDesc") },
              ].map((opt) => (
                <label key={opt.value} className="choice">
                  <input type="radio" name="environment" value={opt.value} defaultChecked={opt.value === "live"} className="h-4 w-4 accent-[var(--accent)]" />
                  <span className="flex flex-col">
                    <span className="text-[13.5px] text-text">{opt.label}</span>
                    <span className="text-[12px] text-text-4">{opt.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="field-label mb-1.5">
              {t("modal.scope")} <span className="text-danger">{t("modal.nameRequired")}</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {["full_access", "invoices_issue", "invoices_view", "invoices_read_write"].map((scopeValue) => (
                <label key={scopeValue} className="choice">
                  <input type="radio" name="scope" value={scopeValue} defaultChecked={scopeValue === "full_access"} className="h-4 w-4 accent-[var(--accent)]" />
                  <span className="flex flex-col">
                    <span className="text-[13.5px] text-text">{t(`scopes.${scopeValue}.label`)}</span>
                    <span className="text-[12px] text-text-4">{t(`scopes.${scopeValue}.description`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="field-label mb-1.5">
              {t("modal.expiresAt")} <span className="font-normal text-text-4">{t("modal.optional")}</span>
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { value: "never", label: t("modal.noLimit") },
                { value: "30", label: t("modal.expires30") },
                { value: "90", label: t("modal.expires90") },
                { value: "365", label: t("modal.expires365") },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={expiresAt === opt.value}
                  onClick={() => setExpiresAt(opt.value)}
                  className={cn(
                    "choice justify-center text-[13px]",
                    expiresAt === opt.value ? "text-accent" : "text-text-3"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          {createError && (
            <div role="alert" className="banner banner-danger">
              {createError}
            </div>
          )}

          <p className="rounded-[9px] border border-danger-border bg-danger-surface px-3.5 py-3 text-[12.5px] text-danger">{t("modal.warning")}</p>

          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={closeModal}>
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="accent" loading={creating}>
              {creating ? tc("creating") : t("createKey")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
