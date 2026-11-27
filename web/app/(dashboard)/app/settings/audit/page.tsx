"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ScrollText } from "lucide-react";
import { AuditList } from "@/components/settings/audit-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTableSkeleton } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { auditEvents } from "@/lib/api";
import type { AuditActorFilter, AuditEvent } from "@/lib/audit";
import { Select } from "@/components/ui/select";

const PERIOD_DAYS = { d7: 7, d30: 30, y1: 365 } as const;
type Period = keyof typeof PERIOD_DAYS;
const WHO: AuditActorFilter[] = ["all", "user", "agent", "api_key", "system"];
const PAGE_SIZE = 50;

export default function AuditPage() {
  const t = useTranslations("Audit");
  const [who, setWho] = useState<AuditActorFilter>("all");
  const [period, setPeriod] = useState<Period>("d30");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const fetchPage = useCallback((after?: string) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const from = new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000).toISOString();
    // A request that was cancelled (a newer one replaced it) resolves to null instead of failing,
    // so only the request still in charge can show the error.
    return auditEvents
      .list({ ...(who !== "all" ? { actorType: who } : {}), from, limit: PAGE_SIZE, ...(after ? { cursor: after } : {}) }, abort.signal)
      .then(
        (page) => (abort.signal.aborted ? null : page),
        (error: unknown) => {
          if (abort.signal.aborted) return null;
          throw error;
        },
      );
  }, [who, period]);

  useEffect(() => {
    fetchPage()
      .then((page) => {
        if (!page) return;
        setEvents(page.items);
        setCursor(page.hasMore ? page.nextCursor : null);
        setFailed(false);
        setLoading(false);
      })
      .catch(() => {
        setEvents([]);
        setCursor(null);
        setFailed(true);
        setLoading(false);
      });
    return () => controller.current?.abort();
  }, [fetchPage]);

  // A new filter starts a fresh load: show the skeleton right away, then the effect above fetches.
  const restart = () => { setLoading(true); setFailed(false); };
  const changeWho = (value: AuditActorFilter) => { restart(); setWho(value); };
  const changePeriod = (value: Period) => { restart(); setPeriod(value); };

  const loadMore = () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    fetchPage(cursor)
      .then((page) => {
        if (!page) return;
        setEvents((previous) => [...previous, ...page.items]);
        setCursor(page.hasMore ? page.nextCursor : null);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoadingMore(false));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="dash-in flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5 text-[12.5px] text-text-3">
          {t("filters.who")}
          <Select value={who} onChange={(event) => changeWho(event.target.value as AuditActorFilter)}>
            {WHO.map((value) => <option key={value} value={value}>{t(`filters.${value}`)}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-[12.5px] text-text-3">
          {t("filters.period")}
          <Select value={period} onChange={(event) => changePeriod(event.target.value as Period)}>
            {(Object.keys(PERIOD_DAYS) as Period[]).map((value) => <option key={value} value={value}>{t(`filters.${value}`)}</option>)}
          </Select>
        </label>
      </div>

      <Card className="dash-in dash-in-1 overflow-hidden" aria-live="polite">
        {loading ? (
          <DataTableSkeleton label={t("loading")} />
        ) : failed && events.length === 0 ? (
          <EmptyState icon={AlertTriangle} tone="danger" title={t("error")} />
        ) : events.length === 0 ? (
          <EmptyState icon={ScrollText} title={t("empty")} />
        ) : (
          <AuditList events={events} />
        )}
      </Card>

      {failed && events.length > 0 && (
        <div role="alert" className="banner banner-danger">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-none" />
          <span className="text-[13.5px]">{t("error")}</span>
        </div>
      )}

      {cursor && (
        <Button variant="ghost" className="self-center" onClick={loadMore} disabled={loadingMore}>
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}
