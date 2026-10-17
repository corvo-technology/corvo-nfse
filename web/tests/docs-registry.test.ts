// tests/docs-registry.test.ts
import { describe, expect, it } from "vitest";
import { DOC_GROUPS, DOC_SLUGS } from "@/lib/docs/registry";

describe("docs registry structure", () => {
  it("has exactly 16 slugs in 3 groups", () => {
    expect(DOC_GROUPS.map((g) => g.key)).toEqual([
      "gettingStarted",
      "reference",
      "guides",
    ]);
    expect(DOC_SLUGS).toHaveLength(16);
  });

  it("has no duplicate slugs across groups", () => {
    const seen = new Set<string>();
    for (const slug of DOC_SLUGS) {
      expect(seen.has(slug)).toBe(false);
      seen.add(slug);
    }
  });

  it("group slugs match the spec sidebar order", () => {
    expect(DOC_GROUPS[0].slugs).toEqual([
      "sdks",
      "authentication",
      "errors",
      "rate-limits",
    ]);
    expect(DOC_GROUPS[1].slugs).toEqual([
      "companies",
      "certificates",
      "invoices",
      "webhooks",
      "credits",
      "billing",
    ]);
    expect(DOC_GROUPS[2].slugs).toEqual([
      "async-issuance",
      "pagination",
      "receiving-webhooks",
      "integration-checklist",
      "mcp",
      "llms",
    ]);
  });
});
