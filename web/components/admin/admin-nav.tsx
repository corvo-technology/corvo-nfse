"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", href: "/app/admin" },
  { key: "users", href: "/app/admin/users" },
  { key: "attention", href: "/app/admin/attention" },
  { key: "audit", href: "/app/admin/audit" },
] as const;

/** Tab bar shared by every admin page. Scrolls sideways on narrow screens. */
export function AdminNav() {
  const t = useTranslations("Admin");
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/app/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label={t("navLabel")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max min-w-full gap-1.5 border-b border-border pb-3">
        {TABS.map(({ key, href }) => {
          const active = isActive(href);
          return (
            <li key={key} className="flex-none">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
                  active ? "border-accent-border bg-accent-surface text-text" : "border-transparent text-text-3 hover:text-text",
                )}
              >
                {t(`nav.${key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
