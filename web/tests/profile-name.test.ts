import { describe, expect, it } from "vitest";
import { needsName } from "@/lib/profile-name";

describe("needsName", () => {
  it.each([
    [{ name: "", email: "ana@x.com" }, true],
    [{ name: "   ", email: "ana@x.com" }, true],
    [{ name: "maria99", email: "maria99@example.com" }, true],
    [{ name: "Maria99", email: "maria99@example.com" }, true],
    [{ name: "Maria Souza", email: "maria99@example.com" }, false],
    [{ name: "Ana", email: "ana.silva@x.com" }, false],
  ])("%j -> %s", (profile, expected) => {
    expect(needsName(profile)).toBe(expected);
  });

  it("does not ask while the profile is unknown", () => {
    expect(needsName(null)).toBe(false);
    expect(needsName(undefined)).toBe(false);
  });
});
