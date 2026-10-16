"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Check, Copy } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { collectAll, mcp, type McpConnection } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, timeAgo } from "@/lib/i18n-helpers";
import { MCP_SERVER_URL } from "@/lib/mcp-config";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { DataTable, DataTableSkeleton, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";

function CopyButton({ value }: { value: string }) {
  const t = useTranslations("Agents.setup");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the URL stays selectable on screen.
    }
  };
  return (
    <Button variant="secondary" size="sm" onClick={() => void copy()}>
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? t("copied") : t("copy")}
    </Button>
  );
}

type CodeSample = { label: string; language: "bash" | "json" | "toml"; code: string };
const CLIENTS = ["claude-code", "claude-desktop", "cursor", "vscode", "codex", "windsurf", "other"] as const;
type ClientId = (typeof CLIENTS)[number];

/** Config snippet each agent needs; the server URL is the only value that is not translated. */
function sampleFor(client: ClientId): CodeSample | null {
  const url = MCP_SERVER_URL;
  switch (client) {
    case "claude-code": return { label: "bash", language: "bash", code: `claude mcp add --transport http corvo ${url}` };
    case "cursor": return { label: ".cursor/mcp.json", language: "json", code: JSON.stringify({ mcpServers: { corvo: { url } } }, null, 2) };
    case "vscode": return { label: ".vscode/mcp.json", language: "json", code: JSON.stringify({ servers: { corvo: { type: "http", url } } }, null, 2) };
    case "codex": return { label: "~/.codex/config.toml", language: "toml", code: `[mcp_servers.corvo]\nurl = "${url}"` };
    case "windsurf": return { label: "mcp_config.json", language: "json", code: JSON.stringify({ mcpServers: { corvo: { serverUrl: url } } }, null, 2) };
    default: return null;
  }
}

function SetupCard({ locale }: { locale: string }) {
  const t = useTranslations("Agents.setup");
  const [client, setClient] = useState<ClientId>("claude-code");
  const tools = t.raw("toolList") as string[];
  const after = t.raw("after") as string[];
  const steps = t.raw(`clients.${client}.steps`) as string[];
  const sample = sampleFor(client);

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = CLIENTS[(index + delta + CLIENTS.length) % CLIENTS.length];
    setClient(next);
    document.getElementById(`agent-tab-${next}`)?.focus();
  };

  return (
    <Card className="dash-in dash-in-2 overflow-hidden">
      <h2 className="border-b border-border px-5 py-4 text-[14.5px] font-medium">{t("title")}</h2>
      <div className="flex flex-col gap-5 px-5 py-4">
        <p className="text-sm text-text-3">{t("intro")}</p>

        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium">{t("serverUrl")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[10px] border border-border bg-surface px-3 py-2 font-mono text-[13px]">{MCP_SERVER_URL}</code>
            <CopyButton value={MCP_SERVER_URL} />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[13px] font-medium">{t("clientsTitle")}</p>
          <div role="tablist" aria-label={t("clientsTitle")} className="flex flex-wrap gap-1.5">
            {CLIENTS.map((id, index) => (
              <button
                key={id}
                id={`agent-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={client === id}
                aria-controls="agent-panel"
                tabIndex={client === id ? 0 : -1}
                onClick={() => setClient(id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn("rounded-full border px-3.5 py-1.5 text-[13px] transition-colors", client === id ? "border-accent-border bg-accent-surface text-text" : "border-border text-text-3 hover:text-text")}
              >
                {t(`clients.${id}.name`)}
              </button>
            ))}
          </div>

          <div id="agent-panel" role="tabpanel" aria-labelledby={`agent-tab-${client}`} className="flex flex-col gap-3 rounded-[12px] border border-border p-4">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-text-2">
              {steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            {sample && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="font-mono text-[12px] text-text-3">{sample.label}</p>
                <CodeBlock language={sample.language} code={sample.code} />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium">{t("afterTitle")}</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-text-2">
            {after.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium">{t("tools")}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-text-2">
            {tools.map((tool) => <li key={tool}>{tool}</li>)}
          </ul>
        </div>

        <p role="note" className="rounded-[10px] border border-warn/20 bg-warn/10 px-3 py-2 text-[13px] text-warn">{t("testNote")}</p>
        <Link href={`/${locale}/docs/mcp`} className="text-sm underline">{t("docs")}</Link>
      </div>
    </Card>
  );
}

export default function AgentsPage() {
  const t = useTranslations("Agents");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const { can } = useAuth();
  const { success, error: toastError } = useToast();
  const [items, setItems] = useState<McpConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<McpConnection | null>(null);
  const [revoking, setRevoking] = useState(false);
  const isAdmin = can("settings.manage");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await collectAll((cursor) => mcp.connections({ cursor, limit: 100 })));
    } catch {
      setError(t("connections.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const revoke = async () => {
    if (!target || revoking) return;
    setRevoking(true);
    try {
      await mcp.revoke(target.id);
      success(t("connections.revokedToast"));
      setTarget(null);
      await load();
    } catch {
      toastError(t("connections.errors.revokeFailed"));
    } finally {
      setRevoking(false);
    }
  };

  const scopeLabel = (scope: string) => (t.has(`connections.scopes.${scope}`) ? t(`connections.scopes.${scope}`) : scope);
  const columns: Column<McpConnection>[] = [
    {
      id: "app", header: t("connections.app"), primary: true,
      cell: (row) => (
        <span className="flex flex-col">
          <span className="flex items-center gap-2 font-medium">{row.client_name}<Badge variant={row.environment === "live" ? "warn" : "gray"} dot={false}>{t(row.environment === "live" ? "connections.envLive" : "connections.envTest")}</Badge></span>
          {row.owner_email && !row.mine && <span className="text-[12px] text-text-3">{t("connections.owner", { email: row.owner_email })}</span>}
          {row.mine && isAdmin && <span className="text-[12px] text-text-3">{t("connections.you")}</span>}
        </span>
      ),
    },
    { id: "workspace", header: t("connections.workspace"), cell: (row) => row.tenant_name || "—", hideOnMobile: true },
    { id: "permissions", header: t("connections.permissions"), cell: (row) => row.scopes.map(scopeLabel).join(", ") },
    { id: "connected", header: t("connections.connected"), cell: (row) => formatDate(row.granted_at, locale), hideOnMobile: true },
    { id: "lastUsed", header: t("connections.lastUsed"), cell: (row) => (row.last_used_at ? timeAgo(row.last_used_at, tc) : t("connections.neverUsed")) },
    { id: "usage", header: t("connections.usage"), cell: (row) => t("connections.usageValue", { calls: row.tool_calls, invoices: row.invoices_issued }) },
    { id: "status", header: t("connections.status"), cell: (row) => <Badge variant={row.revoked ? "gray" : "accent"}>{row.revoked ? t("connections.revoked") : t("connections.active")}</Badge> },
    {
      id: "actions", header: "", align: "right", action: true,
      cell: (row) => (row.revoked ? null : <Button variant="danger" size="sm" onClick={() => setTarget(row)}>{t("connections.revoke")}</Button>),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SetupCard locale={locale} />

      <Card className="dash-in dash-in-3 overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-border px-5 py-4">
          <h2 className="text-[14.5px] font-medium">{t("connections.title")}</h2>
          {isAdmin && <p className="text-[12.5px] text-text-3">{t("connections.adminHint")}</p>}
        </div>
        {loading ? (
          <DataTableSkeleton label={tc("loading")} />
        ) : error ? (
          <EmptyState tone="danger" title={error} action={<Button variant="secondary" onClick={() => void load()}>{tc("retry")}</Button>} />
        ) : items.length === 0 ? (
          <EmptyState icon={Bot} title={t("connections.emptyTitle")} description={t("connections.emptyBody")} />
        ) : (
          <DataTable columns={columns} rows={items} rowKey={(row) => row.id} caption={t("connections.title")} />
        )}
      </Card>

      <Modal open={target !== null} onClose={() => setTarget(null)} title={t("connections.confirmTitle")}>
        <p className="text-sm text-text-3">{t("connections.confirmBody", { name: target?.client_name ?? "" })}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setTarget(null)}>{t("connections.cancel")}</Button>
          <Button variant="danger" loading={revoking} onClick={() => void revoke()}>{t("connections.confirm")}</Button>
        </div>
      </Modal>
    </div>
  );
}
