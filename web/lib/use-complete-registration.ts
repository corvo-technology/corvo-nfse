"use client";

import { useEffect } from "react";
import { useCookieConsent } from "@/lib/consent";
import { hasPendingCompleteRegistration, consumePendingCompleteRegistration } from "@/lib/complete-registration";
import { trackMeta } from "@/components/MetaPixel";
import { waitForFbq } from "@/lib/wait-for-fbq";

/**
 * Fires CompleteRegistration once, on the first consented /app load after
 * signup. Waits for window.fbq before consuming the pending flag: on a hard
 * /app load this effect can run before the Pixel's afterInteractive <Script>
 * has executed, and consuming the flag against a not-yet-loaded fbq would
 * lose the event for good (trackMeta no-ops silently).
 */
export function useCompleteRegistration(): void {
  const consent = useCookieConsent();

  useEffect(() => {
    if (consent !== "accepted" || !hasPendingCompleteRegistration()) return;
    return waitForFbq(() => {
      const eventId = consumePendingCompleteRegistration();
      if (eventId) trackMeta("CompleteRegistration", {}, eventId);
    });
  }, [consent]);
}
