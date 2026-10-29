import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isBot, proxy } from "@/proxy";
import { localizedAlternates } from "@/lib/seo";

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://www.corvo.tech${path}`, { headers });

describe("locale proxy", () => {
  it("sends the root to /pt when the browser sends no Accept-Language", () => {
    const response = proxy(request("/"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/pt");
  });

  it("sends the root to /en for English browsers", () => {
    const response = proxy(request("/", { "accept-language": "en-US,en;q=0.9" }));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/en");
  });

  it("sends the root to /pt for Portuguese browsers", () => {
    const response = proxy(request("/", { "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" }));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/pt");
  });

  it("does not set a language cookie for crawlers", () => {
    const response = proxy(request("/", { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }));
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(new URL(response.headers.get("location")!).pathname).toBe("/pt");
  });

  it("does not send a hreflang Link header that could disagree with the HTML", () => {
    const response = proxy(request("/pt"));
    expect(response.headers.get("link")).toBeNull();
  });

  it("recognises AI crawlers and real browsers", () => {
    expect(isBot("GPTBot/1.1")).toBe(true);
    expect(isBot("ClaudeBot/1.0")).toBe(true);
    expect(isBot("Mozilla/5.0 (Macintosh) Safari/605.1.15")).toBe(false);
    expect(isBot(null)).toBe(false);
  });

  it("uses /pt as x-default in the HTML alternates", () => {
    expect(localizedAlternates("en", "").languages["x-default"]).toBe("https://www.corvo.tech/pt");
  });
});
