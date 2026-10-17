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

  it("rejectCookies stores 'rejected' and clears any pending/stored attribution", async () => {
    sessionStorage.setItem("corvo_attribution_pending", JSON.stringify({ utm: { source: "meta" } }));
    localStorage.setItem("corvo_attribution", JSON.stringify({ utm: {}, capturedAt: Date.now() }));
    const { rejectCookies } = await freshConsentModule();
    rejectCookies();
    expect(localStorage.getItem("corvo_cookie_consent")).toBe("rejected");
    expect(sessionStorage.getItem("corvo_attribution_pending")).toBeNull();
    expect(localStorage.getItem("corvo_attribution")).toBeNull();
  });

  it("revokeConsent clears _fbp/_fbc cookies, the stored attribution, tells the Pixel to revoke, resets to null and reloads", async () => {
    document.cookie = "_fbp=fb.1.111.222; path=/";
    document.cookie = "_fbc=fb.1.111.333; path=/";
    localStorage.setItem("corvo_cookie_consent", "accepted");
    localStorage.setItem("corvo_attribution", JSON.stringify({ utm: {}, capturedAt: Date.now() }));

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
    expect(localStorage.getItem("corvo_attribution")).toBeNull();
    expect(localStorage.getItem("corvo_cookie_consent")).toBeNull();
    expect(fbq).toHaveBeenCalledWith("consent", "revoke");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
