"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";
import { companies as companiesApi, schedules as schedulesApi } from "@/lib/api";
import type { InvoiceSchedule } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { ScheduleList } from "@/components/schedules/schedule-list";
import { ScheduleForm } from "@/components/schedules/schedule-form";
import { useScheduleActions } from "@/components/schedules/use-schedule-actions";

/** The recurring and scheduled notes: what will run, when, and the controls (shown under the "Agendadas" filter of the notes list). */
export function SchedulePanel() {
  const t = useTranslations("Schedules");
  const tc = useTranslations("Common");
  const { can } = useAuth();
  const canManage = can("nfse.invoices.issue");
  const [items, setItems] = useState<InvoiceSchedule[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [cancelling, setCancelling] = useState<InvoiceSchedule | null>(null);
  const [form, setForm] = useState<{ schedule?: InvoiceSchedule } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([schedulesApi.list({ limit: 200 }, controller.signal), companiesApi.list({ limit: 100 }, controller.signal).catch(() => null)])
      .then(([schedules, companies]) => {
        if (controller.signal.aborted) return;
        setItems(schedules.items);
        setNames(Object.fromEntries((companies?.items ?? []).map((c) => [c.id, c.tradeName || c.legalName])));
        setFailed(false);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);

  const replace = useCallback((next: InvoiceSchedule) => setItems((rows) => (rows ?? []).map((row) => (row.id === next.id ? next : row))), []);

  const { busy, run } = useScheduleActions(replace);

  const header = <p className="text-[13px] text-text-3">{t("subtitle")}</p>;

  if (failed)
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card><EmptyState tone="danger" icon={AlertTriangle} title={t("loadFailed")} /></Card>
      </div>
    );
  if (!items)
    return (
      <div className="flex flex-col gap-6" role="status" aria-busy="true" aria-label={tc("loading")}>
        {header}
        <Skeleton className="h-[120px] rounded-[12px]" />
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {header}
      {items.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title={t("empty.title")} description={t("empty.body")} /></Card>
      ) : (
        <ScheduleList
          schedules={items}
          companyNames={names}
          canManage={canManage}
          busy={busy}
          onAction={(s, action) => (action === "cancel" ? setCancelling(s) : void run(s, action))}
          renderExtra={(s) => (
            <>
              {canManage && (s.status === "active" || s.status === "paused") && <Button variant="ghost" onClick={() => setForm({ schedule: s })}>{t("actions.edit")}</Button>}
              <Link href={`/app/schedules/${s.id}`} className="btn btn-ghost">{t("actions.details")}</Link>
            </>
          )}
        />
      )}
      {form && (
        <ScheduleForm
          key={form.schedule?.id ?? "new"}
          open
          onClose={() => setForm(null)}
          companies={Object.entries(names).map(([id, name]) => ({ id, name }))}
          schedule={form.schedule}
          onSaved={(saved) => setItems((rows) => (form.schedule ? (rows ?? []).map((row) => (row.id === saved.id ? saved : row)) : [saved, ...(rows ?? [])]))}
        />
      )}
      <Modal open={cancelling !== null} onClose={() => setCancelling(null)} title={t("confirm.title")}>
        <p className="text-[14px] text-text-2">{t("confirm.body")}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setCancelling(null)}>{t("confirm.no")}</Button>
          <Button variant="danger" onClick={() => { const target = cancelling; setCancelling(null); if (target) void run(target, "cancel"); }}>{t("confirm.yes")}</Button>
        </div>
      </Modal>
    </div>
  );
}
