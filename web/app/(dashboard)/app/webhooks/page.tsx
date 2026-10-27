"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Plus, Webhook as WebhookIcon } from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { webhooks, collectAll, type WebhookEndpoint, type WebhookDelivery } from "@/lib/api";
import { WEBHOOK_EVENT_OPTIONS, type WebhookEvent } from "@/lib/types";
import { timeAgo } from "@/lib/i18n-helpers";

const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatusDot({ ok }: { ok: boolean }) {
  return <span aria-hidden className={`inline-block h-2 w-2 flex-none rounded-full ${ok ? "bg-ok" : "bg-danger"}`} />;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function WebhooksPage() {
  const t = useTranslations("Webhooks");
  const { can, fiscalEnvironment: envFilter } = useAuth();
  const tc = useTranslations("Common");
  const { success, error: toastError } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<WebhookEvent[]>([]);

  /* Data state */
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [deliveryCursor, setDeliveryCursor] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Form state */
  const [url, setUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /* Secret shown once after creation */
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  /* Action states */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [retryingId, setRetryingId] = useState<string | null>(null);

  /* Event groups (computed with translations) */
  const eventGroups = [{ label: t("eventGroups.nfse"), events: WEBHOOK_EVENT_OPTIONS }];

  /* ---- Fetch webhooks + deliveries ---- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [whData, delData] = await Promise.all([
        collectAll((cursor) => webhooks.list({ cursor, limit: 1000 })),
        webhooks.deliveries({ hours: 24, limit: 50, environment: envFilter }),
      ]);

      setEndpoints(whData);
      setDeliveries(delData.items);
      setDeliveryCursor(delData.hasMore ? delData.nextCursor : null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [envFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const loadMoreDeliveries = async () => {
    if (!deliveryCursor || moreLoading) return;
    setMoreLoading(true);
    try {
      // `hours` is fixed server-side across pages; keep the same filters.
      const next = await webhooks.deliveries({ hours: 24, limit: 50, environment: envFilter, cursor: deliveryCursor });
      setDeliveries((rows) => [...rows, ...next.items]);
      setDeliveryCursor(next.hasMore ? next.nextCursor : null);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Unknown error"); }
    finally { setMoreLoading(false); }
  };

  /* ---- Create webhook ---- */
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || selectedEvents.length === 0) return;

    setCreating(true);
    setCreateError(null);
    try {
      const created = await webhooks.create({
        url: url.trim(),
        events: selectedEvents,
      });
      if (posthogConfigured) {
        posthog.capture("webhook_endpoint_created", {
          event_types: selectedEvents,
          event_type_count: selectedEvents.length,
        });
      }

      /* Show the secret only once */
      if (created.secret) {
        setCreatedSecret(created.secret);
        setCreatedWebhookUrl(created.url);
      }

      setUrl("");
      setSelectedEvents([]);
      setModalOpen(false);
      fetchData();
      success(t("toasts.created"));
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  };

  /* ---- Delete webhook ---- */
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await webhooks.delete(id);
      if (posthogConfigured) posthog.capture("webhook_endpoint_deleted");
      fetchData();
      success(t("toasts.deleted"));
    } catch (err: unknown) {
      toastError(err instanceof Error ? err.message : t("toasts.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  /* ---- Test webhook ---- */
  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await webhooks.test(id);
      if (result.sent) {
        if (posthogConfigured) posthog.capture("webhook_test_sent");
        success(t("toasts.testSent"));
      } else toastError(result.statusCode ? t("toasts.testFailedStatus", { status: result.statusCode }) : t("toasts.testFailed"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("toasts.testFailed");
      toastError(msg);
    } finally {
      setTestingId(null);
    }
  };

  /* ---- Retry delivery ---- */
  const handleRetry = async (id: string) => {
    setRetryingId(id);
    try {
      await webhooks.retryDelivery(id);
      if (posthogConfigured) posthog.capture("webhook_delivery_retried");
      fetchData();
      success(t("toasts.retrySuccess"));
    } catch (err: unknown) {
      toastError(err instanceof Error ? err.message : t("toasts.retryFailed"));
    } finally {
      setRetryingId(null);
    }
  };

  /* ---- Toggle event selection ---- */
  const toggleEvent = (event: WebhookEvent) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const openModal = () => {
    setUrl("");
    setSelectedEvents([]);
    setCreateError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setCreateError(null);
  };

  const deliveryColor: Record<string, string> = {
    sent: "text-accent",
    pending: "text-text-4",
    delayed: "text-warn",
    failed: "text-danger",
    manual_retry: "text-info",
  };

  const deliveryColumns: Column<WebhookDelivery>[] = [
    { id: "event", header: t("table.event"), primary: true, cell: (d) => <span className="text-text">{d.eventType}</span> },
    {
      id: "dest",
      header: t("table.destination"),
      cell: (d) => <span className="block max-w-[240px] truncate font-mono text-[12.5px] text-text-3">{d.url}</span>,
    },
    {
      id: "code",
      header: t("table.code"),
      cell: (d) => <span className={cn("font-mono text-[12.5px]", deliveryColor[d.status] ?? "text-text-4")}>{d.statusCode || "\u2014"}</span>,
    },
    {
      id: "status",
      header: t("table.status"),
      cell: (d) => <span className={cn("font-mono text-[12px]", deliveryColor[d.status] ?? "text-text-4")}>{d.status}</span>,
    },
    {
      id: "duration",
      header: t("table.duration"),
      hideOnMobile: true,
      cell: (d) => <span className="font-mono text-[12.5px] text-text-3">{d.durationMs != null ? `${d.durationMs}ms` : "\u2014"}</span>,
    },
    { id: "age", header: t("table.age"), cell: (d) => <span className="text-[12.5px] text-text-4">{timeAgo(d.createdAt, tc)}</span> },
    {
      id: "retry",
      header: tc("retry"),
      action: true,
      align: "right",
      cell: (d) =>
        d.status === "failed" || d.status === "delayed" ? (
          <Button variant="secondary" size="sm" onClick={() => handleRetry(d.id)} loading={retryingId === d.id}>
            {tc("retry")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button variant="accent" onClick={openModal}>
            <Plus size={15} aria-hidden />
            {t("newEndpoint")}
          </Button>
        }
      />

      {createdSecret && createdWebhookUrl && (
        <div role="status" className="banner banner-accent dash-in flex-col">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13.5px] font-medium text-accent">{t("secretBanner.generated")}</span>
            <span className="break-all text-[12px] text-text-3">{t("secretBanner.for", { url: createdWebhookUrl })}</span>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-[8px] border border-accent-border bg-bg px-3 py-2 font-mono text-[13px] text-text">
              {createdSecret}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(createdSecret);
                setSecretCopied(true);
                setTimeout(() => setSecretCopied(false), 2000);
              }}
            >
              {secretCopied ? tc("copied") : tc("copy")}
            </Button>
          </div>
          <span className="text-[12px] text-text-4">{t("secretBanner.warning")}</span>
          <Button
            variant="ghost"
            size="sm"
            className="self-end"
            onClick={() => {
              setCreatedSecret(null);
              setCreatedWebhookUrl(null);
              setSecretCopied(false);
            }}
          >
            {tc("dismiss")}
          </Button>
        </div>
      )}

      {/* Endpoints */}
      <section aria-label={t("title")} className="dash-in dash-in-1 flex flex-col gap-3" aria-busy={loading}>
        {loading ? (
          <>
            <Skeleton className="h-[150px] rounded-[12px]" />
            <span className="sr-only" role="status">{tc("loading")}</span>
          </>
        ) : error ? (
          <Card>
            <EmptyState
              tone="danger"
              icon={AlertTriangle}
              title={error}
              action={
                <Button variant="secondary" size="sm" onClick={fetchData}>
                  {tc("retry")}
                </Button>
              }
            />
          </Card>
        ) : endpoints.length === 0 ? (
          <Card>
            <EmptyState icon={WebhookIcon} title={t("noEndpoints")} />
          </Card>
        ) : (
          endpoints.map((ep) => {
            return (
              <Card key={ep.id} className="flex flex-col gap-4 p-4 sm:p-5">
                <div className="flex items-start gap-2.5">
                  <span className="mt-[7px]"><StatusDot ok={ep.active} /></span>
                  <span className="min-w-0 break-all font-mono text-[14px] text-text">{ep.url}</span>
                </div>

                <ul className="flex flex-wrap gap-1.5" aria-label={t("modal.eventsLabel")}>
                  {ep.events.map((ev) => (
                    <li key={ev} className="rounded-[6px] border border-border-strong px-2 py-1 font-mono text-[11.5px] text-text-2">
                      {ev}
                    </li>
                  ))}
                </ul>

                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button variant="ghost" size="sm" onClick={() => handleTest(ep.id)} loading={testingId === ep.id}>
                      {testingId === ep.id ? tc("sending") : t("sendTestEvent")}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(ep.id)}
                      disabled={!can("webhooks.manage") || deletingId === ep.id}
                      aria-label={`${tc("delete")}: ${ep.url}`}
                    >
                      {deletingId === ep.id ? tc("deleting") : tc("delete")}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </section>

      {/* Deliveries */}
      <Card className="dash-in dash-in-2 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-4 sm:px-5">
          <h2 className="text-[14.5px] font-medium text-text">{t("recentDeliveries")}</h2>
          <span className="font-mono text-[11.5px] text-text-4">{t("last24h")}</span>
        </div>
        <div className="border-t border-border" aria-live="polite">
          {deliveries.length === 0 ? (
            <EmptyState icon={WebhookIcon} title={t("noDeliveries")} className="py-10" />
          ) : (
            <DataTable columns={deliveryColumns} rows={deliveries} rowKey={(d) => d.id} caption={t("recentDeliveries")} />
          )}
        </div>
        {deliveryCursor && <div className="border-t border-border p-3"><Button variant="secondary" size="sm" loading={moreLoading} onClick={() => void loadMoreDeliveries()}>{tc("loadMore")}</Button></div>}
      </Card>

      <Modal open={modalOpen} onClose={closeModal} title={t("modal.title")} wide>
        <form className="flex flex-col gap-5" onSubmit={handleCreate}>
          <Field label={t("modal.url")}>
            {(c) => (
              <input
                {...c}
                type="url"
                inputMode="url"
                autoFocus
                autoComplete="off"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("modal.urlPlaceholder")}
                required
                className="field font-mono"
              />
            )}
          </Field>

          <div className="flex flex-col gap-4">
            <p className="eyebrow">{t("modal.eventsLabel")}</p>
            {eventGroups.map((group) => (
              <fieldset key={group.label} className="flex flex-col gap-2">
                <legend className="eyebrow mb-2 text-text-5">{group.label}</legend>
                {group.events.map((option) => {
                  const selected = selectedEvents.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleEvent(option.value)}
                      aria-pressed={selected}
                      className="choice w-full flex-col items-stretch gap-0.5 text-left"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className={cn("text-[13.5px]", selected ? "text-accent" : "text-text")}>
                          {t(`events.${option.value}.label`)}
                        </span>
                        <span className="hidden flex-none font-mono text-[11px] text-text-4 sm:inline">{option.value}</span>
                      </span>
                      <span className="text-[12px] text-text-4">{t(`events.${option.value}.description`)}</span>
                    </button>
                  );
                })}
              </fieldset>
            ))}
          </div>

          <p className="rounded-[9px] border border-border bg-bg px-3.5 py-3 font-mono text-[12px] text-text-4">
            {t("modal.signingSecretInfo")}
          </p>

          {createError && (
            <div role="alert" className="banner banner-danger">
              {createError}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={closeModal}>
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="accent" loading={creating} disabled={!url.trim() || selectedEvents.length === 0}>
              {creating ? tc("creating") : t("modal.createEndpoint")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
