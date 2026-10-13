"use client";
import { usePathname } from "next/navigation";
import { GoogleAnalytics } from "./GoogleAnalytics";
import { CookieConsent } from "@/components/ui/cookie-consent";
import { useCookieConsent } from "@/lib/consent";

export function CookieConsentWrapper() {
  const consent = useCookieConsent();
  const pathname = usePathname();
  const documentOrAccount = /^\/(?:en\/|pt\/)?(?:login|app|terms|privacy|dpa|security)(?:\/|$)/.test(pathname);

  // Keep account access and legal documents readable before optional consent.
  if (!consent && documentOrAccount) return null;
  return consent ? <GoogleAnalytics /> : <CookieConsent />;
}
