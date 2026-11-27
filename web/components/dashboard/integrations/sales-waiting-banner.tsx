"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePendingSales } from "@/lib/use-pending-sales";

/** "X sales from your integrations are waiting for you", linking to the pending sales. Shows nothing when none wait. */
export function SalesWaitingBanner() {
  const t = useTranslations("Integrations.pendingSales");
  const { sales } = usePendingSales();
  if (sales.length === 0) return null;
  return (
    <p role="status" className="banner banner-warn flex flex-wrap items-center justify-between gap-3">
      <span>{t("banner", { count: sales.length })}</span>
      <Link href="/app/invoices?filter=sales" className="btn btn-secondary btn-sm">{t("bannerAction")}</Link>
    </p>
  );
}
