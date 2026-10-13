/**
 * Locale-aware timeAgo helper.
 * Usage: timeAgo(dateStr, t) where t is useTranslations("Common")
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function timeAgo(dateStr: string, t: any): string {
  if (!dateStr) return t("never") ?? "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return t("justNow");
  if (minutes < 60) return t("minutesAgo", { n: minutes });
  if (hours < 24) return t("hoursAgo", { n: hours });
  return t("daysAgo", { n: days });
}

/**
 * Locale-aware date formatter.
 * Usage: formatDate(dateStr, locale) where locale is useLocale()
 */
export function formatDate(dateStr: string, locale: string): string {
  return new Date(dateStr).toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Locale-aware relative time for detail views (e.g., "Delivered in 340ms")
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
