import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next";

describe("safeNextPath", () => {
  it("keeps the AI-agent consent URL with its query string", () => {
    expect(safeNextPath("/mcp/authorize?client_id=corvo-mcp&state=a%20b")).toBe("/mcp/authorize?client_id=corvo-mcp&state=a%20b");
  });

  it("keeps the invitation page, which reads its token from sessionStorage and never from the URL", () => {
    expect(safeNextPath("/accept-invite")).toBe("/accept-invite");
  });

  it.each([
    null, undefined, "", "/app", "/mcp/authorize/../app", "//evil.example/mcp/authorize", "https://evil.example/mcp/authorize",
    "/\\evil.example", "javascript:alert(1)", "mcp/authorize",
  ])("rejects %s", (value) => {
    expect(safeNextPath(value)).toBeNull();
  });
});
