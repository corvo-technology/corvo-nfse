"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { companies as companiesApi, schedules as schedulesApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { maskTaxId } from "@/lib/masks";
import type { InvoiceSchedule } from "@/lib/types";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DetailSkeleton } from "@/components/ui/detail-skeleton";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { formatBRL } from "@/components/pricing/plan-picker";
import { formatDay } from "@/components/schedules/schedule-list";
import { ScheduleForm } from "@/components/schedules/schedule-form";
import { ScheduleRuns } from "@/components/schedules/schedule-runs";
import { useScheduleActions } from "@/components/schedules/use-schedule-actions";

const STATUS_VARIANT: Record<InvoiceSchedule["status"], BadgeVariant> = { active: "accent", paused: "warn", completed: "gray", cancelled: "gray" };
type Body = Record<string, unknown>;
const sub = (body: Body, key: string): Body => (body[key] as Body | undefined) ?? {};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-[13px] text-text-3">{label}</dt>
      <dd className="min-w-0 break-words text-[14px] text-text">{children}</dd>
    </div>
  );
}

/** One schedule in full: who the note is for, what it says, how it repeats, and every run so far. */
export default function ScheduleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("Schedules");
  const d = useTranslations("Schedules.detail");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("nfse.invoices.issue");
  const [schedule, setSchedule] = useState<InvoiceSchedule | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [companyOptions, setCompanyOptions] = useState<{ id: string; name: string }[]>([]);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { busy, run } = useScheduleActions(setSchedule);

  useEffect(() => {
    const controller = new AbortController();
    schedulesApi
      .get(id)
      .then(async (found) => {
        if (controller.signal.aborted) return;
        setSchedule(found);
        const page = await companiesApi.list({ limit: 100 }, controller.signal).catch(() => null);
        if (controller.signal.aborted) return;
        const options = (page?.items ?? []).map((c) => ({ id: c.id, name: c.tradeName || c.legalName }));
        setCompanyOptions(options);
        setCompanyName(options.find((c) => c.id === found.companyId)?.name ?? null);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [id]);

  if (failed)
    return (
      <div className="flex flex-col gap-4">
        <p role="alert">{d("notFound")}</p>
        <Link href="/app/invoices?filter=scheduled" className="btn">{d("back")}</Link>
      </div>
    );
  if (!schedule) return <DetailSkeleton label={d("loading")} />;

  const body = schedule.invoice as Body;
  const customer = sub(body, "customer");
  const service = sub(body, "service");
  const day = (value: string) => formatDay(value, locale);
  const amount = typeof body.amount === "number" ? formatBRL(Math.round(body.amount * 100)) : "-";
  const open = schedule.status === "active" || schedule.status === "paused";
  const rowBusy = busy?.id === schedule.id;
  const sendsEmail = Boolean(sub(sub(body, "options"), "email").send);

  return (
    <div className="flex max-w-[900px] flex-col gap-6">
      <Link href="/app/invoices?filter=scheduled" className="inline-flex items-center gap-1.5 text-[13px] text-text-3 hover:text-text">
        <ArrowLeft size={14} aria-hidden />{d("back")}
      </Link>
      <PageHeader
        title={companyName ?? t("unknownCompany")}
        subtitle={`${schedule.frequency ? t(`frequency.${schedule.frequency}`) : t("kind.once")} · ${amount}`}
        actions={
          <>
            <Badge variant={STATUS_VARIANT[schedule.status]}>{t(`status.${schedule.status}`)}</Badge>
            {canManage && open && (
              <>
                {schedule.status === "active" && <Button variant="secondary" disabled={rowBusy} loading={rowBusy && busy?.action === "pause"} onClick={() => void run(schedule, "pause")}>{t("actions.pause")}</Button>}
                {schedule.status === "paused" && <Button variant="secondary" disabled={rowBusy} loading={rowBusy && busy?.action === "resume"} onClick={() => void run(schedule, "resume")}>{t("actions.resume")}</Button>}
                <Button variant="ghost" onClick={() => setEditing(true)}>{t("actions.edit")}</Button>
                <Button variant="ghost" disabled={rowBusy} onClick={() => setCancelling(true)}>{t("actions.cancel")}</Button>
              </>
            )}
          </>
        }
      />
      {schedule.status === "paused" && <p className="banner banner-warn">{schedule.pauseReason === "failures" ? t("pausedByFailures") : t("pausedByYou")}</p>}
      {schedule.status === "active" && schedule.attempts > 0 && <p className="banner banner-warn">{t("failures", { count: schedule.attempts })}</p>}

      <Card className="p-5 sm:p-6">
        <h2 className="mb-1 text-[15px] font-medium text-text">{d("note")}</h2>
        <dl className="divide-y divide-border">
          <Row label={d("company")}>{companyName ?? t("unknownCompany")}</Row>
          <Row label={d("customer")}>{String(customer.name ?? "") || t("noCustomer")}</Row>
          {Boolean(customer.taxId) && <Row label={d("taxId")}><span className="font-mono tabular-nums">{maskTaxId(String(customer.taxId))}</span></Row>}
          {Boolean(customer.email) && <Row label={d("email")}>{String(customer.email)}</Row>}
          <Row label={d("service")}>{String(service.description ?? "") || d("noService")}</Row>
          <Row label={d("amount")}><span className="tabular-nums">{amount}</span></Row>
          {typeof body.deduction === "number" && <Row label={d("deduction")}><span className="tabular-nums">{formatBRL(Math.round(body.deduction * 100))}</span></Row>}
          {typeof body.purchaseOrder === "string" && body.purchaseOrder.trim() !== "" && <Row label={d("purchaseOrder")}>{body.purchaseOrder}</Row>}
          {typeof body.notes === "string" && body.notes.trim() !== "" && <Row label={d("notes")}><span className="whitespace-pre-line">{body.notes}</span></Row>}
          <Row label={d("sendEmail")}>{sendsEmail ? d("sendYes") : d("sendNo")}</Row>
        </dl>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="mb-1 text-[15px] font-medium text-text">{d("repeat")}</h2>
        <dl className="divide-y divide-border">
          <Row label={d("kind")}>{schedule.frequency ? t(`frequency.${schedule.frequency}`) : t("kind.once")}</Row>
          <Row label={d("firstRun")}>{day(schedule.anchorOn)}</Row>
          {schedule.nextRunOn && <Row label={d("nextRun")}>{day(schedule.nextRunOn)}</Row>}
          {schedule.kind === "recurring" && <Row label={d("endsOn")}>{schedule.endsOn ? day(schedule.endsOn) : t("noEnd")}</Row>}
          {schedule.attempts > 0 && <Row label={d("attempts")}>{schedule.attempts}</Row>}
          <Row label={d("createdAt")}>{day(schedule.createdAt)}</Row>
        </dl>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-medium text-text">{d("history")}</h2>
        <ScheduleRuns scheduleId={schedule.id} />
      </section>

      {editing && <ScheduleForm key={schedule.id} open onClose={() => setEditing(false)} companies={companyOptions} schedule={schedule} onSaved={setSchedule} />}
      <Modal open={cancelling} onClose={() => setCancelling(false)} title={t("confirm.title")}>
        <p className="text-[14px] text-text-2">{t("confirm.body")}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setCancelling(false)}>{t("confirm.no")}</Button>
          <Button variant="danger" onClick={() => { setCancelling(false); void run(schedule, "cancel"); }}>{t("confirm.yes")}</Button>
        </div>
      </Modal>
    </div>
  );
}
