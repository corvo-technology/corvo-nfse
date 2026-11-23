"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableSkeleton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useBillingEnabled } from "@/lib/deployment-config-context";
import { formatDate } from "@/lib/i18n-helpers";
import { platformAdmin, type PlatformUserRow } from "@/lib/platform-admin";
import { useApiErrorText } from "@/lib/use-api-error";

const PAGE_SIZE = 50;
const TYPING_PAUSE_MS = 300;

/** Platform admin: every user of the platform, with search and cursor pagination. */
export default function AdminUsersPage() {
  const t = useTranslations("Admin.users");
  const tc = useTranslations("Admin.common");
  const tg = useTranslations("Common");
  const locale = useLocale();
  const apiError = useApiErrorText();
  const billingEnabled = useBillingEnabled();

  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<PlatformUserRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const termRef = useRef("");

  // The search runs when the typing stops, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.trim();
      if (next === termRef.current) return;
      // A new term drops the old rows and cursor right away, so they never pair with it.
      termRef.current = next;
      setRows([]);
      setNextCursor(null);
      setLoadingMore(false);
      setError(null);
      setLoading(true);
      setTerm(next);
    }, TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // One controller per search term: a new term aborts the previous load and any pending "load more".
  const controllerRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    loadingMoreRef.current = false;
    platformAdmin.users({ limit: PAGE_SIZE, ...(term ? { search: term } : {}) }, controller.signal)
      .then((page) => { if (controller.signal.aborted) return; setRows(page.items); setNextCursor(page.hasMore ? page.nextCursor : null); setError(null); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(apiError(cause, tc("loadFailed"))); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const loadMore = useCallback(async () => {
    const controller = controllerRef.current;
    if (!nextCursor || !controller || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await platformAdmin.users({ limit: PAGE_SIZE, cursor: nextCursor, ...(term ? { search: term } : {}) }, controller.signal);
      if (controller.signal.aborted) return;
      setRows((current) => [...current, ...page.items]);
      setNextCursor(page.hasMore ? page.nextCursor : null);
    } catch (cause) { if (!controller.signal.aborted) setError(apiError(cause, tc("loadFailed"))); }
    finally { if (!controller.signal.aborted) { loadingMoreRef.current = false; setLoadingMore(false); } }
  }, [nextCursor, term, apiError, tc]);

  const date = (value: string | null) => (value ? formatDate(value, locale) : "—");
  const columns: Column<PlatformUserRow>[] = [
    {
      id: "email", header: t("columns.email"), primary: true,
      cell: (u) => <Link href={`/app/admin/users/${u.id}`} className="font-medium text-text underline-offset-2 hover:underline">{u.email}</Link>,
    },
    { id: "name", header: t("columns.name"), cell: (u) => <span className="text-text-2">{u.name}</span> },
    { id: "signedUpAt", header: t("columns.signedUpAt"), hideOnMobile: true, cell: (u) => <span className="text-[13px] text-text-3">{date(u.createdAt)}</span> },
    ...(billingEnabled ? [{
      id: "plan", header: t("columns.plan"),
      cell: (u: PlatformUserRow) => <span className="text-[13px] text-text-2">{u.planSlug ?? t("noPlan")}</span>,
    }] : []),
    { id: "invoicesMonth", header: t("columns.invoicesMonth"), align: "right" as const, cell: (u) => <span className="tabular-nums">{u.liveInvoicesThisMonth}</span> },
    ...(billingEnabled ? [{
      id: "avulsoBalance", header: t("columns.avulsoBalance"), align: "right" as const,
      cell: (u: PlatformUserRow) => <span className="tabular-nums">{u.avulsoBalance}</span>,
    }] : []),
    { id: "companies", header: t("columns.companies"), align: "right" as const, hideOnMobile: true, cell: (u) => <span className="tabular-nums">{u.companiesCount}</span> },
    { id: "lastActivity", header: t("columns.lastActivity"), hideOnMobile: true, cell: (u) => <span className="text-[13px] text-text-4">{date(u.lastActivityAt)}</span> },
  ];

  const empty = !loading && rows.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} />

      <Field label={t("searchLabel")}>
        {(c) => (
          <input {...c} type="search" className="field max-w-[420px]" placeholder={t("searchPlaceholder")} value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" spellCheck={false} />
        )}
      </Field>

      {error && <p role="alert" className="banner banner-danger">{error}</p>}

      {loading ? <DataTableSkeleton label={tg("loading")} /> : empty ? (
        <EmptyState icon={Users} title={t("noResults")} />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} rowKey={(u) => u.id} caption={t("title")} />
          {nextCursor && <Button variant="ghost" onClick={() => void loadMore()} loading={loadingMore}>{tc("loadMore")}</Button>}
        </>
      )}
    </div>
  );
}
