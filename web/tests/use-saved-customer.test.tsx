// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSavedCustomer } from "@/components/invoices/use-saved-customer";
import type { SavedCustomer } from "@/lib/types";

const find = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ customers: { find } }));

const maria: SavedCustomer = { taxId: "52998224725", name: "Maria da Silva", email: "maria@exemplo.test", lastUsedAt: "", createdAt: "", updatedAt: "" };
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(400); }); };

describe("useSavedCustomer", () => {
  beforeEach(() => { vi.useFakeTimers(); find.mockReset(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("looks up a complete, valid document once and reports the saved customer", async () => {
    find.mockResolvedValue(maria);
    const onFound = vi.fn();
    const { result } = renderHook(() => useSavedCustomer("52998224725", onFound));
    expect(find).not.toHaveBeenCalled();
    await flush();
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0][0]).toBe("52998224725");
    expect(onFound).toHaveBeenCalledWith(maria);
    expect(result.current).toEqual(maria);
  });

  it("does not look up an incomplete or invalid document", async () => {
    const onFound = vi.fn();
    const { rerender } = renderHook(({ doc }) => useSavedCustomer(doc, onFound), { initialProps: { doc: "5299822" } });
    await flush();
    rerender({ doc: "11111111111" });
    await flush();
    expect(find).not.toHaveBeenCalled();
    expect(onFound).not.toHaveBeenCalled();
  });

  it("waits for the typing to stop and ignores the answer of a document that is no longer in the field", async () => {
    let resolveFirst: (value: SavedCustomer | null) => void = () => {};
    find.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    find.mockResolvedValueOnce(null);
    const onFound = vi.fn();
    const { result, rerender } = renderHook(({ doc }) => useSavedCustomer(doc, onFound), { initialProps: { doc: "52998224725" } });
    await flush();
    rerender({ doc: "11222333000181" });
    await flush();
    await act(async () => { resolveFirst(maria); });
    expect(onFound).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("stays quiet when the lookup fails or nothing was saved", async () => {
    find.mockRejectedValueOnce(new Error("offline"));
    const onFound = vi.fn();
    const { result } = renderHook(() => useSavedCustomer("52998224725", onFound));
    await flush();
    expect(onFound).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});
