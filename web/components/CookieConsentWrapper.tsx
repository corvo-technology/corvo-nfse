"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { GoogleAnalytics } from "./GoogleAnalytics";
import { MetaPixel } from "./MetaPixel";
import { CookieConsent } from "@/components/ui/cookie-consent";
import { useCookieConsent } from "@/lib/consent";
import { captureAttributionCandidate } from "@/lib/attribution";

export function CookieConsentWrapper() {
  const consent = useCookieConsent();
  const pathname = usePathname();
  const documentOrAccount = /^\/(?:en\/|pt\/)?(?:login|app|terms|privacy|dpa|security)(?:\/|$)/.test(pathname);

  // Runs on every page, with or without consent: it only stages data in
  // sessionStorage until promoteAttributionOnConsent() is called on accept.
  useEffect(() => {
    captureAttributionCandidate();
  }, []);

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
