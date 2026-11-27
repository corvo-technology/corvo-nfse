"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SvcContingency } from "@/components/admin/svc-contingency";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useBillingEnabled } from "@/lib/deployment-config-context";
import { formatDate } from "@/lib/i18n-helpers";
import { formatBrl, platformAdmin, type PlatformOverview, type PlatformWindow } from "@/lib/platform-admin";
import { useApiErrorText } from "@/lib/use-api-error";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-text">{title}</h2>
        <div className="mt-4">{children}</div>
      </Card>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] text-text-3">{label}</p>
      <p className="mt-0.5 text-[22px] font-semibold tabular-nums text-text">{value}</p>
    </div>
  );
}

/** Platform owner's overview: users, invoices (production and test apart) and, with billing on, revenue. */
export default function AdminOverviewPage() {
  const t = useTranslations("Admin.overview");
  const tc = useTranslations("Admin.common");
  const ts = useTranslations("Admin.svc");
  const locale = useLocale();
  const apiError = useApiErrorText();
  const billingEnabled = useBillingEnabled();
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    platformAdmin.overview(controller.signal)
      .then((overview) => { setData(overview); setError(null); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(apiError(cause, tc("loadFailed"))); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const rate = (value: number | null) =>
    value === null ? "—" : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(value);

  const windows = (rows: { label: string; win: PlatformWindow }[]) => (
    <div className="grid gap-5 sm:grid-cols-3">
      {rows.map(({ label, win }) => (
        <div key={label} className="space-y-3">
          <h3 className="text-[13px] font-medium text-text-2">{label}</h3>
          <Stat label={t("authorized")} value={number(win.authorized)} />
          <Stat label={t("rejected")} value={number(win.rejected)} />
          <Stat label={t("rejectionRate")} value={rate(win.rejectionRate)} />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      {!error && !data && <p className="text-[14px] text-text-3">…</p>}
      {data && (
        <>
          <Section title={t("users")}>
            <div className="grid gap-5 sm:grid-cols-3">
              <Stat label={t("usersTotal")} value={number(data.users.total)} />
              <Stat label={t("usersNew7d")} value={number(data.users.new7d)} />
              <Stat label={t("usersNew30d")} value={number(data.users.new30d)} />
            </div>
          </Section>

          <Section title={ts("title")}>
            <SvcContingency />
          </Section>

          {(["live", "test"] as const).map((env) => (
            <Section key={env} title={env === "live" ? t("invoicesLive") : t("invoicesTest")}>
              {windows([
                { label: t("today"), win: data.invoices[env].today },
                { label: t("last7d"), win: data.invoices[env].d7 },
                { label: t("last30d"), win: data.invoices[env].d30 },
              ])}
            </Section>
          ))}

          {billingEnabled && (
            <>
              <Section title={t("revenue")}>
                <div className="grid gap-5 sm:grid-cols-2">
                  {([["last7d", data.revenue.d7], ["last30d", data.revenue.d30]] as const).map(([key, rev]) => (
                    <div key={key} className="space-y-3">
                      <h3 className="text-[13px] font-medium text-text-2">{t(key)}</h3>
                      <Stat label={t("revenueSubscription")} value={formatBrl(rev.subscriptionCents, locale)} />
                      <Stat label={t("revenueAvulso")} value={formatBrl(rev.avulsoCents, locale)} />
                      <Stat label={t("revenueTotal")} value={formatBrl(rev.totalCents, locale)} />
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-[13px] text-text-3">
                  {data.revenue.stripeRecordedSince
                    ? t("revenueNote", { date: formatDate(data.revenue.stripeRecordedSince, locale) })
                    : t("revenueNoteNone")}
                </p>
              </Section>

              <Section title={t("adminGrants")}>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Stat label={t("last7d")} value={t("units", { count: data.adminGrants.units7d })} />
                  <Stat label={t("last30d")} value={t("units", { count: data.adminGrants.units30d })} />
                </div>
                <p className="mt-4 text-[13px] text-text-3">{t("adminGrantsNote")}</p>
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}
