// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/lib/auth";
import { setCsrfToken } from "@/lib/api";
import { session } from "./fixtures";
const fetchMock = vi.fn<typeof fetch>();
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
beforeEach(() => { setCsrfToken(null); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("BroadcastChannel", undefined); vi.stubGlobal("localStorage", window.localStorage); vi.stubGlobal("sessionStorage", window.sessionStorage); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("expõe isPlatformAdmin da sessão e o mantém após switchTenant", async () => {
  fetchMock.mockResolvedValueOnce(reply({ data: { ...session, isPlatformAdmin: true } }));
  const { result } = renderHook(useAuth, { wrapper });
  await waitFor(() => expect(result.current.status).toBe("authenticated"));
  expect(result.current.isPlatformAdmin).toBe(true);
  fetchMock.mockResolvedValueOnce(reply({ data: { ...session, isPlatformAdmin: true, activeTenantId: "tenant-2", csrfToken: "c2" } }));
  await act(() => result.current.switchTenant("tenant-2"));
  expect(result.current.isPlatformAdmin).toBe(true);
});
it("isPlatformAdmin é false quando a sessão não traz a flag", async () => {
  fetchMock.mockResolvedValueOnce(reply({ data: session }));
  const { result } = renderHook(useAuth, { wrapper });
  await waitFor(() => expect(result.current.status).toBe("authenticated"));
  expect(result.current.isPlatformAdmin).toBe(false);
});
