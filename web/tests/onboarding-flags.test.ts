// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFlag, writeFlag } from "@/lib/onboarding-flags";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("onboarding flags", () => {
  it("remembers a flag per workspace and per flag", () => {
    writeFlag("t1", "hidden");
    expect(readFlag("t1", "hidden")).toBe(true);
    expect(readFlag("t2", "hidden")).toBe(false);
    expect(readFlag("t1", "plansSeen")).toBe(false);
  });

  it("does not break when the browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readFlag("t1", "hidden")).toBe(false);
    expect(() => writeFlag("t1", "hidden")).not.toThrow();
  });
});
