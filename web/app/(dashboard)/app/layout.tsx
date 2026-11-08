"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth";
import { useCompleteRegistration } from "@/lib/use-complete-registration";
import { Sidebar } from "@/components/dashboard/sidebar";
import { NoAccess } from "@/components/dashboard/no-access";
import { canOpenPath, permissionForPath } from "@/lib/route-permissions";
import { Topbar } from "@/components/dashboard/topbar";
import { CorvoLogo } from "@/components/ui/corvo-logo";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations();
  const { isAuthenticated, isLoading, status, refreshSession, tenantId, can, fiscalEnvironment } = useAuth();
  useCompleteRegistration();

  // The drawer is tied to the path it was opened on, so navigating closes it
  // without needing an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const sidebarOpen = openAt === pathname;
  const closeSidebar = () => setOpenAt(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const pathToPage: Record<string, string> = {
    "/app": t("Overview.title"),
    "/app/companies": t("Companies.title"),
    "/app/invoices": t("Invoices.title"),
    "/app/invoices/new": t("Invoices.newTitle"),
    "/app/webhooks": t("Webhooks.title"),
    "/app/api-keys": t("ApiKeys.title"),
    "/app/agents": t("Agents.title"),
    "/app/billing": t("Billing.title"),
    "/app/members": t("Members.title"),
    "/app/settings": t("Settings.title"),
  };
  const page = pathToPage[pathname] ?? t("Dashboard.overview");

  // Browser tab title follows the page.
  useEffect(() => {
    document.title = `${page} | ${t("Common.brand")}`;
  }, [page, t]);

  // Companies and invoices belong to one fiscal environment. A detail page for
  // an ID from the other environment would 404, so go back to its list.
  useEffect(() => {
    const onEnvironmentChange = () => {
      const path = window.location.pathname;
      if (/^\/app\/companies\/[^/]+$/.test(path)) router.replace("/app/companies");
      else if (/^\/app\/invoices\/(?!new$)[^/]+$/.test(path)) router.replace("/app/invoices");
    };
    window.addEventListener("fiscal-environment-change", onEnvironmentChange);
    return () => window.removeEventListener("fiscal-environment-change", onEnvironmentChange);
  }, [router]);

  // Auth gate
  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  // Drawer: Escape closes, body scroll locks, focus moves in and back out.
  useEffect(() => {
    if (!sidebarOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenAt(null);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener?.focus?.();
    };
  }, [sidebarOpen]);

  if (status === "error") return <div className="flex min-h-dvh flex-col items-center justify-center gap-4"><p role="alert">{t("Session.unavailable")}</p><button className="btn btn-secondary" onClick={() => void refreshSession()}>{t("Session.retry")}</button></div>;
  if (isLoading || !isAuthenticated) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg text-[14px] text-text-3"
      >
        <CorvoLogo size={22} variant="green" />
        <span>{t("Common.loading")}</span>
      </div>
    );
  }

  const permission = permissionForPath(pathname);
  return (
    <div key={tenantId} className="flex min-h-dvh flex-row bg-bg font-sans text-text">
      {/* Mobile scrim */}
      {sidebarOpen && (
        <div aria-hidden className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={closeSidebar} />
      )}

      <Sidebar activePath={pathname} open={sidebarOpen} onClose={closeSidebar} closeButtonRef={closeButtonRef} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar page={page} menuOpen={sidebarOpen} onMenuToggle={() => setOpenAt(pathname)} />
        <main
          id="main"
          tabIndex={-1}
          className="relative flex-1 outline-none"
        >
          <div className="mx-auto w-full max-w-[1120px] px-4 py-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8 lg:px-8 lg:py-10">
            <div key={`${tenantId}:${fiscalEnvironment}:${permission ?? "overview"}`}>{canOpenPath(pathname, can) ? children : <NoAccess />}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
