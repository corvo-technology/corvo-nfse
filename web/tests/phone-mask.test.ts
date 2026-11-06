import { describe, expect, it } from "vitest";
import { maskPhone } from "@/lib/masks";

describe("maskPhone", () => {
  it.each([
    ["", ""],
    ["1", "(1"],
    ["11", "(11"],
    ["119", "(11) 9"],
    ["1199999", "(11) 9999-9"],
    ["11999999999", "(11) 99999-9999"],
    ["1133334444", "(11) 3333-4444"],
    ["(11) 99999-9999", "(11) 99999-9999"],
  ])("formats a Brazilian phone while typing: %s", (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });

  it("drops a typed or pasted country code and caps at 11 digits", () => {
    expect(maskPhone("5511999999999")).toBe("(11) 99999-9999");
    expect(maskPhone("+55 11 99999-9999")).toBe("(11) 99999-9999");
    expect(maskPhone("119999999999999")).toBe("(11) 99999-9999");
  });

  it("keeps a national number that merely starts with 55 (DDD 55)", () => {
    expect(maskPhone("55999999999")).toBe("(55) 99999-9999");
  });
});
