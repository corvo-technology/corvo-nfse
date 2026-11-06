// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboarding } from "@/lib/use-onboarding";

const mocks = vi.hoisted(() => ({
  companies: vi.fn(), certificates: vi.fn(), sequence: vi.fn(), invoices: vi.fn(),
  auth: { env: "test" as "test" | "live", permissions: ["nfse.companies.manage", "nfse.certificates.manage", "nfse.invoices.issue"] },
}));
vi.mock("@/lib/api", () => ({
  companies: { list: mocks.companies, dpsSequence: mocks.sequence },
  certificates: { list: mocks.certificates },
  invoices: { list: mocks.invoices },
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ tenantId: "t1", fiscalEnvironment: mocks.auth.env, can: (p: string) => mocks.auth.permissions.includes(p) }),
}));

const page = <T,>(items: T[]) => ({ items, hasMore: false, nextCursor: null });
const company = (id: string, createdAt: string) => ({ id, createdAt });
const stepOf = (result: { current: ReturnType<typeof useOnboarding> }, key: string) => result.current.steps.find((s) => s.key === key);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.auth.env = "test";
  mocks.auth.permissions = ["nfse.companies.manage", "nfse.certificates.manage", "nfse.invoices.issue"];
  mocks.companies.mockResolvedValue(page([]));
  mocks.certificates.mockResolvedValue(page([]));
  mocks.sequence.mockResolvedValue({ series: "1", lastNumber: 0 });
  mocks.invoices.mockResolvedValue(page([]));
});
afterEach(cleanup);

describe("useOnboarding", () => {
  it("is off in live and calls nothing", async () => {
    mocks.auth.env = "live";
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.visible).toBe(false);
    expect(mocks.companies).not.toHaveBeenCalled();
  });

  it("with no company it asks for nothing else", async () => {
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(stepOf(result, "company")?.done).toBe(false);
    expect(mocks.certificates).not.toHaveBeenCalled();
    expect(mocks.sequence).not.toHaveBeenCalled();
    expect(mocks.invoices).not.toHaveBeenCalled();
  });

  it("with several companies it follows the oldest one", async () => {
    mocks.companies.mockResolvedValue(page([company("new", "2026-11-05T00:00:00Z"), company("old", "2026-01-01T00:00:00Z")]));
    mocks.certificates.mockResolvedValue(page([{ id: "k" }]));
    mocks.sequence.mockResolvedValue({ series: "1", lastNumber: 40 });
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(result.current.firstCompanyId).toBe("old");
    expect(mocks.certificates).toHaveBeenCalledWith("old", expect.anything(), expect.anything());
    expect(mocks.sequence).toHaveBeenCalledWith("old");
    expect(stepOf(result, "certificate")?.done).toBe(true);
    expect(stepOf(result, "numbering")?.done).toBe(true);
  });

  it("a failing query leaves only its own step undone", async () => {
    mocks.companies.mockResolvedValue(page([company("c1", "2026-01-01T00:00:00Z")]));
    mocks.certificates.mockRejectedValue(new Error("boom"));
    mocks.invoices.mockResolvedValue(page([{ id: "n1" }]));
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(stepOf(result, "company")?.done).toBe(true);
    expect(stepOf(result, "certificate")?.done).toBe(false);
    expect(stepOf(result, "note")?.done).toBe(true);
  });

  it("hide() remembers it, mark() completes the optional steps", async () => {
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => result.current.mark("plansSeen"));
    expect(stepOf(result, "plans")?.done).toBe(true);
    expect(result.current.done).toBe(1);
    act(() => result.current.hide());
    expect(result.current.visible).toBe(false);
    expect(localStorage.getItem("corvo:onboarding:t1:hidden")).toBe("1");
  });

  it("is not shown to someone with no permission for any step", async () => {
    mocks.auth.permissions = [];
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(mocks.companies).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
  });
});
