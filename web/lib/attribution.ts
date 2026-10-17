"use client";

const PENDING_KEY = "corvo_attribution_pending";
const STORED_KEY = "corvo_attribution";
const TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface AttributionUtm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

interface PendingAttribution {
  utm: AttributionUtm;
  fbclid?: string;
  landingUrl: string;
}

export interface StoredAttribution {
  utm: AttributionUtm;
  fbclid?: string;
  fbc?: string;
  landingUrl: string;
  capturedAt: number;
}

const UTM_PARAM_BY_KEY: Record<keyof AttributionUtm, string> = {
  source: "utm_source",
  medium: "utm_medium",
  campaign: "utm_campaign",
  term: "utm_term",
  content: "utm_content",
};

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function utmFromSearch(search: URLSearchParams): AttributionUtm {
  const utm: AttributionUtm = {};
  for (const [key, param] of Object.entries(UTM_PARAM_BY_KEY) as [
    keyof AttributionUtm,
    string,
  ][]) {
    const value = search.get(param);
    if (value) utm[key] = value;
  }
  return utm;
}

/** First touch within the session: call on every page load, consent or not. */
export function captureAttributionCandidate(): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(PENDING_KEY)) return;
    const search = new URLSearchParams(window.location.search);
    const utm = utmFromSearch(search);
    const fbclid = search.get("fbclid") ?? undefined;
    if (Object.keys(utm).length === 0 && !fbclid) return;
    const pending: PendingAttribution = { utm, fbclid, landingUrl: window.location.href };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {}
}

/** Promotes the pending capture into the consented, durable store. First touch wins. */
export function promoteAttributionOnConsent(): void {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(STORED_KEY)) return;
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const pending = JSON.parse(raw) as PendingAttribution;
    const fbc =
      readCookie("_fbc") ??
      (pending.fbclid ? `fb.1.${Date.now()}.${pending.fbclid}` : undefined);
    const stored: StoredAttribution = {
      utm: pending.utm,
      fbclid: pending.fbclid,
      fbc,
      landingUrl: pending.landingUrl,
      capturedAt: Date.now(),
    };
    localStorage.setItem(STORED_KEY, JSON.stringify(stored));
  } catch {}
}

export function readStoredAttribution(): StoredAttribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORED_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredAttribution;
    if (Date.now() - stored.capturedAt > TTL_MS) {
      localStorage.removeItem(STORED_KEY);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

export function readFbp(): string | undefined {
  return readCookie("_fbp");
}

export function clearAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PENDING_KEY);
    localStorage.removeItem(STORED_KEY);
  } catch {}
}
