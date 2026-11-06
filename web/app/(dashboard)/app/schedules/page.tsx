"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApiError, companies as companiesApi, schedules as schedulesApi } from "@/lib/api";
import type { InvoiceSchedule } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ScheduleList, type ScheduleAction } from "@/components/schedules/schedule-list";
import { ScheduleForm } from "@/components/schedules/schedule-form";
import { ScheduleRuns } from "@/components/schedules/schedule-runs";

export default function SchedulesPage() {
  const t = useTranslations("Schedules");
  const tc = useTranslations("Common");
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const canManage = can("nfse.invoices.issue");
  const [items, setItems] = useState<InvoiceSchedule[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<{ id: string; action: ScheduleAction } | null>(null);
  const [cancelling, setCancelling] = useState<InvoiceSchedule | null>(null);
  const [form, setForm] = useState<{ schedule?: InvoiceSchedule } | null>(null);
  const [history, setHistory] = useState<string | null>(null);

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

  const run = async (schedule: InvoiceSchedule, action: ScheduleAction) => {
    if (busy) return;
    setBusy({ id: schedule.id, action });
    try {
      replace(await schedulesApi[action](schedule.id));
      success(t(`toast.${action === "pause" ? "paused" : action === "resume" ? "resumed" : "cancelled"}`));
    } catch (cause) {
      toastError(cause instanceof ApiError && cause.status < 500 && cause.status > 0 ? cause.message : t("toast.failed"));
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <PageHeader
      title={t("title")}
      subtitle={t("subtitle")}
      actions={canManage && items ? <Button variant="accent" onClick={() => setForm({})}><Plus size={15} aria-hidden />{t("new")}</Button> : undefined}
    />
  );

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
    <div className="flex max-w-[1000px] flex-col gap-6">
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
              <Button variant="ghost" aria-expanded={history === s.id} onClick={() => setHistory(history === s.id ? null : s.id)}>{t("actions.history")}</Button>
            </>
          )}
          renderBelow={(s) => (history === s.id ? <div className="mt-3"><ScheduleRuns scheduleId={s.id} /></div> : null)}
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
