"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { CorvoWordmark } from "@/components/ui/corvo-logo";
import { LocaleSwitcher } from "@/components/locale-switcher";

const navLinks = [
  { key: "product", href: "#product" },
  { key: "docs", href: "/docs" },
  { key: "pricing", href: "#pricing" },
];

export function Nav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const t = useTranslations("Nav");
  const locale = useLocale();

  return (
    <nav
      className={cn(
        "sticky top-0 z-50 flex items-center justify-between px-6 sm:px-10 py-4",
        "bg-[rgba(10,10,10,0.86)] backdrop-blur-md"
      )}
    >
      {/* Left */}
      <div className="flex items-center gap-8">
        <Link href="/">
          <CorvoWordmark size={16} variant="white" />
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <a
              key={link.key}
              href={link.href.startsWith("/#") ? link.href : `/${locale}${link.href}`}
              className="text-[14px] text-text-2 transition-colors hover:text-text"
            >
              {t(link.key)}
            </a>
          ))}
        </div>
      </div>

      {/* Right */}
      <div className="hidden md:flex items-center gap-5">
        <LocaleSwitcher />
        <Link
          href="/login?mode=login"
          className="text-[14px] text-text-2 transition-colors hover:text-text"
        >
          {t("signIn")}
        </Link>
        <Link
          href="/login?mode=signup"
          className="inline-flex items-center justify-center bg-[#ededec] text-[#0a0a0a] px-4 py-2 rounded-[7px] font-medium text-[14px] transition-all hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]"
        >
          {t("startFree")}
        </Link>
      </div>

      {/* Mobile toggle */}
      <button
        className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-1.5"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        <span
          className={cn(
            "w-4 h-[1.5px] bg-text-2 transition-all duration-200",
            mobileOpen && "rotate-45 translate-y-[3.25px]"
          )}
        />
        <span
          className={cn(
            "w-4 h-[1.5px] bg-text-2 transition-all duration-200",
            mobileOpen && "-rotate-45 -translate-y-[3.25px]"
          )}
        />
      </button>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="absolute top-full left-0 right-0 bg-bg border-b border-border-soft md:hidden">
          <div className="flex flex-col px-6 sm:px-10 py-4 gap-3">
            {navLinks.map((link) => (
              <a
                key={link.key}
                href={link.href.startsWith("/#") ? link.href : `/${locale}${link.href}`}
                className="text-[14px] text-text-2 hover:text-text py-1"
                onClick={() => setMobileOpen(false)}
              >
                {t(link.key)}
              </a>
            ))}
            <div className="flex items-center gap-4 pt-2 border-t border-border-soft mt-1">
              <LocaleSwitcher />
              <Link
                href="/login?mode=login"
                className="text-[14px] text-text-2"
                onClick={() => setMobileOpen(false)}
              >
                {t("signIn")}
              </Link>
              <Link
                href="/login?mode=signup"
                className="inline-flex items-center justify-center bg-[#ededec] text-[#0a0a0a] px-4 py-2 rounded-[7px] font-medium text-[14px]"
                onClick={() => setMobileOpen(false)}
              >
                {t("startFree")}
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
