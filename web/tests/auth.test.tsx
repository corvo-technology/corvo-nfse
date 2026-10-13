// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/lib/auth";
import { setCsrfToken, getCsrfToken } from "@/lib/api";
import { session } from "./fixtures";
const fetchMock = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
beforeEach(() => { setCsrfToken(null); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("BroadcastChannel", undefined); vi.stubGlobal("localStorage", window.localStorage); vi.stubGlobal("sessionStorage", window.sessionStorage); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("restores exclusively from the cookie session, clears old caches and keeps CSRF in memory", async () => {
  localStorage.setItem("corvo_user", JSON.stringify({ id: "forged-user" })); fetchMock.mockResolvedValue(reply({ data: session }));
  const { result } = renderHook(useAuth, { wrapper }); await waitFor(() => expect(result.current.status).toBe("authenticated"));
  expect(result.current.session?.context.authUserId).toBe("user-1"); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0); expect(getCsrfToken()).toBe("test-csrf");
  expect(result.current.can("nfse.invoices.issue")).toBe(true); expect(result.current.can("unknown.permission")).toBe(false);
});
it("distinguishes anonymous 401 from a service failure and can recover", async () => {
  fetchMock.mockResolvedValueOnce(reply({ message: "API unavailable" }, 502)).mockResolvedValueOnce(reply({ data: session }));
  const { result } = renderHook(useAuth, { wrapper }); await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.isAuthenticated).toBe(false); await act(() => result.current.refreshSession()); expect(result.current.status).toBe("authenticated");
});
it("does not trust an old cached identity when the server rejects its cookie", async () => {
  localStorage.setItem("corvo_user", JSON.stringify({ id: "fake", role: "admin" })); fetchMock.mockResolvedValue(reply({ message: "Expired" }, 401));
  const { result } = renderHook(useAuth, { wrapper }); await waitFor(() => expect(result.current.status).toBe("anonymous")); expect(result.current.tenantId).toBeNull();
});
it("verifies exactly once, ignores focus refresh during login and then loads the session", async () => {
  fetchMock.mockResolvedValueOnce(reply({}, 401));
  const { result } = renderHook(useAuth, { wrapper }); await waitFor(() => expect(result.current.status).toBe("anonymous"));
  let resolve!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise((r) => { resolve = r; })).mockResolvedValueOnce(reply({ data: session }));
  await act(async () => {
    const login = result.current.verifyCode("person@example.com", "challenge-1", "123456");
    window.dispatchEvent(new Event("focus")); resolve(reply({ data: { csrfToken: "issued" } })); await login;
  });
  expect(fetchMock).toHaveBeenCalledTimes(3); expect(result.current.status).toBe("authenticated"); expect(getCsrfToken()).toBe("test-csrf");
});
it("recovers a created cookie after the next session request fails without replaying OTP", async () => {
  fetchMock.mockResolvedValueOnce(reply({}, 401)).mockResolvedValueOnce(reply({ data: { csrfToken: "issued" } })).mockRejectedValueOnce(new Error("network"));
  const { result } = renderHook(useAuth, { wrapper }); await waitFor(() => expect(result.current.status).toBe("anonymous"));
  const issued = vi.fn(); await act(async () => { await expect(result.current.verifyCode("person@example.com", "challenge", "123456", issued)).rejects.toMatchObject({ status: 0 }); });
  expect(issued).toHaveBeenCalledOnce(); fetchMock.mockResolvedValueOnce(reply({ data: session })); await act(() => result.current.refreshSession());
  expect(result.current.status).toBe("authenticated"); expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/verify"))).toHaveLength(1);
});
it("retains a session on failed logout and clears it only after revocation succeeds", async () => {
  fetchMock.mockResolvedValueOnce(reply({ data: session })); const { result } = renderHook(useAuth, { wrapper }); await waitFor(() => expect(result.current.status).toBe("authenticated"));
  fetchMock.mockRejectedValueOnce(new Error("offline")); await act(async () => { await expect(result.current.logout()).rejects.toMatchObject({ status: 0 }); }); expect(result.current.status).toBe("authenticated");
  fetchMock.mockResolvedValueOnce(reply(null, 204)); await act(() => result.current.logout()); expect(result.current.status).toBe("anonymous"); expect(getCsrfToken()).toBeNull();
});
it("replaces tenant, permissions and CSRF with the switch response", async () => {
  fetchMock.mockResolvedValueOnce(reply({ data: session })); const { result } = renderHook(useAuth, { wrapper }); await waitFor(() => expect(result.current.status).toBe("authenticated"));
  fetchMock.mockResolvedValueOnce(reply({ data: { ...session, activeTenantId: "tenant-2", permissions: ["billing.view"], csrfToken: "new-csrf" } }));
  await act(() => result.current.switchTenant("tenant-2")); expect(result.current.tenantId).toBe("tenant-2"); expect(result.current.can("nfse.invoices.issue")).toBe(false); expect(getCsrfToken()).toBe("new-csrf");
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ tenantId: "tenant-2" });
});
