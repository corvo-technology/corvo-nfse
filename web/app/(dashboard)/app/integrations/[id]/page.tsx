"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DetailSkeleton } from "@/components/ui/detail-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { ConnectionCredentials } from "@/components/dashboard/integrations/connection-credentials";
import { ConnectionInfo } from "@/components/dashboard/integrations/connection-info";
import { ConnectionSettings } from "@/components/dashboard/integrations/connection-settings";
import { collectAll, companies as companiesApi, integrations, type IntegrationConnection, type IntegrationProvider } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { connectionStatus } from "@/lib/integrations";

export default function IntegrationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("Integrations");
  const tc = useTranslations("Common");
  const router = useRouter();
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const canManage = can("integrations.manage");

  const [connection, setConnection] = useState<IntegrationConnection | null>(null);
  const [provider, setProvider] = useState<IntegrationProvider | undefined>();
  const [companyName, setCompanyName] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [found, providers, companies] = await Promise.all([integrations.get(id), integrations.providers(), collectAll((cursor) => companiesApi.list({ cursor, limit: 100 }))]);
      const company = companies.find((c) => c.id === found.companyId);
      setConnection(found);
      setProvider(providers.find((p) => p.id === found.provider));
      setCompanyName(company ? company.tradeName || company.legalName : "");
    } catch {
      setFailed(true);
    }
  }, [id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function change(action: () => Promise<IntegrationConnection>, done?: () => void) {
    setBusy(true);
    try {
      setConnection(await action());
      success(t("detail.updated"));
      done?.();
    } catch (cause) {
      toastError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (failed) return <div className="flex flex-col gap-4"><p role="alert">{t("loadError")}</p><Button onClick={() => void load()}>{t("retry")}</Button></div>;
  if (!connection || connection.id !== id) return <DetailSkeleton label={tc("loading")} />;

  const status = connectionStatus(connection);
  const switchable = connection.state === "active" || connection.state === "paused";

  return (
    <div className="flex max-w-[900px] flex-col gap-6">
      <Link href="/app/integrations" className="text-[13.5px] text-text-3 hover:text-text">← {t("title")}</Link>
      <PageHeader
        title={provider?.name ?? connection.provider}
        subtitle={companyName}
        actions={<Badge variant={status.tone}>{t(`status.${status.key}`)}</Badge>}
      />

      {connection.state === "reauth_required" && <p role="alert" className="banner banner-danger">{t("detail.reconnectHint")}</p>}

      {switchable && (
        <Card className="p-5">
          <Toggle
            checked={connection.state === "active"}
            disabled={!canManage || busy}
            label={t("detail.emit")}
            description={connection.state === "active" ? t("detail.emitOn") : t("detail.emitOff")}
            onChange={(on) => void change(() => (on ? integrations.activate(connection.id) : integrations.pause(connection.id)))}
          />
        </Card>
      )}

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-medium">{t("detail.settings.title")}</h2>
        <ConnectionSettings connectionId={connection.id} canManage={canManage} />
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-medium">{t("detail.tabs.connection")}</h2>
        <ConnectionInfo connection={connection} provider={provider} companyName={companyName} />
        <ConnectionCredentials connection={connection} provider={provider} canManage={canManage} onUpdated={setConnection} />
      </Card>

      {canManage && connection.state !== "disconnected" && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          {confirming ? (
            <>
              <p className="max-w-[48ch] text-[13.5px] text-text-3">{t("detail.confirmDisconnect")}</p>
              <div className="flex gap-2.5">
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>{tc("cancel")}</Button>
                <Button variant="danger" loading={busy} onClick={() => void change(() => integrations.disconnect(connection.id), () => router.push("/app/integrations"))}>{t("detail.confirmYes")}</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[13.5px] text-text-3">{t("detail.disconnectHint")}</p>
              <Button variant="danger" onClick={() => setConfirming(true)}>{t("detail.disconnect")}</Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
