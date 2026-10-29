"use client";

import { useCallback, useEffect, useState } from "react";
import { Plug } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectDialog, providerDescriptionKey } from "@/components/dashboard/integrations/connect-dialog";
import { ConnectionDialog } from "@/components/dashboard/integrations/connection-dialog";
import { collectAll, companies as companiesApi, integrations, type IntegrationConnection, type IntegrationProvider, type IntegrationSale } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Company } from "@/lib/types";
import { connectionStatus, pendingCount } from "@/lib/integrations";

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
  const [wizard, setWizard] = useState<{ provider: string | null } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [list, available, owned] = await Promise.all([
        integrations.list(),
        integrations.providers(),
        collectAll((cursor) => companiesApi.list({ cursor, limit: 100 })),
      ]);
      setConnections(list.filter((c) => c.state !== "disconnected"));
      setProviders(available);
      setCompanies(owned);
      // Only running connections can have sales waiting for the client.
      const running = list.filter((c) => c.state === "active" || c.state === "paused");
      const entries = await Promise.all(running.map(async (c) => [c.id, await integrations.sales(c.id, 100).catch(() => [])] as const));
      setSales(Object.fromEntries(entries));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const opened = connections.find((c) => c.id === openId) ?? null;
  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
  const companyName = (id: string) => {
    const company = companies.find((c) => c.id === id);
    return company ? company.tradeName || company.legalName : "";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={canManage && providers.length > 0 ? <Button variant="accent" onClick={() => setWizard({ provider: null })}>{t("connect")}</Button> : undefined}
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
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setWizard({ provider: p.id })}
                  className="flex w-full max-w-[16rem] flex-col gap-1 rounded-[12px] border border-border bg-surface px-4 py-3.5 text-left transition-colors hover:border-accent-border hover:bg-accent-surface"
                >
                  <span className="text-[15px] font-medium text-text">{p.name}</span>
                  <span className="text-[13px] text-text-3">{t(`providers.${providerDescriptionKey(p.id)}`)}</span>
                </button>
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
                <button type="button" onClick={() => setOpenId(connection.id)} className="w-full text-left">
                  <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-border-strong">
                    <div className="min-w-0">
                      <p className="text-[16px] font-medium text-text">{providerName(connection.provider)}</p>
                      <p className="mt-0.5 text-[13.5px] text-text-3">{companyName(connection.companyId)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      {pending > 0 && <Badge variant="warn">{t("pending", { count: pending })}</Badge>}
                      <Badge variant="gray" dot={false}>{t(`env.${connection.environment}`)}</Badge>
                      <Badge variant={status.tone}>{t(`status.${status.key}`)}</Badge>
                    </div>
                  </Card>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {wizard && (
        <ConnectDialog
          open
          onClose={() => setWizard(null)}
          providers={providers}
          companies={companies}
          defaultEnvironment={fiscalEnvironment}
          initialProvider={wizard.provider}
          onConnected={() => void load()}
        />
      )}
      {opened && (
        <ConnectionDialog
          key={opened.id}
          connection={opened}
          provider={providers.find((p) => p.id === opened.provider)}
          companyName={companyName(opened.companyId)}
          canManage={canManage}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
