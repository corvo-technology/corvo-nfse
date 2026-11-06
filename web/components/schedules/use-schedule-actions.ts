"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { schedules as schedulesApi } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-errors";
import type { InvoiceSchedule } from "@/lib/types";
import { useToast } from "@/components/ui/toast";
import type { ScheduleAction } from "@/components/schedules/schedule-list";

/** Pause, resume and cancel with one request at a time, a toast for the outcome and the new schedule handed back. */
export function useScheduleActions(onChange: (schedule: InvoiceSchedule) => void) {
  const t = useTranslations("Schedules");
  const te = useTranslations("ApiErrors");
  const { success, error: toastError } = useToast();
  const [busy, setBusy] = useState<{ id: string; action: ScheduleAction } | null>(null);
  const run = async (schedule: InvoiceSchedule, action: ScheduleAction) => {
    if (busy) return;
    setBusy({ id: schedule.id, action });
    try {
      onChange(await schedulesApi[action](schedule.id));
      success(t(`toast.${action === "pause" ? "paused" : action === "resume" ? "resumed" : "cancelled"}`));
    } catch (cause) {
      toastError(apiErrorMessage(cause, te.has, te, t("toast.failed")));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}
