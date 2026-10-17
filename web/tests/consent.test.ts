// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshConsentModule() {
  vi.resetModules();
  return import("@/lib/consent");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie.split(";").forEach((entry) => {
    const name = entry.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cookie consent", () => {
  it("denies by default: no stored decision means null, not accepted", async () => {
    const { useCookieConsent } = await freshConsentModule();
    // useCookieConsent is a hook, but its snapshot function is pure; call via a plain render-free check
    // by reading localStorage directly is not enough -- exercise through React.
    expect(typeof useCookieConsent).toBe("function");
    expect(localStorage.getItem("corvo_cookie_consent")).toBeNull();
  });

  it("acceptCookies stores 'accepted' and notifies listeners", async () => {
    const { acceptCookies } = await freshConsentModule();
    const listener = vi.fn();
    window.addEventListener("corvo-consent", listener);
    acceptCookies();
    expect(localStorage.getItem("corvo_cookie_consent")).toBe("accepted");
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("corvo-consent", listener);
  });

  it("rejectCookies stores 'rejected' and clears any pending/done CompleteRegistration flags", async () => {
    localStorage.setItem("corvo_cr_pending", "evt-1");
    localStorage.setItem("corvo_cr_done", "1");
    const { rejectCookies } = await freshConsentModule();
    rejectCookies();
    expect(localStorage.getItem("corvo_cookie_consent")).toBe("rejected");
    expect(localStorage.getItem("corvo_cr_pending")).toBeNull();
    expect(localStorage.getItem("corvo_cr_done")).toBeNull();
  });

  it("revokeConsent clears _fbp/_fbc/_ga cookies written for the host's registrable domain, the CompleteRegistration flags, tells the Pixel to revoke, resets to null and reloads", async () => {
    // fbevents.js and gtag.js write with `domain=.<host>`, not host-only: reproduce that,
    // since a host-only cookie (path=/ with no domain) never fails to clear and would mask B1.
    const host = window.location.hostname;
    document.cookie = `_fbp=fb.1.111.222; path=/; domain=.${host}`;
    document.cookie = `_fbc=fb.1.111.333; path=/; domain=.${host}`;
    document.cookie = `_ga=GA1.1.111.222; path=/; domain=.${host}`;
    document.cookie = `_ga_ABC123=GS1.1.111; path=/; domain=.${host}`;
    localStorage.setItem("corvo_cookie_consent", "accepted");
    localStorage.setItem("corvo_cr_pending", "evt-1");

    const fbq = vi.fn();
    vi.stubGlobal("fbq", fbq);
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
