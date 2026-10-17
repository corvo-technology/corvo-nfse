"use client";

import { useEffect } from "react";
import { useCookieConsent } from "@/lib/consent";
import { useAuth } from "@/lib/auth";
import { auth } from "@/lib/api";
import { readFbp, readStoredAttribution } from "@/lib/attribution";
import { trackMeta } from "@/components/MetaPixel";

function flagKey(tenantId: string): string {
  return `corvo_cr_${tenantId}`;
}

/**
 * Fires CompleteRegistration once per tenant, on the first authenticated
 * load of /app after signup. Consent-gated; any failure is silent so it
 * never affects the dashboard, and a failed attempt retries on next mount.
 */
export function useSignupAttribution(): void {
  const consent = useCookieConsent();
  const { isAuthenticated, tenantId } = useAuth();

  useEffect(() => {
    if (consent !== "accepted" || !isAuthenticated || !tenantId) return;
    const key = flagKey(tenantId);
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      return;
    }

    let cancelled = false;
    void (async () => {
      const stored = readStoredAttribution();
      const eventId = crypto.randomUUID();
      try {
        const result = await auth.signupAttribution({
          eventId,
          consent: true,
          utm: stored?.utm,
          fbclid: stored?.fbclid,
          fbc: stored?.fbc,
          fbp: readFbp(),
          landingUrl: stored?.landingUrl,
          eventSourceUrl: window.location.href,
        });
        if (cancelled) return;
        try {
          localStorage.setItem(key, "1");
        } catch {}
        if (result.recorded) trackMeta("CompleteRegistration", {}, eventId);
      } catch {
        // Silent: retried on the next authenticated mount.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [consent, isAuthenticated, tenantId]);
}
