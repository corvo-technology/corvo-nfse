// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
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
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cookie consent", () => {
  it("denies by default: no stored decision means null, not accepted", async () => {
    const { useCookieConsent } = await freshConsentModule();
    const { result } = renderHook(() => useCookieConsent());
    expect(result.current).toBeNull();
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

  it("rejectCookies stores 'rejected' and clears any pending CompleteRegistration flag", async () => {
    localStorage.setItem("corvo_cr_pending", "evt-1");
    const { rejectCookies } = await freshConsentModule();
    rejectCookies();
    expect(localStorage.getItem("corvo_cookie_consent")).toBe("rejected");
    expect(localStorage.getItem("corvo_cr_pending")).toBeNull();
  });
});
