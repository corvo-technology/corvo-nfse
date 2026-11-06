"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { setFiscalEnvironment } from "@/lib/api";
import { EnvSwitch } from "@/components/dashboard/env-switch";
import { HIGHLIGHT_ENV_EVENT } from "@/components/onboarding/first-note-banner";

interface TopbarProps {
  page: string;
  menuOpen: boolean;
  onMenuToggle: () => void;
}

export function Topbar({ page, menuOpen, onMenuToggle }: TopbarProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { session, logout, switchTenant, fiscalEnvironment, switchFiscalEnvironment } = useAuth();
  const [failure, setFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlightEnv, setHighlightEnv] = useState(false);

  // After the first test note the selector is pointed out for a few seconds.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onHighlight = () => { setHighlightEnv(true); clearTimeout(timer); timer = setTimeout(() => setHighlightEnv(false), 6000); };
    window.addEventListener(HIGHLIGHT_ENV_EVENT, onHighlight);
    return () => { window.removeEventListener(HIGHLIGHT_ENV_EVENT, onHighlight); clearTimeout(timer); };
  }, []);

  const handleSignOut = async () => {
    if (busy) return;
    setBusy(true); setFailure(false);
    try { await logout(); router.replace("/login"); }
    catch { setFailure(true); }
    finally { setBusy(false); }
  };
  const handleTenant = async (tenantId: string) => {
    setBusy(true); setFailure(false);
    try { await switchTenant(tenantId); }
    catch { setFailure(true); }
    finally { setBusy(false); }
  };

  const handleEnvironment = (env: "test" | "live") => {
    setHighlightEnv(false);
    setFiscalEnvironment(env);
    switchFiscalEnvironment(env);
    window.dispatchEvent(new CustomEvent("fiscal-environment-change", { detail: env }));
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 flex-none items-center justify-between border-b border-border bg-bg/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70 lg:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenuToggle}
          aria-label={t("Common.openMenu")}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          className="-ml-2 flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-text-2 transition-colors hover:bg-white/5 hover:text-text lg:hidden"
        >
          <Menu size={19} aria-hidden />
        </button>
        <nav aria-label="Breadcrumb" className="min-w-0 text-[14.5px]">
          <ol className="flex min-w-0 items-center">
            <li className="hidden text-text-3 sm:block">
              {t("Common.brand")}
              <span aria-hidden className="mx-2 text-text-5">/</span>
            </li>
            <li aria-current="page" className="truncate font-medium text-text">
              {page}
            </li>
          </ol>
        </nav>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3">
        <Link
          href={`/${locale}/docs`}
          aria-label={t("Topbar.docsLabel")}
          className="hidden min-h-9 items-center rounded-md px-2 font-mono text-xs text-text-3 transition-colors hover:text-text sm:flex"
        >
          {t("Topbar.docs")}
        </Link>

        <EnvSwitch value={fiscalEnvironment} onChange={handleEnvironment} highlight={highlightEnv} />

        {failure && <span role="alert" className="text-xs text-danger">{t("Session.actionFailed")}</span>}
        {(session?.availableTenants.length ?? 0) > 1 && <select aria-label={t("Session.workspace")} className="field max-w-40" disabled={busy} value={session?.activeTenantId} onChange={(event) => void handleTenant(event.target.value)}>{session?.availableTenants.map((item) => <option key={item.tenantId} value={item.tenantId}>{item.establishmentName}</option>)}</select>}
        <LocaleSwitcher />
        <button
          type="button"
          onClick={handleSignOut}
          disabled={busy}
          aria-label={t("Common.signOut")}
          title={t("Common.signOut")}
          className="-mr-2 flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-white/5 hover:text-text"
        >
          <LogOut size={16} aria-hidden />
        </button>
      </div>
    </header>
  );
}
