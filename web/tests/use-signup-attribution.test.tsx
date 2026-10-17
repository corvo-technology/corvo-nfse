// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  consent: "accepted" as "accepted" | "rejected" | null,
  isAuthenticated: true,
  tenantId: "tenant-1" as string | null,
}));

vi.mock("@/lib/consent", () => ({ useCookieConsent: () => state.consent }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ isAuthenticated: state.isAuthenticated, tenantId: state.tenantId }),
}));

const signupAttributionMock = vi.fn();
vi.mock("@/lib/api", () => ({ auth: { signupAttribution: (...args: unknown[]) => signupAttributionMock(...args) } }));

const trackMetaMock = vi.fn();
vi.mock("@/components/MetaPixel", () => ({ trackMeta: (...args: unknown[]) => trackMetaMock(...args) }));

import { useSignupAttribution } from "@/lib/use-signup-attribution";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  signupAttributionMock.mockReset();
  trackMetaMock.mockReset();
  state.consent = "accepted";
  state.isAuthenticated = true;
  state.tenantId = "tenant-1";
});

afterEach(() => {
  cleanup();
});

describe("useSignupAttribution", () => {
  it("fires CompleteRegistration only when the server reports recorded:true", async () => {
    signupAttributionMock.mockResolvedValue({ recorded: true });
    renderHook(() => useSignupAttribution());
    await waitFor(() => expect(signupAttributionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(trackMetaMock).toHaveBeenCalledTimes(1));
    expect(trackMetaMock).toHaveBeenCalledWith(
      "CompleteRegistration",
      {},
      expect.any(String),
    );
  });

  it("does not fire CompleteRegistration when recorded:false", async () => {
    signupAttributionMock.mockResolvedValue({ recorded: false });
    renderHook(() => useSignupAttribution());
    await waitFor(() => expect(signupAttributionMock).toHaveBeenCalledTimes(1));
    expect(trackMetaMock).not.toHaveBeenCalled();
  });

  it("sets the per-tenant flag and never calls the endpoint again on remount", async () => {
    signupAttributionMock.mockResolvedValue({ recorded: true });
    const { unmount } = renderHook(() => useSignupAttribution());
    await waitFor(() => expect(signupAttributionMock).toHaveBeenCalledTimes(1));
    unmount();

    renderHook(() => useSignupAttribution());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signupAttributionMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("corvo_cr_tenant-1")).toBe("1");
  });

  it("does nothing without consent", async () => {
    state.consent = null;
    renderHook(() => useSignupAttribution());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signupAttributionMock).not.toHaveBeenCalled();
  });

  it("does nothing when unauthenticated", async () => {
    state.isAuthenticated = false;
    renderHook(() => useSignupAttribution());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signupAttributionMock).not.toHaveBeenCalled();
  });
});
