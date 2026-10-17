"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bot,
  Building2,
  CreditCard,
  FileText,
  KeyRound,
  LayoutDashboard,
  Settings,
  Users,
  Webhook,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { billing } from "@/lib/api";
import type { BillingPlan } from "@/lib/types";
import { CorvoLogo } from "@/components/ui/corvo-logo";

interface NavItem {
  key: string;
  href: string;
  icon: LucideIcon;
}

const navMain: NavItem[] = [
  { key: "Sidebar.nav.overview", href: "/app", icon: LayoutDashboard },
  { key: "Sidebar.nav.companies", href: "/app/companies", icon: Building2 },
  { key: "Sidebar.nav.invoices", href: "/app/invoices", icon: FileText },
];

const navAccount: NavItem[] = [
  { key: "Sidebar.nav.webhooks", href: "/app/webhooks", icon: Webhook },
  { key: "Sidebar.nav.apiKeys", href: "/app/api-keys", icon: KeyRound },
  { key: "Sidebar.nav.agents", href: "/app/agents", icon: Bot },
  { key: "Sidebar.nav.billing", href: "/app/billing", icon: CreditCard },
  { key: "Sidebar.nav.members", href: "/app/members", icon: Users },
  { key: "Sidebar.nav.settings", href: "/app/settings", icon: Settings },
];

interface SidebarProps {
  activePath: string;
  open: boolean;
  onClose: () => void;
  closeButtonRef?: React.Ref<HTMLButtonElement>;
}

export function Sidebar({ activePath, open, onClose, closeButtonRef }: SidebarProps) {
  const t = useTranslations();
  const { can, tenantId } = useAuth();
  const [plan, setPlan] = useState<BillingPlan | null>(null);
  // `can` changes identity on every session refresh (e.g. each window focus);
  // depend on the boolean so the plan is not refetched each time.
  const canViewBilling = can("billing.view");

  useEffect(() => {
    let cancelled = false;
    if (!canViewBilling) return;
    billing
      .plan()
      .then((p) => !cancelled && setPlan(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canViewBilling, tenantId]);

  const isActive = (href: string) => (href === "/app" ? activePath === "/app" : activePath.startsWith(href));

  const used = plan?.usage.creditsUsed ?? 0;
  const total = plan?.usage.monthlyAllowance ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const nearLimit = pct >= 80;

  const renderItem = ({ key, href, icon: Icon }: NavItem) => {
    const permission = ({ "/app/companies": "nfse.companies.view", "/app/invoices": "nfse.invoices.view", "/app/webhooks": "webhooks.view", "/app/api-keys": "api_keys.manage", "/app/billing": "billing.view", "/app/members": "settings.manage" } as Record<string, string>)[href];
    if (permission && !can(permission)) return null;
    const active = isActive(href);
    return (
      <li key={href}>
        <Link
          href={href}
          onClick={onClose}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group relative flex min-h-10 items-center gap-3 rounded-[8px] px-3 text-[14.5px] transition-colors",
            active ? "bg-active text-text" : "text-text-3 hover:bg-hover hover:text-text"
          )}
        >
          {active && <span aria-hidden className="absolute -left-[14px] top-2 bottom-2 w-[2px] rounded-full bg-accent" />}
          <Icon size={16} aria-hidden className={cn("flex-none transition-colors", active ? "text-accent" : "text-text-4 group-hover:text-text-2")} />
          {t(key)}
        </Link>
      </li>
    );
  };

  return (
    <aside
      id="app-sidebar"
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-[272px] max-w-[85vw] flex-col gap-6 border-r border-border bg-bg px-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4",
        "transition-[transform,visibility] duration-200 ease-out",
        "lg:sticky lg:top-0 lg:z-30 lg:h-dvh lg:w-[240px] lg:max-w-none lg:translate-x-0 lg:visible",
        open ? "translate-x-0 visible" : "-translate-x-full invisible"
      )}
    >
      <div className="flex items-center justify-between px-2">
        <Link href="/app" onClick={onClose} className="flex items-center gap-2.5 rounded-md py-1">
          <CorvoLogo size={16} variant="green" />
          <span className="text-[16px] font-semibold tracking-tight">{t("Common.brand")}</span>
        </Link>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={t("Common.closeMenu")}
          className="-mr-1 flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-white/5 hover:text-text lg:hidden"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <nav aria-label={t("Common.mainNavigation")} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <ul className="flex flex-col gap-0.5">{navMain.map(renderItem)}</ul>
        <div className="flex flex-col gap-1">
          <p className="eyebrow px-3 py-1 text-text-5">{t("Sidebar.account")}</p>
          <ul className="flex flex-col gap-0.5">{navAccount.map(renderItem)}</ul>
        </div>
      </nav>

      {plan && (
        <div className="flex flex-col gap-3 rounded-[11px] border border-border bg-surface p-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="eyebrow">{t("Sidebar.creditsLabel")}</span>
            <span className="font-mono text-[13px] text-text">
              {used}
              <span className="text-text-4">/{total}</span>
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={used}
            aria-label={t("Sidebar.creditsUsed", { used, total })}
            className="h-1 overflow-hidden rounded-full bg-track"
          >
            <div
              className={cn("h-full rounded-full transition-all duration-500", nearLimit ? "bg-warn" : "bg-accent")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <Link href="/app/billing" onClick={onClose} className="text-[13px] text-accent transition-opacity hover:opacity-80">
            {t("Billing.title")}
          </Link>
        </div>
      )}
    </aside>
  );
}
