"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Section links of Configurações. The Auditoria tab is for admins only; with one tab left there is nothing to switch. */
export function SettingsTabs() {
  const t = useTranslations("Settings.tabs");
  const { can } = useAuth();
  const pathname = usePathname() ?? "";
  if (!can("settings.manage")) return null;

  const tabs = [
    { href: "/app/settings", label: t("general"), active: !pathname.startsWith("/app/settings/audit") },
    { href: "/app/settings/audit", label: t("audit"), active: pathname.startsWith("/app/settings/audit") },
  ];

  return (
    <nav aria-label={t("label")} className="flex gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-[13.5px] transition-colors",
            tab.active ? "border-accent text-text" : "border-transparent text-text-3 hover:text-text-2",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
