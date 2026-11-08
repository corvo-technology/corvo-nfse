// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useImport } from "@/lib/use-import";
import type { ImportJob } from "@/lib/types";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ imports: { get: mocks.get } }));

const job = (status: ImportJob["status"]): ImportJob => ({ id: "i1", status, fileName: "n.csv", companyId: null, errorCode: null, rowsExpected: null, unknownColumns: [], emitStartedAt: null, emitFinishedAt: null, createdAt: "", counters: { total: 1, valid: 1, invalid: 0, accepted: 0, authorized: 0, awaitingCredits: 0, validAmount: 0, awaitingAmount: 0, failed: 0, pending: 1, authorizedAmount: 0, pendingAmount: 0, failedAmount: 0 } });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useImport", () => {
  it("does nothing without an id", async () => {
    const { result } = renderHook(() => useImport(null));
    await flush(5000);
    expect(result.current.job).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("polls every 1.5 s while the import is moving, and stops once it settles", async () => {
    mocks.get.mockResolvedValueOnce(job("processing")).mockResolvedValueOnce(job("processing")).mockResolvedValue(job("ready"));
    const { result } = renderHook(() => useImport("i1"));
    await flush(0);
    expect(result.current.job?.status).toBe("processing");
    await flush(1500);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    await flush(1500);
    expect(result.current.job?.status).toBe("ready");
    const calls = mocks.get.mock.calls.length;
    await flush(10_000);
    expect(mocks.get).toHaveBeenCalledTimes(calls);
  });

  it("keeps polling while emitting, and stops at done", async () => {
    mocks.get.mockResolvedValueOnce(job("emitting")).mockResolvedValueOnce(job("emitting")).mockResolvedValue(job("done"));
    const { result } = renderHook(() => useImport("i1"));
    await flush(0); await flush(1500); await flush(1500);
    expect(result.current.job?.status).toBe("done");
    const calls = mocks.get.mock.calls.length;
    await flush(10_000);
    expect(mocks.get).toHaveBeenCalledTimes(calls);
  });

  it("refresh() reads again right away and resumes polling if the import moves again", async () => {
    mocks.get.mockResolvedValueOnce(job("ready")).mockResolvedValueOnce(job("emitting")).mockResolvedValue(job("emitting"));
    const { result } = renderHook(() => useImport("i1"));
    await flush(0);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.job?.status).toBe("emitting");
    await flush(1500);
    expect(mocks.get.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("reports a failed read and stops polling", async () => {
    mocks.get.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useImport("i1"));
    await flush(0);
    expect(result.current.error).toBeInstanceOf(Error);
    await flush(10_000);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("keeps following an import that is emitting when one read fails, and says it is reconnecting", async () => {
    mocks.get
      .mockResolvedValueOnce(job("emitting"))
      .mockRejectedValueOnce(new Error("502"))
      .mockResolvedValue(job("emitting"));
    const { result } = renderHook(() => useImport("i1"));
    await flush(0);
    await flush(1500);
    expect(result.current.reconnecting).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.job?.status).toBe("emitting");
    await flush(3000); // first retry waits a little longer
    expect(result.current.reconnecting).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(3);
  });

  it("backs off between failed reads, up to 15 s", async () => {
    mocks.get.mockResolvedValueOnce(job("emitting")).mockRejectedValue(new Error("down"));
    renderHook(() => useImport("i1"));
    await flush(0);
    await flush(1500); // 2nd read fails
    await flush(3000); // 3rd
    await flush(6000); // 4th
    await flush(12_000); // 5th
    const calls = mocks.get.mock.calls.length;
    await flush(14_000);
    expect(mocks.get).toHaveBeenCalledTimes(calls);
    await flush(1000);
    expect(mocks.get).toHaveBeenCalledTimes(calls + 1);
  });

  it("tells when it last heard from the server and when the numbers last moved", async () => {
    const moving = job("emitting");
    mocks.get
      .mockResolvedValueOnce(moving)
      .mockResolvedValueOnce({ ...moving })
      .mockResolvedValue({ ...moving, counters: { ...moving.counters, authorized: 1 } });
    const { result } = renderHook(() => useImport("i1"));
    await flush(0);
    const firstChange = result.current.changedAt;
    expect(result.current.updatedAt).not.toBeNull();
    await flush(1500); // same numbers
    expect(result.current.changedAt).toBe(firstChange);
    expect(result.current.updatedAt).toBeGreaterThan(firstChange!);
    await flush(1500); // one more authorized
    expect(result.current.changedAt).toBeGreaterThan(firstChange!);
  });

  it("reads again right away when the tab becomes visible", async () => {
    mocks.get.mockResolvedValue(job("emitting"));
    renderHook(() => useImport("i1"));
    await flush(0);
    const calls = mocks.get.mock.calls.length;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush(0);
    expect(mocks.get).toHaveBeenCalledTimes(calls + 1);
  });
});
