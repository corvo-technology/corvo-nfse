// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ consent: "accepted" as "accepted" | "rejected" | null }));

vi.mock("@/lib/consent", () => ({ useCookieConsent: () => state.consent }));

const trackMetaMock = vi.fn();
vi.mock("@/components/MetaPixel", () => ({ trackMeta: (...args: unknown[]) => trackMetaMock(...args) }));

import { useCompleteRegistration } from "@/lib/use-complete-registration";
import { markPendingCompleteRegistration, clearCompleteRegistrationFlags } from "@/lib/complete-registration";

beforeEach(() => {
  localStorage.clear();
  trackMetaMock.mockReset();
  state.consent = "accepted";
});

afterEach(() => {
  cleanup();
});

describe("useCompleteRegistration", () => {
  it("fires CompleteRegistration once when a pending flag exists and consent is accepted", async () => {
    markPendingCompleteRegistration("evt-1");
    renderHook(() => useCompleteRegistration());
    await waitFor(() => expect(trackMetaMock).toHaveBeenCalledTimes(1));
    expect(trackMetaMock).toHaveBeenCalledWith("CompleteRegistration", {}, "evt-1");
    expect(localStorage.getItem("corvo_cr_pending")).toBeNull();
    expect(localStorage.getItem("corvo_cr_done")).toBe("1");
  });

  it("does nothing without a pending flag", async () => {
    renderHook(() => useCompleteRegistration());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(trackMetaMock).not.toHaveBeenCalled();
  });

  it("does nothing without consent, even with a pending flag", async () => {
    state.consent = null;
    markPendingCompleteRegistration("evt-1");
    renderHook(() => useCompleteRegistration());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(trackMetaMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("corvo_cr_pending")).toBe("evt-1");
  });

  it("never fires twice, even across remounts", async () => {
    markPendingCompleteRegistration("evt-1");
    const { unmount } = renderHook(() => useCompleteRegistration());
    await waitFor(() => expect(trackMetaMock).toHaveBeenCalledTimes(1));
    unmount();

    markPendingCompleteRegistration("evt-2");
    renderHook(() => useCompleteRegistration());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(trackMetaMock).toHaveBeenCalledTimes(1);
  });

  it("clearCompleteRegistrationFlags removes both the pending and done flags", () => {
    markPendingCompleteRegistration("evt-1");
    localStorage.setItem("corvo_cr_done", "1");
    clearCompleteRegistrationFlags();
    expect(localStorage.getItem("corvo_cr_pending")).toBeNull();
    expect(localStorage.getItem("corvo_cr_done")).toBeNull();
  });
});
