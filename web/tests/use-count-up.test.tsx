// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCountUp } from "@/lib/use-count-up";

const reduced = vi.hoisted(() => ({ on: false }));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  window.matchMedia = ((query: string) => ({ matches: reduced.on && query.includes("reduce"), addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.useRealTimers(); reduced.on = false; });

describe("useCountUp", () => {
  it("starts at the value without animating on the first render", () => {
    expect(renderHook(() => useCountUp(17)).result.current).toBe(17);
  });

  it("counts up to a new value instead of jumping", async () => {
    const { result, rerender } = renderHook(({ value }) => useCountUp(value), { initialProps: { value: 4 } });
    rerender({ value: 20 });
    expect(result.current).toBeLessThan(20);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current).toBeGreaterThan(4);
    expect(result.current).toBeLessThan(20);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current).toBe(20);
  });

  it("lands exactly on the value even when it changes mid-way", async () => {
    const { result, rerender } = renderHook(({ value }) => useCountUp(value), { initialProps: { value: 0 } });
    rerender({ value: 10 });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    rerender({ value: 3 });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current).toBe(3);
  });

  it("jumps straight to the value when the user prefers reduced motion", () => {
    reduced.on = true;
    const { result, rerender } = renderHook(({ value }) => useCountUp(value), { initialProps: { value: 4 } });
    rerender({ value: 20 });
    expect(result.current).toBe(20);
  });
});
