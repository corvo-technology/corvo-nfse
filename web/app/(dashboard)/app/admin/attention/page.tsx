"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useBillingEnabled } from "@/lib/deployment-config-context";
import { formatDate } from "@/lib/i18n-helpers";
import { platformAdmin, type PlatformAttention } from "@/lib/platform-admin";

interface Item { key: string; userId: string; title: string; detail: string }

function Section({ title, items, emptyText }: { title: string; items: Item[]; emptyText: string }) {
  const tc = useTranslations("Admin.common");
  return (
    <Card className="overflow-hidden">
      <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold text-text">{title}</h2>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-[13.5px] text-text-3">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-[13.5px]">
              <div className="min-w-0">
                <p className="truncate font-medium text-text">{item.title}</p>
                <p className="text-text-3">{item.detail}</p>
              </div>
              <Link href={`/app/admin/users/${item.userId}`} className="flex-none text-accent underline-offset-2 hover:underline">
                {tc("openUser")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AdminAttentionPage() {
  const t = useTranslations("Admin.attention");
  const tc = useTranslations("Admin.common");
  const locale = useLocale();
  const billingEnabled = useBillingEnabled();
  const [data, setData] = useState<PlatformAttention | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    platformAdmin.attention(controller.signal).then(setData, () => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);

  const date = (value: string) => formatDate(value, locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} />
      {failed ? (
        <EmptyState tone="danger" title={tc("loadFailed")} />
      ) : !data ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-24" /><Skeleton className="h-24" />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Section
            title={t("staleInvoices")}
            emptyText={t("emptySection")}
            items={data.staleInvoices.map((i) => ({ key: i.invoiceId, userId: i.userId, title: `${i.invoiceId} · ${i.status}`, detail: t("since", { date: date(i.updatedAt) }) }))}
          />
          <Section
            title={t("expiringCertificates")}
            emptyText={t("emptySection")}
            items={data.expiringCertificates.map((i) => ({ key: i.companyId, userId: i.userId, title: i.taxId, detail: t("validUntil", { date: date(i.validUntil) }) }))}
          />
          <Section
            title={t("failingWebhooks")}
            emptyText={t("emptySection")}
            items={data.failingWebhooks.map((i) => ({ key: i.tenantId, userId: i.userId, title: t("failedCount", { count: i.failedCount24h }), detail: t("since", { date: date(i.lastFailureAt) }) }))}
          />
          {billingEnabled && (
            <Section
              title={t("failedPayments")}
              emptyText={t("emptySection")}
              items={data.failedPayments.map((i) => ({
                key: `${i.tenantId}-${i.source}-${i.at}`, userId: i.userId,
                title: `${i.source === "intent" ? t("sourceIntent") : t("sourceSubscription")} · ${i.status}`,
                detail: t("since", { date: date(i.at) }),
              }))}
            />
          )}
        </div>
      )}
    </div>
  );
}
