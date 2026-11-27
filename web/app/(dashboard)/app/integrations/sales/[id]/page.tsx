"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DetailSkeleton } from "@/components/ui/detail-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { SaleResolveForm } from "@/components/dashboard/integrations/sale-resolve-form";
import { integrations, type IntegrationProvider, type IntegrationSaleDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { saleStatus } from "@/lib/integrations";
import { useIntegrationErrorText, useReasonAction } from "@/lib/use-integration-error";

export default function IntegrationSalePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("Integrations");
  const tr = useTranslations("Integrations.resolve");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const { can } = useAuth();
  const errorText = useIntegrationErrorText();
  const actionText = useReasonAction();
  const canManage = can("integrations.manage");

  const [sale, setSale] = useState<IntegrationSaleDetail | null>(null);
  const [provider, setProvider] = useState<IntegrationProvider | undefined>();
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [found, providers] = await Promise.all([integrations.sale(id), integrations.providers()]);
      setSale(found);
      setProvider(providers.find((p) => p.id === found.provider));
    } catch {
      setFailed(true);
    }
  }, [id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  if (failed) return <div className="flex flex-col gap-4"><p role="alert">{tr("notFound")}</p><Button onClick={() => void load()}>{t("retry")}</Button></div>;
  if (!sale || sale.id !== id) return <DetailSkeleton label={tc("loading")} />;

  const status = saleStatus(sale);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(sale.amountCents / 100);
  const when = new Date(sale.paidAt ?? sale.createdAt).toLocaleString(locale === "pt" ? "pt-BR" : "en-US", { dateStyle: "short", timeStyle: "short" });
  const reason = errorText(sale.blockReason);
  const action = actionText(sale.blockReason);
  // The rejection text (what the invoice rules said) explains an "invoice refused" better than the generic sentence.
  const detail = sale.blockReason === "invoice_rejected" ? errorText(sale.lastError) : "";

  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      <Link href="/app/invoices?filter=sales" className="text-[13.5px] text-text-3 hover:text-text">← {tr("back")}</Link>
      <PageHeader
        title={`${tr("title")} · ${money}`}
        subtitle={`${provider?.name ?? sale.provider ?? ""} · ${when}`}
        actions={<Badge variant={status.tone}>{t(`detail.sale.${status.key}`)}</Badge>}
      />

      {reason && (
        <Card className="flex flex-col gap-1.5 border-warn p-5" role="status">
          <p className="text-[12.5px] uppercase tracking-wide text-text-4">{t("reasonLabel")}</p>
          <p className="text-[15px] text-text">{reason}</p>
          {detail && <p className="text-[13.5px] text-warn">{detail}</p>}
          {action && <p className="text-[13.5px] text-text-3"><strong className="font-medium text-text-2">{t("whatToDo")}:</strong> {action}</p>}
        </Card>
      )}

      <Card className="p-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
          <dt className="text-text-4">{tr("amount")}</dt><dd className="text-text">{money}</dd>
          <dt className="text-text-4">{tr("paidAt")}</dt><dd className="text-text">{when}</dd>
          <dt className="text-text-4">{tr("source")}</dt><dd className="text-text">{t("pendingSales.origin", { provider: provider?.name ?? sale.provider ?? "" })}</dd>
        </dl>
      </Card>

      {sale.invoiceId ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-[14px] text-text">{tr("alreadyIssued")}</p>
          <Link href={`/app/invoices/${sale.invoiceId}`} className="btn btn-accent">{tr("viewInvoice")}</Link>
        </Card>
      ) : status.canResolve ? (
        canManage ? (
          <Card className="p-5"><SaleResolveForm key={sale.id} sale={sale} onChanged={() => void load()} /></Card>
        ) : (
          <p role="status" className="banner banner-warn">{tr("noPermission")}</p>
        )
      ) : null}
    </div>
  );
}
