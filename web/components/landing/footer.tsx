"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";

export function Footer() {
  const t = useTranslations("Footer");
  const locale = useLocale();

  return (
    <footer className="border-t border-border-soft px-6 sm:px-10 py-7">
      <div className="max-w-[1120px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        {/* Brand + links */}
        <div className="flex flex-col gap-4">
          <span className="font-mono text-xs text-text-4">
            {t("brand")}
          </span>
          <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-text-4">
            <Link
              href={`/${locale}#features`}
              className="hover:text-text-2 transition-colors"
            >
              {t("features")}
            </Link>
            <Link
              href="#pricing"
              className="hover:text-text-2 transition-colors"
            >
              {t("pricing")}
            </Link>
            <Link
              href={`/${locale}/docs`}
              className="hover:text-text-2 transition-colors"
            >
              {t("docs")}
            </Link>
            <Link
              href={`/${locale}/terms`}
              className="hover:text-text-2 transition-colors"
            >
              {t("terms")}
            </Link>
            <Link
              href={`/${locale}/privacy`}
              className="hover:text-text-2 transition-colors"
            >
              {t("privacy")}
            </Link>
            <Link
              href={`/${locale}/security`}
              className="hover:text-text-2 transition-colors"
            >
              {t("security")}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
