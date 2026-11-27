"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { integrations, type IntegrationConnection, type IntegrationEvent, type IntegrationProvider, type IntegrationSale } from "@/lib/api";
import { formatDate } from "@/lib/i18n-helpers";
import { saleStatus } from "@/lib/integrations";
import { useIntegrationErrorText } from "@/lib/use-integration-error";

type Tone = "accent" | "gray" | "warn" | "danger";
const EVENT_STATE: Record<IntegrationEvent["state"], { key: "processed" | "ignored" | "working" | "attention" | "dead" | "resolved"; tone: Tone }> = {
  processed: { key: "processed", tone: "accent" },
  ignored: { key: "ignored", tone: "gray" },
  received: { key: "working", tone: "gray" },
  processing: { key: "working", tone: "gray" },
  retry_pending: { key: "working", tone: "warn" },
  needs_attention: { key: "attention", tone: "warn" },
  dead: { key: "dead", tone: "danger" },
};

interface ConnectionInfoProps {
  connection: IntegrationConnection;
  provider?: IntegrationProvider;
  companyName: string;
}

export function ConnectionInfo({ connection, provider, companyName }: ConnectionInfoProps) {
  const t = useTranslations("Integrations");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const errorText = useIntegrationErrorText();
  const [copied, setCopied] = useState(false);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" });
  const [events, setEvents] = useState<IntegrationEvent[] | null>(null);
  const [sales, setSales] = useState<Record<string, IntegrationSale>>({});

  useEffect(() => {
    let alive = true;
    integrations.events(connection.id).then((list) => { if (alive) setEvents(list); }).catch(() => { if (alive) setEvents([]); });
    integrations.sales(connection.id, 100).then((list) => { if (alive) setSales(Object.fromEntries(list.map((sale) => [sale.id, sale]))); }).catch(() => undefined);
    return () => { alive = false; };
  }, [connection.id]);

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
        <dt className="text-text-4">{t("detail.info.company")}</dt><dd className="text-text">{companyName}</dd>
        <dt className="text-text-4">{t("detail.info.environment")}</dt><dd className="text-text">{t(`env.${connection.environment}`)}</dd>
        <dt className="text-text-4">{t("detail.info.since")}</dt><dd className="text-text">{formatDate(connection.createdAt, locale)}</dd>
      </dl>

      <div className="flex flex-col gap-1.5">
        <span className="field-label">{t("detail.webhookUrl")}</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-[10px] border border-border bg-black/20 px-3 py-2 font-mono text-[12.5px] text-text-2">{connection.webhookUrl}</code>
          <Button
            variant="secondary"
            size="sm"
            aria-label={tc("copy")}
            onClick={() => { void navigator.clipboard.writeText(connection.webhookUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
          >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied ? tc("copied") : tc("copy")}
          </Button>
        </div>
        <p className="field-hint">{t("detail.webhookUrlHint")}</p>
        {provider && (
          <details className="mt-1 text-[13.5px] text-text-3">
            <summary className="cursor-pointer text-text-2">{t("detail.info.howTo")}</summary>
            <p className="mt-1.5">{provider.webhookInstructions[locale === "pt" ? "pt" : "en"]}</p>
          </details>
        )}
      </div>

      <section aria-labelledby="events-title" className="flex flex-col gap-2">
        <h3 id="events-title" className="text-[14px] font-medium text-text">{t("detail.info.eventsTitle")}</h3>
        {events === null ? (
          <p className="text-[13px] text-text-4">{tc("loading")}</p>
        ) : events.length === 0 ? (
          <p className="text-[13.5px] text-text-3">{t("detail.info.eventsEmpty")} {t("detail.info.eventsHint")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-[12px] border border-border">
            {events.map((event) => {
              const sale = event.operationId ? sales[event.operationId] : undefined;
              const saleState = sale ? saleStatus(sale) : null;
              // An old notice that failed is not a problem once its sale was issued by another one.
              const resolved = event.state === "needs_attention" && saleState?.key === "issued";
              // A notice that could not even be read has no sale to complete: nothing can be done with it, so it is shown as set aside.
              const unusable = event.externalType === "unparseable";
              const s = resolved ? EVENT_STATE.processed : unusable ? EVENT_STATE.ignored : EVENT_STATE[event.state];
              const repeated = Boolean(event.operationId) && events.some((other) => other.operationId === event.operationId && new Date(other.createdAt) < new Date(event.createdAt));
              return (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12.5px] text-text-2">{event.externalType}</p>
                    <p className="text-[12.5px] text-text-4">{new Date(event.createdAt).toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}</p>
                    {sale && saleState && (
                      <p className="text-[12.5px] text-text-3">{sale.customer?.name || t("detail.sales.anonymous")} · {money.format(sale.amountCents / 100)} · {t(`detail.sale.${saleState.key}`)}</p>
                    )}
                    {repeated && <p className="text-[12.5px] text-text-4">{t("detail.info.eventRepeated")}</p>}
                    {event.lastError && !resolved && <p className="mt-0.5 text-[12.5px] text-warn">{errorText(event.lastError)}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={s.tone}>{t(`detail.info.event.${resolved ? "resolved" : s.key}`)}</Badge>
                    {event.operationId && saleState?.canResolve && <Link href={`/app/integrations/sales/${event.operationId}`} className="btn btn-accent btn-sm">{t("resolveAction")}</Link>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
