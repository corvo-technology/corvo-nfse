// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ consent: "accepted" as "accepted" | "rejected" | null }));

vi.mock("@/lib/consent", () => ({ useCookieConsent: () => state.consent }));

const trackMetaMock = vi.fn();
vi.mock("@/components/MetaPixel", () => ({ trackMeta: (...args: unknown[]) => trackMetaMock(...args) }));

import { useCompleteRegistration } from "@/lib/use-complete-registration";
import { markPendingCompleteRegistration, clearCompleteRegistrationFlags } from "@/lib/complete-registration";

function setFbq(fn: ((...args: unknown[]) => void) | undefined) {
  (window as unknown as { fbq?: typeof fn }).fbq = fn;
}

beforeEach(() => {
  localStorage.clear();
  trackMetaMock.mockReset();
  state.consent = "accepted";
  setFbq(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setFbq(undefined);
});

describe("useCompleteRegistration", () => {
  it("fires CompleteRegistration once when a pending flag exists, consent is accepted and fbq is already there", async () => {
    setFbq(vi.fn());
    markPendingCompleteRegistration("evt-1");
    renderHook(() => useCompleteRegistration());
    await waitFor(() => expect(trackMetaMock).toHaveBeenCalledTimes(1));
    expect(trackMetaMock).toHaveBeenCalledWith("CompleteRegistration", {}, "evt-1");
    expect(localStorage.getItem("corvo_cr_pending")).toBeNull();
    expect(localStorage.getItem("corvo_cr_done")).toBe("1");
  });

  it("does nothing without a pending flag", async () => {
    setFbq(vi.fn());
    renderHook(() => useCompleteRegistration());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(trackMetaMock).not.toHaveBeenCalled();
  });

  it("does nothing without consent, even with a pending flag", async () => {
    setFbq(vi.fn());
    state.consent = null;
    markPendingCompleteRegistration("evt-1");
    renderHook(() => useCompleteRegistration());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(trackMetaMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("corvo_cr_pending")).toBe("evt-1");
  });

  it("never fires twice, even across remounts", async () => {
    setFbq(vi.fn());
    markPendingCompleteRegistration("evt-1");
    const { unmount } = renderHook(() => useCompleteRegistration());
    await waitFor(() => expect(trackMetaMock).toHaveBeenCalledTimes(1));
    unmount();

    markPendingCompleteRegistration("evt-2");
    renderHook(() => useCompleteRegistration());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(trackMetaMock).toHaveBeenCalledTimes(1);
  });

  it("waits for window.fbq to appear before consuming the flag, instead of losing the event on a hard /app load", () => {
    vi.useFakeTimers();
    markPendingCompleteRegistration("evt-1");
    renderHook(() => useCompleteRegistration());

    // fbq hasn't loaded yet: the flag must stay untouched, not be consumed against a missing fbq.
    expect(trackMetaMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("corvo_cr_pending")).toBe("evt-1");

    vi.advanceTimersByTime(750);
    expect(trackMetaMock).not.toHaveBeenCalled();

    // The Pixel's afterInteractive <Script> finally ran.
    setFbq(vi.fn());
    vi.advanceTimersByTime(250);

    expect(trackMetaMock).toHaveBeenCalledTimes(1);
    expect(trackMetaMock).toHaveBeenCalledWith("CompleteRegistration", {}, "evt-1");
    expect(localStorage.getItem("corvo_cr_pending")).toBeNull();
    expect(localStorage.getItem("corvo_cr_done")).toBe("1");
  });

  it("gives up after ~10s if fbq never appears, leaving the flag unconsumed for the next mount", () => {
    vi.useFakeTimers();
    markPendingCompleteRegistration("evt-1");
    renderHook(() => useCompleteRegistration());

    vi.advanceTimersByTime(11_000);

    expect(trackMetaMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("corvo_cr_pending")).toBe("evt-1");
    expect(localStorage.getItem("corvo_cr_done")).toBeNull();
  });

  it("clearCompleteRegistrationFlags removes both the pending and done flags", () => {
    markPendingCompleteRegistration("evt-1");
    localStorage.setItem("corvo_cr_done", "1");
    clearCompleteRegistrationFlags();
    expect(localStorage.getItem("corvo_cr_pending")).toBeNull();
    expect(localStorage.getItem("corvo_cr_done")).toBeNull();
  });
});
