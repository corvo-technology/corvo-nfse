"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import type { IntegrationSale } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useIntegrationErrorText } from "@/lib/use-integration-error";

const PROVIDER_NAMES: Record<string, string> = { woovi: "Woovi", abacatepay: "AbacatePay", stripe: "Stripe", pushinpay: "PushinPay", hotmart: "Hotmart", kiwify: "Kiwify", mercadopago: "Mercado Pago" };
const PIX_PROVIDERS = new Set(["woovi", "pushinpay", "abacatepay"]);

interface PendingSalesPanelProps {
  sales: IntegrationSale[];
  loading: boolean;
  failed: boolean;
}

/** The sales that did not become invoices and wait for the client. Read from the integrations, never a fake invoice. */
export function PendingSalesPanel({ sales, loading, failed }: PendingSalesPanelProps) {
  const t = useTranslations("Integrations");
  const locale = useLocale();
  const { can } = useAuth();
  const errorText = useIntegrationErrorText();
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" });
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "pt" ? "pt-BR" : "en-US", { dateStyle: "short", timeStyle: "short" });
  const origin = (provider?: string) => {
    const name = PROVIDER_NAMES[provider ?? ""] ?? provider ?? "";
    return t(PIX_PROVIDERS.has(provider ?? "") ? "pendingSales.origin" : "pendingSales.originOther", { provider: name });
  };

  if (loading) return <div className="flex flex-col gap-3 p-4"><Skeleton className="h-[64px]" /><Skeleton className="h-[64px]" /></div>;
  if (failed) return <EmptyState tone="danger" icon={AlertTriangle} title={t("pendingSales.loadError")} />;
  if (sales.length === 0) return <p className="px-5 py-8 text-center text-[13.5px] text-text-3">{t("pendingSales.empty")}</p>;

  return (
    <Card className="overflow-hidden">
      <p className="border-b border-border px-4 py-3 text-[13.5px] text-text-3 sm:px-5">{t("pendingSales.intro")}</p>
      <ul className="flex flex-col divide-y divide-border">
        {sales.map((sale) => (
          <li key={sale.id}>
            <Link href={`/app/integrations/sales/${sale.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-active sm:px-5">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-text">{sale.customer?.name || t("detail.sales.anonymous")} <span className="text-text-3">· {money.format(sale.amountCents / 100)}</span></p>
                <p className="text-[12.5px] text-text-4">{when(sale.paidAt ?? sale.createdAt)} · {origin(sale.provider)}</p>
                <p className="mt-0.5 text-[13px] text-warn">{errorText(sale.blockReason)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="warn">{t("pendingSales.status")}</Badge>
                {can("integrations.manage") && <span className="btn btn-accent btn-sm">{t("resolveAction")}</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
