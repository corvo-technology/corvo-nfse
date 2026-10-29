"use client";

const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 10_000;

/**
 * Runs `callback` once `window.fbq` exists. The Pixel's `afterInteractive`
 * <Script> assigns it synchronously when it runs, but on a hard page load
 * an effect can mount before that script has executed; firing against a
 * missing fbq is a silent no-op (see MetaPixel.trackMeta), so poll briefly
 * instead of acting too early. Gives up after ~10s. Returns a cancel function.
 */
export function waitForFbq(callback: () => void): () => void {
  if (typeof window.fbq === "function") {
    callback();
    return () => {};
  }

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  const attempt = () => {
    if (cancelled) return;
    if (typeof window.fbq === "function") {
      callback();
      return;
    }
    if (Date.now() < deadline) timer = setTimeout(attempt, POLL_INTERVAL_MS);
  };
  timer = setTimeout(attempt, POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
