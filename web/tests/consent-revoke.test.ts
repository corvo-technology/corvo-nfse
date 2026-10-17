// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://app.corvo.tech/"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fbevents.js and gtag.js write these cookies with `domain=.<registrable-domain>`,
// not host-only. A plain `localhost` run can't reproduce the bug this guards against:
// jsdom/tough-cookie treat host-only `localhost` and `.localhost` as the same cookie
// jar entry, so even a `path=/`-only delete happens to clear it there. On a real host
// like `app.corvo.tech` that's no longer true, which is why this test pins the URL.
async function freshConsentModule() {
  vi.resetModules();
  return import("@/lib/consent");
}

beforeEach(() => {
  localStorage.clear();
  document.cookie.split(";").forEach((entry) => {
    const name = entry.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/; domain=.corvo.tech`;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cookie consent: revoke on a real registrable domain", () => {
  it("revokeConsent clears _fbp/_fbc/_ga cookies set with domain=.corvo.tech, tells the Pixel to revoke, resets to null and reloads", async () => {
    document.cookie = "_fbp=fb.1.111.222; path=/; domain=.corvo.tech";
    document.cookie = "_fbc=fb.1.111.333; path=/; domain=.corvo.tech";
    document.cookie = "_ga=GA1.1.111.222; path=/; domain=.corvo.tech";
    document.cookie = "_ga_ABC123=GS1.1.111; path=/; domain=.corvo.tech";
    localStorage.setItem("corvo_cookie_consent", "accepted");
    localStorage.setItem("corvo_cr_pending", "evt-1");

    // Pre-condition: without this, the `not.toContain` assertions below would
    // pass even if the cookies were never cleared (or never created).
    expect(document.cookie).toContain("_fbp=fb.1.111.222");
    expect(document.cookie).toContain("_fbc=fb.1.111.333");
    expect(document.cookie).toContain("_ga=GA1.1.111.222");
    expect(document.cookie).toContain("_ga_ABC123=GS1.1.111");

    const fbq = vi.fn();
    (window as unknown as { fbq?: typeof fbq }).fbq = fbq;

    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      writable: true,
    });

    const { revokeConsent } = await freshConsentModule();
    revokeConsent();

    expect(document.cookie).not.toContain("_fbp=fb.1.111.222");
    expect(document.cookie).not.toContain("_fbc=fb.1.111.333");
    expect(document.cookie).not.toContain("_ga=GA1.1.111.222");
    expect(document.cookie).not.toContain("_ga_ABC123=GS1.1.111");
    expect(localStorage.getItem("corvo_cr_pending")).toBeNull();
    expect(localStorage.getItem("corvo_cookie_consent")).toBeNull();
    expect(fbq).toHaveBeenCalledWith("consent", "revoke");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
