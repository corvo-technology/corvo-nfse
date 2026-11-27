"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth";

/**
 * "Nova nota". Where the member may issue NF-e, the button asks which note (service, product or
 * consumer sale); otherwise it goes straight to the NFS-e form.
 */
export function NewInvoiceMenu() {
  const t = useTranslations("Overview");
  const { can } = useAuth();
  const service = can("nfse.invoices.issue");
  const product = can("nfe.documents.issue");
  const consumer = product;
  if (!service && !product && !consumer) return null;
  if (service && !product && !consumer)
    return <Link href="/app/invoices/new" className="btn btn-accent"><Plus size={15} aria-hidden />{t("newInvoice")}</Link>;
  return (
    <details className="relative">
      <summary className="btn btn-accent cursor-pointer list-none"><Plus size={15} aria-hidden />{t("newInvoice")}</summary>
      <div role="menu" aria-label={t("newChoose")} className="absolute right-0 z-10 mt-2 flex min-w-60 flex-col gap-1 rounded-[12px] border border-border bg-surface p-2 shadow-lg">
        {service && <Link role="menuitem" href="/app/invoices/new" className="rounded-md px-3 py-2 text-sm hover:bg-white/5">{t("newService")}</Link>}
        {product && <Link role="menuitem" href="/app/nfe/new" className="rounded-md px-3 py-2 text-sm hover:bg-white/5">{t("newProduct")}</Link>}
        {consumer && <Link role="menuitem" href="/app/nfe/new?type=nfce" className="rounded-md px-3 py-2 text-sm hover:bg-white/5">{t("newConsumer")}</Link>}
      </div>
    </details>
  );
}
