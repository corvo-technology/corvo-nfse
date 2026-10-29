import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const get = (path: string) => proxy(new NextRequest(new URL(path, "https://www.corvo.tech")));

describe("static locale pages", () => {
  it.each(["/pt", "/en", "/pt/docs", "/pt/docs/invoices", "/en/api-docs"])("%s sends no Set-Cookie", (path) => {
    expect(get(path).headers.get("set-cookie")).toBeNull();
  });

  it("the root redirect still remembers the locale", () => {
    const response = get("/");
    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).toContain("NEXT_LOCALE=");
  });
});
