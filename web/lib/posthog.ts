/**
 * posthog-js is about 120 KB gzipped, so it stays out of the first load: it is
 * fetched and initialised once the browser is idle (or after a short delay).
 * Calls made before that wait for it, so nothing is lost.
 */
type PostHog = typeof import("posthog-js").default;

const key = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

export const posthogConfigured = Boolean(key && host);

let loaded: Promise<PostHog> | null = null;

/** Loads and initialises PostHog once. Resolves to null when it is not configured. */
export function loadPostHog(): Promise<PostHog | null> {
  if (!posthogConfigured || typeof window === "undefined") return Promise.resolve(null);
  loaded ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(key!, {
      api_host: host,
      defaults: "2026-05-30",
      capture_exceptions: true,
      debug: process.env.NODE_ENV === "development",
    });
    return posthog;
  });
  return loaded;
}

/** Runs `fn` with PostHog as soon as it is available. Never throws into the caller. */
export function withPostHog(fn: (posthog: PostHog) => void): void {
  void loadPostHog()
    .then((posthog) => {
      if (posthog) fn(posthog);
    })
    .catch(() => {});
}

/** Starts loading PostHog when the main thread is idle. */
export function loadPostHogWhenIdle(): void {
  if (!posthogConfigured || typeof window === "undefined") return;
  const start = () => void loadPostHog().catch(() => {});
  if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 4000 });
  else setTimeout(start, 2000);
}
