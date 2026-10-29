"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { integrations, type IntegrationConnection, type IntegrationProvider } from "@/lib/api";
import { connectionStatus } from "@/lib/integrations";
import { cn } from "@/lib/utils";
import { ConnectionInfo } from "./connection-info";
import { ConnectionSales } from "./connection-sales";
import { ConnectionSettings } from "./connection-settings";

interface ConnectionDialogProps {
  connection: IntegrationConnection;
  provider?: IntegrationProvider;
  companyName: string;
  canManage: boolean;
  onClose: () => void;
  /** Called after any change so the list behind the dialog refreshes. */
  onChanged: () => void;
}

type Tab = "sales" | "settings" | "connection";
const TABS: Tab[] = ["sales", "settings", "connection"];

export function ConnectionDialog({ connection, provider, companyName, canManage, onClose, onChanged }: ConnectionDialogProps) {
  const t = useTranslations("Integrations");
  const tc = useTranslations("Common");
  const { success, error: toastError } = useToast();
  const [current, setCurrent] = useState(connection);
  const [tab, setTab] = useState<Tab>("sales");
  const [busy, setBusy] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const status = connectionStatus(current);
  const switchable = current.state === "active" || current.state === "paused";

  async function change(action: () => Promise<IntegrationConnection>) {
    setBusy(true);
    try {
      setCurrent(await action());
      success(t("detail.updated"));
      onChanged();
    } catch (cause) {
      toastError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setConfirmingDisconnect(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={provider?.name ?? current.provider} wide>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge variant={status.tone}>{t(`status.${status.key}`)}</Badge>
            <span className="text-[13.5px] text-text-3">{companyName}</span>
          </div>
          {switchable && (
            <Toggle
              checked={current.state === "active"}
              disabled={!canManage || busy}
              label={t("detail.emit")}
              description={current.state === "active" ? t("detail.emitOn") : t("detail.emitOff")}
              onChange={(on) => void change(() => (on ? integrations.activate(current.id) : integrations.pause(current.id)))}
            />
          )}
        </div>

        {current.state === "reauth_required" && <p role="alert" className="text-[13.5px] text-danger">{t("detail.reconnectHint")}</p>}

        <div role="tablist" className="flex gap-1 border-b border-border">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={cn("-mb-px border-b-2 px-3.5 py-2 text-[13.5px] transition-colors", tab === name ? "border-accent text-text" : "border-transparent text-text-3 hover:text-text")}
            >
              {t(`detail.tabs.${name}`)}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="flex flex-col gap-5">
          {tab === "sales" && (
            <section aria-labelledby="sales-title" className="flex flex-col gap-2">
              <h3 id="sales-title" className="text-[14px] font-medium text-text">{t("detail.sales.title")}</h3>
              <ConnectionSales connectionId={current.id} canManage={canManage} onChanged={onChanged} />
            </section>
          )}
          {tab === "settings" && <ConnectionSettings connectionId={current.id} canManage={canManage} />}
          {tab === "connection" && (
            <>
              <ConnectionInfo connection={current} provider={provider} companyName={companyName} />
              {canManage && current.state !== "disconnected" && (
                <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-border pt-4">
                  {confirmingDisconnect ? (
                    <>
                      <p className="mr-auto max-w-[44ch] text-[13px] text-text-3">{t("detail.confirmDisconnect")}</p>
                      <Button variant="ghost" onClick={() => setConfirmingDisconnect(false)} disabled={busy}>{tc("cancel")}</Button>
                      <Button variant="danger" loading={busy} onClick={() => void change(() => integrations.disconnect(current.id))}>{t("detail.confirmYes")}</Button>
                    </>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirmingDisconnect(true)}>{t("detail.disconnect")}</Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
