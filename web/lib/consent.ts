"use client";
import { useSyncExternalStore } from "react";
const key = "corvo_cookie_consent";
function subscribe(listener: () => void) { window.addEventListener("storage", listener); window.addEventListener("corvo-consent", listener); return () => { window.removeEventListener("storage", listener); window.removeEventListener("corvo-consent", listener); }; }
function snapshot() { try { return localStorage.getItem(key) === "accepted"; } catch { return false; } }
export function useCookieConsent() { return useSyncExternalStore(subscribe, snapshot, () => false); }
export function acceptCookies() { try { localStorage.setItem(key, "accepted"); } catch {} window.dispatchEvent(new Event("corvo-consent")); }
