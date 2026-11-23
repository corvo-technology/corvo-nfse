"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, DataTableSkeleton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { platformAdmin, type PlatformAuditEvent } from "@/lib/platform-admin";

const PAGE_SIZE = 50;

export default function AdminAuditPage() {
  const t = useTranslations("Admin.audit");
  const tc = useTranslations("Admin.common");
  const locale = useLocale();
  const [rows, setRows] = useState<PlatformAuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    platformAdmin.audit({ limit: PAGE_SIZE }, controller.signal).then(
      (page) => { setRows(page.items); setCursor(page.hasMore ? page.nextCursor : null); setLoading(false); },
      () => { if (!controller.signal.aborted) { setFailed(true); setLoading(false); } },
    );
    return () => controller.abort();
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || moreLoading) return;
    setMoreLoading(true);
    setFailed(false);
    try {
      const page = await platformAdmin.audit({ limit: PAGE_SIZE, cursor });
      setRows((current) => [...current, ...page.items]);
      setCursor(page.hasMore ? page.nextCursor : null);
    } catch { setFailed(true); }
    finally { setMoreLoading(false); }
  }, [cursor, moreLoading]);

  const columns: Column<PlatformAuditEvent>[] = [
    { id: "when", header: t("columns.when"), primary: true, cell: (e) => new Date(e.createdAt).toLocaleString(locale === "pt" ? "pt-BR" : "en-US") },
    { id: "actor", header: t("columns.actor"), cell: (e) => e.actorEmail },
    { id: "action", header: t("columns.action"), cell: (e) => t(`actions.${e.action}`) },
    {
      id: "target", header: t("columns.target"),
      cell: (e) => e.targetUserId
        ? <Link href={`/app/admin/users/${e.targetUserId}`} className="text-accent underline-offset-2 hover:underline">{tc("openUser")}</Link>
        : <span className="text-text-3">{e.targetTenantId ?? "-"}</span>,
    },
    { id: "reason", header: t("columns.reason"), cell: (e) => e.reason ?? "-" },
    { id: "result", header: t("columns.result"), cell: (e) => <span className={e.success ? "text-ok" : "text-danger"}>{e.success ? t("success") : t("failure")}</span> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} />
      <Card className="overflow-hidden">
        {loading ? (
          <DataTableSkeleton label={t("title")} />
        ) : failed && rows.length === 0 ? (
          <EmptyState tone="danger" title={tc("loadFailed")} />
        ) : rows.length === 0 ? (
          <EmptyState title={tc("empty")} />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(e) => e.id} caption={t("title")} />
        )}
      </Card>
      {failed && rows.length > 0 && <p role="alert" className="text-[13px] text-danger">{tc("loadFailed")}</p>}
      {cursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={moreLoading}>{tc("loadMore")}</Button>
        </div>
      )}
    </div>
  );
}
