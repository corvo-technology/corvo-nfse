/**
 * Namespaces that client components under app/[locale] read with useTranslations.
 * Only these are sent to the browser: the full catalog (dashboard, legal text,
 * API errors, ...) is over 180 KB and would be inlined into every page's HTML.
 * Server components read the catalog directly and do not need this list.
 *
 * When a client component under app/[locale] starts using a new namespace, add
 * it here; tests/client-messages.test.ts fails otherwise.
 */
export const CLIENT_NAMESPACES = [
  "Common",
  "Nav",
  "Language",
  "Hero",
  "Dashboard",
  "Flow",
  "FreeTrial",
  "Pricing",
  "Credits",
  "LandingAgents",
  "LandingSdks",
  "CookieConsent",
  "Support",
] as const;

export function pickClientMessages<T extends Record<string, unknown>>(messages: T): Partial<T> {
  const picked: Record<string, unknown> = {};
  for (const namespace of CLIENT_NAMESPACES) {
    if (namespace in messages) picked[namespace] = messages[namespace];
  }
  return picked as Partial<T>;
}
