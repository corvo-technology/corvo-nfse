"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("Language");

  const switchLocale = () => {
    const next = locale === "en" ? "pt" : "en";

    // Persist preference
    localStorage.setItem("locale", next);
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=${30 * 24 * 60 * 60}`;

    // Check if current path has locale prefix (landing pages)
    const hasLocalePrefix = /^\/(en|pt)(\/|$)/.test(pathname);

    if (hasLocalePrefix) {
      const newPath = pathname.replace(/^\/(en|pt)/, `/${next}`);
      router.push(newPath);
    } else {
      // Dashboard paths — cookie is set, reload to apply
      window.location.reload();
    }
  };

  return (
    <button
      onClick={switchLocale}
      className="flex min-h-9 min-w-9 items-center justify-center font-mono text-[11px] text-text-2 border border-border-strong rounded-[6px] px-2.5 hover:text-text hover:border-text-4 transition-colors cursor-pointer"
      aria-label={`Switch to ${locale === "en" ? "Portuguese" : "English"}`}
    >
      {locale === "en" ? t("pt") : t("en")}
    </button>
  );
}
