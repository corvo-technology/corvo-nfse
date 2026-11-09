import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GONE_PATHS, proxy } from "@/proxy";

const run = (path: string) => proxy(new NextRequest(`https://www.corvo.tech${path}`));
const rewriteTarget = (response: Response) => {
  const value = response.headers.get("x-middleware-rewrite");
  return value ? new URL(value).pathname : null;
};

afterEach(() => vi.unstubAllEnvs());

describe("soft 404 → real status", () => {
  const cases: [string, "404" | "410" | "pass"][] = [
    ["/pt/coming-soon", "410"],
    ["/en/coming-soon", "410"],
    ["/coming-soon", "410"],
    ["/pt/funcionalidades", "410"],
    ["/en/funcionalidades", "410"],
    ["/funcionalidades", "410"],
    ["/mo", "410"],
    ["/month", "410"],
    ["/v1/plans", "404"],
    ["/v1", "404"],
    ["/pt/pagina-que-nao-existe", "404"],
    ["/rota-desconhecida", "404"],
    ["/pt", "pass"],
    ["/pt/docs/mcp", "pass"],
    ["/pt/privacy", "pass"],
    ["/login", "pass"],
  ];

  for (const [path, expected] of cases) {
    it(`${path} → ${expected} (SITE_ACCESS_MODE closed)`, () => {
      const response = run(path);
      expect(response.headers.get("location")).toBeNull();
      if (expected === "410") expect(response.status).toBe(410);
      if (expected === "404") expect(rewriteTarget(response)).toMatch(/^\/(pt|en)\/__not-found$/);
      if (expected === "pass") {
        expect(response.status).toBeLessThan(300);
        expect(rewriteTarget(response) ?? "").not.toContain("__not-found");
      }
    });
  }

  it("keeps the 410 list explicit", () => {
    expect([...GONE_PATHS].every((path) => !/[*()[\]]/.test(path))).toBe(true);
  });

  it("with SITE_ACCESS_MODE open, unknown paths still don't redirect", () => {
    vi.stubEnv("SITE_ACCESS_MODE", "open");
    expect(run("/rota-desconhecida").headers.get("location")).toBeNull();
    expect(run("/pt/coming-soon").status).toBe(410);
  });
});
