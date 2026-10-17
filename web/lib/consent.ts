"use client";
import { useSyncExternalStore } from "react";
import { clearAttribution, promoteAttributionOnConsent } from "@/lib/attribution";

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

// Deny-by-default: no stored decision means neither Pixel nor CAPI runs.
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
  promoteAttributionOnConsent();
}

export function rejectCookies() {
  clearAttribution();
  setConsent("rejected");
}

function clearCookie(name: string) {
  document.cookie = `${name}=; Max-Age=0; path=/`;
}

/**
 * Undoes a prior "accepted" decision: clears the Meta cookies and the stored
 * attribution, tells the Pixel to revoke consent, and reloads so already
 * injected scripts (which cannot be unloaded without a reload) are dropped.
 */
export function revokeConsent() {
  try {
    clearCookie("_fbp");
    clearCookie("_fbc");
  } catch {}
  clearAttribution();
  try {
    window.fbq?.("consent", "revoke");
  } catch {}
  setConsent(null);
  window.location.reload();
}
