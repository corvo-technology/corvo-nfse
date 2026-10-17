"use client";
import { usePathname } from "next/navigation";
import { GoogleAnalytics } from "./GoogleAnalytics";
import { MetaPixel } from "./MetaPixel";
import { CookieConsent } from "@/components/ui/cookie-consent";
import { useCookieConsent } from "@/lib/consent";

export function CookieConsentWrapper() {
  const consent = useCookieConsent();
  const pathname = usePathname();
  const documentOrAccount = /^\/(?:en\/|pt\/)?(?:login|app|terms|privacy|dpa|security)(?:\/|$)/.test(pathname);

  if (consent === "accepted") {
    return (
      <>
        <GoogleAnalytics />
        <MetaPixel />
      </>
    );
  }

  // Keep account access and legal documents readable before an explicit decision.
  if (consent === null && !documentOrAccount) return <CookieConsent />;
  return null;
}
