"use client";

import { useEffect } from "react";
import { useCookieConsent } from "@/lib/consent";
import { consumePendingCompleteRegistration } from "@/lib/complete-registration";
import { trackMeta } from "@/components/MetaPixel";

/** Fires CompleteRegistration once, on the first consented /app load after signup. */
export function useCompleteRegistration(): void {
  const consent = useCookieConsent();

  useEffect(() => {
    if (consent !== "accepted") return;
    const eventId = consumePendingCompleteRegistration();
    if (eventId) trackMeta("CompleteRegistration", {}, eventId);
  }, [consent]);
}
