import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const run = (path: string) => proxy(new NextRequest(`https://corvo.tech${path}`, { headers: { cookie: "NEXT_LOCALE=en" } }));

describe("/docs without locale → 301 /pt/docs", () => {
  it.each([
    ["/docs", "/pt/docs"],
    ["/docs/", "/pt/docs/"],
    ["/docs/quickstart", "/pt/docs/quickstart"],
    ["/docs/webhooks", "/pt/docs/webhooks"],
  ])("%s → %s", (from, to) => {
    const res = run(from);
    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location")!).pathname).toBe(to);
  });

  it("keeps the query string", () => {
    const loc = new URL(run("/docs/quickstart?utm_source=x&a=1").headers.get("location")!);
    expect(loc.pathname).toBe("/pt/docs/quickstart");
    expect(loc.search).toBe("?utm_source=x&a=1");
  });

  it.each(["/pt/docs", "/en/docs", "/pt/docs/quickstart", "/docsx"])("%s is not 301", (p) => {
    expect(run(p).status).not.toBe(301);
  });
});
