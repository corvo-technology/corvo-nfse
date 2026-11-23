import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PUBLISHED_DOC_SLUGS } from "@/lib/docs/slugs";
import { proxy } from "@/proxy";

const run = (path: string, host = "https://www.corvo.tech") =>
  proxy(new NextRequest(`${host}${path}`, { headers: { cookie: "NEXT_LOCALE=en" } }));

const location = (path: string, host?: string) => new URL(run(path, host).headers.get("location")!);

describe("/docs without locale → 301 /pt/docs", () => {
  it.each([
    ["/docs", "/pt/docs"],
    ["/docs/", "/pt/docs"],
    ["/docs/webhooks", "/pt/docs/webhooks"],
    ["/docs/webhooks/", "/pt/docs/webhooks"],
    ["/docs/imports", "/pt/docs/imports"],
    ["/docs/quickstart", "/pt/docs"],
    ["/docs/quickstart/", "/pt/docs"],
    ["/pt/docs/quickstart", "/pt/docs"],
    ["/en/docs/quickstart", "/en/docs"],
    ["/en/docs/quickstart/", "/en/docs"],
    ["/docs/credits", "/pt/docs/billing"],
    ["/docs/credits/", "/pt/docs/billing"],
    ["/pt/docs/credits", "/pt/docs/billing"],
    ["/en/docs/credits", "/en/docs/billing"],
    ["/terms/", "/pt/terms"],
    ["/security/", "/pt/security"],
    ["/start", "/pt/start"],
    ["/start/", "/pt/start"],
    ["/pt/", "/pt"],
    ["/pt/terms/", "/pt/terms"],
    ["/pt/docs/", "/pt/docs"],
    ["/en/docs/invoices/", "/en/docs/invoices"],
  ])("%s → %s", (from, to) => {
    const res = run(from);
    expect(res.status).toBe(301);
    expect(location(from).pathname).toBe(to);
    expect(location(from).origin).toBe("https://www.corvo.tech");
  });

  it("keeps the query string and does not chain", () => {
    const loc = location("/docs/quickstart?utm_source=x&a=1");
    expect(loc.pathname).toBe("/pt/docs");
    expect(loc.search).toBe("?utm_source=x&a=1");
    const again = proxy(new NextRequest(loc));
    expect(again.headers.get("location")).toBeNull();
    expect(again.status).not.toBe(301);
  });

  it.each(["/pt/docs", "/en/docs", "/pt/docs/billing", "/docsx"])("%s is not 301", (path) => {
    expect(run(path).status).not.toBe(301);
    expect(run(path).headers.get("location")).toBeNull();
  });

  it("does not 301 an unknown docs slug to a missing page", () => {
    for (const path of ["/docs/not-a-real-page", "/docs/not-a-real-page/", "/pt/docs/not-a-real-page", "/docs/a/b"]) {
      const res = run(path);
      expect(res.headers.get("location"), path).toBeNull();
      expect(res.headers.get("x-middleware-rewrite"), path).toContain("/__not-found");
    }
  });

  it("sends an apex hit to www and the final path in one hop", () => {
    const res = run("/docs/sdks/?utm_source=x", "https://corvo.tech");
    expect(res.status).toBe(301);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe("https://www.corvo.tech");
    expect(loc.pathname).toBe("/pt/docs/sdks");
    expect(loc.search).toBe("?utm_source=x");
    expect(proxy(new NextRequest(loc)).headers.get("location")).toBeNull();
  });

  it("sends an apex page that is already canonical to the same path on www", () => {
    const loc = location("/pt/docs", "https://corvo.tech");
    expect(loc.origin).toBe("https://www.corvo.tech");
    expect(loc.pathname).toBe("/pt/docs");
  });

  it("only aliases slugs that are not published", () => {
    expect(PUBLISHED_DOC_SLUGS.has("quickstart")).toBe(false);
    expect(PUBLISHED_DOC_SLUGS.has("credits")).toBe(false);
    expect(PUBLISHED_DOC_SLUGS.has("billing")).toBe(true);
  });
});
