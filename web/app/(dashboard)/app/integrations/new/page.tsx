"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { ConnectFlow } from "@/components/dashboard/integrations/connect-flow";
import { collectAll, companies as companiesApi, integrations, type IntegrationProvider } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Company } from "@/lib/types";

function NewIntegration() {
  const t = useTranslations("Integrations");
  const { can, fiscalEnvironment } = useAuth();
  const wanted = useSearchParams().get("provider");
  const [data, setData] = useState<{ providers: IntegrationProvider[]; companies: Company[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    Promise.all([integrations.providers(), collectAll((cursor) => companiesApi.list({ cursor, limit: 100 }))])
      .then(([providers, companies]) => setData({ providers, companies }))
      .catch(() => setFailed(true));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/integrations" className="text-[13.5px] text-text-3 hover:text-text">← {t("title")}</Link>
      <PageHeader title={t("wizard.title")} />
      {!can("integrations.manage") ? (
        <p role="alert" className="text-[14px] text-text-3">{t("wizard.noPermission")}</p>
      ) : failed ? (
        <p role="alert" className="text-[14px] text-danger">{t("loadError")}</p>
      ) : !data ? (
        <Skeleton className="h-[220px] max-w-[640px]" />
      ) : (
        <ConnectFlow providers={data.providers} companies={data.companies} environment={fiscalEnvironment} initialProvider={data.providers.some((p) => p.id === wanted) ? wanted : null} />
      )}
    </div>
  );
}

export default function NewIntegrationPage() {
  return <Suspense><NewIntegration /></Suspense>;
}
