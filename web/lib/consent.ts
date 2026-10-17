"use client";
import { useSyncExternalStore } from "react";
import { clearCompleteRegistrationFlags } from "@/lib/complete-registration";

export type CookieConsentState = "accepted" | "rejected" | null;

const KEY = "corvo_cookie_consent";
const EVENT = "corvo-consent";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(EVENT, listener);
  };
}

function snapshot(): CookieConsentState {
  try {
    const value = localStorage.getItem(KEY);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    return null;
  }
}

// Deny-by-default: no stored decision means the Pixel does not run.
export function useCookieConsent(): CookieConsentState {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

function setConsent(value: CookieConsentState) {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function acceptCookies() {
  setConsent("accepted");
}

export function rejectCookies() {
  clearCompleteRegistrationFlags();
  setConsent("rejected");
}

/**
 * fbevents.js (and gtag.js) write _fbp/_fbc/_ga* with `domain=.<registrable-domain>`,
 * so a bare `path=/` delete only removes a host-only cookie that was never set and
 * leaves the real one behind. Sweep the host and every parent domain suffix; the
 * browser silently ignores attempts on domains it doesn't own (e.g. a public TLD).
 */
function clearCookie(name: string) {
  const host = window.location.hostname;
  const parts = host.split(".");
  const domains = new Set<string | undefined>([undefined, host]);
  for (let i = parts.length - 2; i >= 0; i--) {
    domains.add("." + parts.slice(i).join("."));
  }
  for (const domain of domains) {
    document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ""}`;
  }
}

function clearCookiesByPrefix(prefix: string) {
  for (const entry of document.cookie.split(";")) {
    const name = entry.split("=")[0]?.trim();
    if (name?.startsWith(prefix)) clearCookie(name);
  }
}

/**
 * Undoes a prior "accepted" decision: clears the Meta and GA cookies and the
 * pending CompleteRegistration flags, tells the Pixel to revoke consent, and
 * reloads so already injected scripts (which cannot be unloaded without a
 * reload) are dropped.
 */
export function revokeConsent() {
  try {
    clearCookie("_fbp");
    clearCookie("_fbc");
    clearCookiesByPrefix("_ga");
  } catch {}
  clearCompleteRegistrationFlags();
  try {
    window.fbq?.("consent", "revoke");
  } catch {}
  setConsent(null);
  window.location.reload();
}
