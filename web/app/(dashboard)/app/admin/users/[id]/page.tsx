"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import { useBillingEnabled } from "@/lib/deployment-config-context";
import { formatDate } from "@/lib/i18n-helpers";
import { formatBrl, platformAdmin, type PlatformUserDetail, type PlatformWorkspace } from "@/lib/platform-admin";
import { useApiErrorText, useInvoiceErrorText } from "@/lib/use-api-error";
import { GrantCreditsButton } from "@/components/admin/grant-credits-button";
import { Card } from "@/components/ui/card";
import { DetailSkeleton } from "@/components/ui/detail-skeleton";
import { PageHeader } from "@/components/ui/page-header";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex flex-col gap-2"><h3 className="eyebrow">{title}</h3>{children}</div>;
}

function Rows({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr>{head.map((label) => <th key={label} className="pr-4 pb-1 font-medium text-text-3">{label}</th>)}</tr></thead>
        <tbody>{rows.map((cells, index) => <tr key={index} className="border-t border-border">{cells.map((cell, cellIndex) => <td key={cellIndex} className="py-1.5 pr-4 align-top">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function WorkspaceBlock({ workspace, email, onGranted }: { workspace: PlatformWorkspace; email: string; onGranted: () => void }) {
  const t = useTranslations("Admin.detail");
  const ts = useTranslations("Invoices.status");
  const tc = useTranslations("Admin.common");
  const locale = useLocale();
  const billing = useBillingEnabled();
  const invoiceError = useInvoiceErrorText();
  const date = (value: string | null) => (value ? formatDate(value, locale) : tc("never"));
  const environment = (value: string) => (value === "live" ? t("production") : t("test"));
  const status = (value: string) => (ts.has(value) ? ts(value) : value);

  return (
    <Card className="flex flex-col gap-5 p-5">
      <section aria-label={`${t("workspace")} ${workspace.tenantId}`} className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">{t("workspace")} <span className="text-sm text-text-3">{workspace.tenantId}</span></h2>
            <p className="text-sm text-text-3">{t("role")}: <span>{workspace.role}</span>{workspace.isOwn && <> · {t("own")}</>}</p>
          </div>
          {billing && workspace.isOwn && <GrantCreditsButton tenantId={workspace.tenantId} email={email} onGranted={onGranted} />}
        </div>

        {billing && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div><p className="eyebrow">{t("plan")}</p><p>{workspace.plan ? workspace.plan.name : tc("unknown")}</p></div>
            <div>
              <p className="eyebrow">{t("usage")}</p>
              {workspace.usage
                ? <><p>{t("usageValue", { authorized: workspace.usage.authorized, included: workspace.usage.included, reserved: workspace.usage.reserved })}</p><p className="text-sm text-text-3">{t("periodEnd", { date: date(workspace.usage.periodEnd) })}</p></>
                : <p>{tc("unknown")}</p>}
            </div>
            <div><p className="eyebrow">{t("balance")}</p><p>{workspace.avulsoBalance}</p></div>
          </div>
        )}

        <Section title={t("companies")}>
          {workspace.companies.length === 0 ? <p className="text-sm text-text-3">{tc("empty")}</p> : (
            <Rows
              head={[t("name"), t("taxId"), t("municipality"), t("environment"), t("certificateValidUntil")]}
              rows={workspace.companies.map((company) => [company.legalName, company.taxId, company.municipalityCode, environment(company.environment), date(company.certificateValidUntil)])}
            />
          )}
        </Section>

        <Section title={t("recentInvoices")}>
          {workspace.recentInvoices.length === 0 ? <p className="text-sm text-text-3">{tc("empty")}</p> : (
            <Rows
              head={[t("status"), t("amount"), t("environment"), t("lastError"), t("date")]}
              rows={workspace.recentInvoices.map((invoice) => [
                status(invoice.status),
                formatBrl(Math.round(invoice.amount * 100), locale),
                environment(invoice.environment),
                invoice.lastErrorCode ? `${invoice.lastErrorCode}: ${invoiceError(invoice.lastErrorCode, null)}` : "—",
                date(invoice.createdAt),
              ])}
            />
          )}
        </Section>

        {billing && (
          <>
            <Section title={t("credits")}>
              {workspace.credits.length === 0 ? <p className="text-sm text-text-3">{tc("empty")}</p> : (
                <Rows
                  head={[t("type"), t("source"), t("amount"), t("name"), t("date")]}
                  rows={workspace.credits.map((credit) => [credit.type, credit.source ?? "—", credit.amount, credit.description ?? "—", date(credit.createdAt)])}
                />
              )}
            </Section>
            <Section title={t("payments")}>
              {workspace.payments.length === 0 ? <p className="text-sm text-text-3">{tc("empty")}</p> : (
                <Rows
                  head={[t("type"), t("provider"), t("amount"), t("status"), t("paidAt")]}
                  rows={workspace.payments.map((payment) => [payment.kind, payment.provider, formatBrl(payment.amountCents, locale), payment.status, date(payment.paidAt)])}
                />
              )}
            </Section>
          </>
        )}

        <Section title={t("apiKeys")}>
          {workspace.apiKeys.length === 0 ? <p className="text-sm text-text-3">{tc("empty")}</p> : (
            <Rows
              head={[t("name"), t("prefix"), t("environment"), t("lastUsed")]}
              rows={workspace.apiKeys.map((key) => [key.name, <code key={key.id}>{key.keyPrefix}</code>, environment(key.environment), date(key.lastUsedAt)])}
            />
          )}
        </Section>

        <Section title={t("mcpConnections")}>
          {workspace.mcpConnections.length === 0 ? <p className="text-sm text-text-3">{tc("empty")}</p> : (
            <Rows
              head={[t("client"), t("lastUsed")]}
              rows={workspace.mcpConnections.map((connection) => [connection.clientName, date(connection.lastUsedAt)])}
            />
          )}
        </Section>
      </section>
    </Card>
  );
}

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("Admin.detail");
  const tc = useTranslations("Admin.common");
  const locale = useLocale();
  const apiError = useApiErrorText();
  const [data, setData] = useState<PlatformUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    platformAdmin.user(id, abort.signal)
      .then((value) => { if (!abort.signal.aborted) { setData(value); setError(null); } })
      .catch((cause) => {
        if (abort.signal.aborted) return;
        setError(cause instanceof ApiError && cause.status === 404 ? tc("notFound") : apiError(cause, tc("loadFailed")));
      });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, revision]);

  const back = <Link href="/app/admin/users" className="btn">{t("back")}</Link>;
  if (!data || data.user.id !== id) {
    return error
      ? <div className="flex flex-col gap-4"><p role="alert" className="banner banner-danger">{error}</p><div>{back}</div></div>
      : <DetailSkeleton label={tc("unknown")} />;
  }

  const { user, workspaces } = data;
  const when = (value: string | null) => (value ? formatDate(value, locale) : tc("never"));
  return (
    <div className="flex max-w-[1000px] flex-col gap-6">
      <PageHeader title={user.name || user.email} subtitle={t("title")} actions={back} />
      {error && <p role="alert" className="banner banner-danger">{error}</p>}
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <div><p className="eyebrow">{t("account")}</p><p>{user.email}</p></div>
        <div><p className="eyebrow">{t("emailVerified")}</p><p>{user.emailVerifiedAt ? formatDate(user.emailVerifiedAt, locale) : tc("no")}</p></div>
        <div><p className="eyebrow">{t("lastLogin")}</p><p>{when(user.lastLoginAt)}</p></div>
        <div><p className="eyebrow">{t("signedUpAt")}</p><p>{when(user.createdAt)}</p></div>
      </Card>
      <h2 className="text-lg font-medium">{t("workspaces")}</h2>
      {workspaces.length === 0
        ? <p className="text-sm text-text-3">{t("noWorkspaces")}</p>
        : workspaces.map((workspace) => <WorkspaceBlock key={workspace.tenantId} workspace={workspace} email={user.email} onGranted={() => setRevision((value) => value + 1)} />)}
    </div>
  );
}
