import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocsTree } from "@/lib/docs/registry";

const CLIENTS = ["Claude Code", "Claude Desktop", "Cursor", "VS Code", "Codex", "Windsurf"];

describe("MCP docs page", () => {
  for (const locale of ["en", "pt"] as const) {
    it(`has a setup for all 6 clients and a test prompt in ${locale}`, () => {
      const page = JSON.stringify(getDocsTree(locale)!.pages.mcp.blocks);
      for (const client of CLIENTS) expect(page).toContain(client);
      expect(page).toContain("mcp_servers.corvo");
      expect(page).toContain("serverUrl");
      expect(page).toMatch(locale === "pt" ? /não verificado/i : /not yet verified/i);
    });
  }

  it("lists the same 6 clients in llms.txt", () => {
    const llms = readFileSync(join(__dirname, "..", "public", "llms.txt"), "utf8");
    for (const client of CLIENTS) expect(llms).toContain(client);
  });
});
