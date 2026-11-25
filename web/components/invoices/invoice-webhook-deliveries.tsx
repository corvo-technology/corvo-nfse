"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { webhooks, type WebhookDelivery } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/i18n-helpers";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** The 30 days the API looks back at most. */
const HOURS = 720;
const TONE: Record<string, string> = { sent: "text-accent", pending: "text-text-4", delayed: "text-warn", failed: "text-danger", manual_retry: "text-info" };

/** Event and status names in plain words; an event this screen does not know is shown as it is. */
export function useDeliveryLabels() {
  const t = useTranslations("Webhooks");
  return {
    event: (type: string) => (t.has(`events.${type}.label`) ? t(`events.${type}.label`) : type),
    status: (status: string) => (t.has(`deliveryStatus.${status}`) ? t(`deliveryStatus.${status}`) : status),
  };
}

/** What Corvo told the customer's system about one invoice, with a button to send it again. */
export function InvoiceWebhookDeliveries({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("InvoiceWebhooks");
  const tc = useTranslations("Common");
  const { can, fiscalEnvironment: environment } = useAuth();
  const apiError = useApiErrorText();
  const labels = useDeliveryLabels();
  const [rows, setRows] = useState<WebhookDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const allowed = can("webhooks.view");

  const load = useCallback(async () => {
    try {
      const page = await webhooks.deliveries({ invoice_id: invoiceId, hours: HOURS, limit: 50, environment });
      setRows(page.items);
      setError(null);
    } catch (cause) {
      setError(apiError(cause, t("failed")));
    }
    // apiError is a new function on every render; depending on it would reload forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, environment, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (allowed) void load();
  }, [allowed, load]);

  async function retry(id: string) {
    setRetrying(id);
    setNotice(null);
    try {
      await webhooks.retryDelivery(id);
      setNotice(t("retried"));
      await load();
    } catch (cause) {
      setError(apiError(cause, t("retryFailed")));
    } finally {
      setRetrying(null);
    }
  }

  if (!allowed) return null;
  return (
    <Card className="flex flex-col gap-4 p-5" aria-busy={rows === null && !error}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-medium">{t("title")}</h2>
          <p className="text-sm text-text-3">{t("hint")}</p>
        </div>
        <Link href="/app/webhooks" className="text-[13px] text-accent">{t("seeAll")}</Link>
      </div>
      {notice && <p role="status" className="banner">{notice}</p>}
      {error && <p role="alert" className="banner banner-danger">{error}</p>}
      {!error && rows === null && <p role="status" className="text-sm text-text-3">{t("loading")}</p>}
      {rows !== null && rows.length === 0 && <p className="text-sm text-text-3">{t("empty")}</p>}
      {rows !== null && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-text">{labels.event(d.eventType)}</p>
                <p className="text-[12.5px] text-text-4">
                  <time dateTime={d.createdAt} title={new Date(d.createdAt).toLocaleString()}>{timeAgo(d.createdAt, tc)}</time>
                </p>
              </div>
              <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]">
                <div className="flex gap-1.5"><dt className="sr-only">{t("status")}</dt><dd className={TONE[d.status] ?? "text-text-4"}>{labels.status(d.status)}</dd></div>
                <div className="flex gap-1.5"><dt className="text-text-4">{t("code")}</dt><dd className="font-mono text-text-3">{d.statusCode || "—"}</dd></div>
                <div className="flex gap-1.5"><dt className="text-text-4">{t("attempts")}</dt><dd className="font-mono text-text-3">{d.retryCount}</dd></div>
              </dl>
              {can("webhooks.manage") && (d.status === "failed" || d.status === "delayed") && (
                <Button variant="secondary" size="sm" onClick={() => void retry(d.id)} loading={retrying === d.id}>{t("retry")}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
