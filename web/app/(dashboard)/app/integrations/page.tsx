"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plug } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { providerDescriptionKey } from "@/components/dashboard/integrations/connect-flow";
import { SalesList, type SaleRow } from "@/components/dashboard/integrations/sales-list";
import { collectAll, companies as companiesApi, integrations, type IntegrationConnection, type IntegrationProvider, type IntegrationSale } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Company } from "@/lib/types";
import { connectionStatus, pendingCount, saleStatus } from "@/lib/integrations";
import { cn } from "@/lib/utils";

export default function IntegrationsPage() {
  const t = useTranslations("Integrations");
  const { can, fiscalEnvironment } = useAuth();
  const canManage = can("integrations.manage");

  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [sales, setSales] = useState<Record<string, IntegrationSale[]>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [onlyAttention, setOnlyAttention] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [list, available, owned] = await Promise.all([
        integrations.list(),
        integrations.providers(),
        collectAll((cursor) => companiesApi.list({ cursor, limit: 100 })),
      ]);
      setConnections(list.filter((c) => c.state !== "disconnected" && c.environment === fiscalEnvironment));
      setProviders(available);
      setCompanies(owned);
      // Only running connections can have sales waiting for the client.
      const running = list.filter((c) => c.environment === fiscalEnvironment && (c.state === "active" || c.state === "paused"));
      const entries = await Promise.all(running.map(async (c) => [c.id, await integrations.sales(c.id, 100).catch(() => [])] as const));
      setSales(Object.fromEntries(entries));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fiscalEnvironment]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
  const companyName = (id: string) => {
    const company = companies.find((c) => c.id === id);
    return company ? company.tradeName || company.legalName : "";
  };

  // Newest first, across every integration; the ones that need the client come with a filter.
  const rows: SaleRow[] = connections
    .flatMap((connection) => (sales[connection.id] ?? []).map((sale) => ({ sale, source: `${providerName(connection.provider)} · ${companyName(connection.companyId)}` })))
    .sort((a, b) => (b.sale.paidAt ?? b.sale.createdAt).localeCompare(a.sale.paidAt ?? a.sale.createdAt));
  const attentionRows = rows.filter(({ sale }) => ["waitingCustomer", "needsAttention"].includes(saleStatus(sale).key));
  const shownRows = (onlyAttention ? attentionRows : rows).slice(0, onlyAttention ? 100 : 30);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={canManage && providers.length > 0 ? <Link href="/app/integrations/new" className="btn btn-accent">{t("connect")}</Link> : undefined}
      />

      {loading ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-[84px]" /><Skeleton className="h-[84px]" /></div>
      ) : failed ? (
        <EmptyState tone="danger" icon={Plug} title={t("loadError")} action={<Button variant="secondary" onClick={() => { setLoading(true); void load(); }}>{t("retry")}</Button>} />
      ) : connections.length === 0 ? (
        <Card>
          <EmptyState icon={Plug} title={t("empty.title")} description={t("empty.description")} />
          {canManage && (
            <div className="flex flex-wrap justify-center gap-3 px-6 pb-8">
              {providers.map((p) => (
                <Link
                  key={p.id}
                  href={`/app/integrations/new?provider=${encodeURIComponent(p.id)}`}
                  className="flex w-full max-w-[16rem] flex-col gap-1 rounded-[12px] border border-border bg-surface px-4 py-3.5 text-left transition-colors hover:border-accent-border hover:bg-accent-surface"
                >
                  <span className="text-[15px] font-medium text-text">{p.name}</span>
                  <span className="text-[13px] text-text-3">{t(`providers.${providerDescriptionKey(p.id)}`)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {connections.map((connection) => {
            const status = connectionStatus(connection);
            const pending = pendingCount(sales[connection.id] ?? []);
            return (
              <li key={connection.id}>
                <Link href={`/app/integrations/${connection.id}`} className="block w-full text-left">
                  <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-border-strong">
                    <div className="min-w-0">
                      <p className="text-[16px] font-medium text-text">{providerName(connection.provider)}</p>
                      <p className="mt-0.5 text-[13.5px] text-text-3">{companyName(connection.companyId)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      {pending > 0 && <Badge variant="warn">{t("pending", { count: pending })}</Badge>}
                      <Badge variant={status.tone}>{t(`status.${status.key}`)}</Badge>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !failed && connections.length > 0 && (
        <>
          {attentionRows.length > 0 ? (
            <p role="status" className="banner banner-warn flex flex-wrap items-center justify-between gap-3">
              <span>{t("sales.attentionBanner", { count: attentionRows.length })}</span>
              {!onlyAttention && <Button size="sm" variant="secondary" onClick={() => setOnlyAttention(true)}>{t("sales.attention")}</Button>}
            </p>
          ) : (
            <p role="status" className="text-[13.5px] text-text-3">{t("sales.allGood")}</p>
          )}
          <Card className="dash-in dash-in-2 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
              <h2 className="text-[14.5px] font-medium text-text">{t("sales.title")}</h2>
              <div role="group" className="flex gap-1.5">
                {([false, true] as const).map((attention) => (
                  <button
                    key={String(attention)}
                    type="button"
                    aria-pressed={onlyAttention === attention}
                    onClick={() => setOnlyAttention(attention)}
                    className={cn("rounded-full border px-3 py-1 text-[12.5px] transition-colors", onlyAttention === attention ? "border-accent-border bg-accent-surface text-accent" : "border-border text-text-3 hover:text-text")}
                  >
                    {attention ? `${t("sales.attention")} (${attentionRows.length})` : t("sales.all")}
                  </button>
                ))}
              </div>
            </div>
            {shownRows.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13.5px] text-text-3">{onlyAttention ? t("sales.noneAttention") : t("sales.empty")}</p>
            ) : (
              <SalesList rows={shownRows} canManage={canManage} onChanged={() => void load()} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
