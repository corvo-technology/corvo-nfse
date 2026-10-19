"use client";

import { useCallback, useEffect, useRef } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_WAIT_MS = 15_000;

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

/** False when no site key is configured: the login flow then skips the human check. */
export const turnstileEnabled = Boolean(SITE_KEY);

let scriptPromise: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC; script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile unavailable")));
    script.onerror = () => { scriptPromise = null; reject(new Error("turnstile failed to load")); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Cloudflare Turnstile in "interaction-only" mode: the check runs invisibly and the widget
 * only appears inside `containerRef` when Cloudflare needs the visitor to prove they are human.
 */
export function useTurnstile(action: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const token = useRef<string | null>(null);
  const waiters = useRef<Array<(value: string | null) => void>>([]);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;
    const settle = (value: string | null) => {
      token.current = value;
      if (value) for (const resolve of waiters.current.splice(0)) resolve(value);
    };
    void loadTurnstile().then((api) => {
      if (cancelled || !containerRef.current) return;
      widgetId.current = api.render(containerRef.current, {
        sitekey: SITE_KEY, action, appearance: "interaction-only", size: "flexible",
        callback: (value: string) => settle(value),
        "expired-callback": () => settle(null),
        "error-callback": () => settle(null),
      });
    }).catch(() => settle(null));
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined; token.current = null;
    };
  }, [action]);

  /** Resolves with a fresh single-use token, or null if the check did not finish in time. */
  const getToken = useCallback((): Promise<string | null> => {
    if (token.current) return Promise.resolve(token.current);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), TOKEN_WAIT_MS);
      waiters.current.push((value) => { clearTimeout(timer); resolve(value); });
    });
  }, []);

  /** Tokens are single-use: call after each verification to get the next one. */
  const reset = useCallback(() => {
    token.current = null;
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, []);

  return { containerRef, getToken, reset };
}
