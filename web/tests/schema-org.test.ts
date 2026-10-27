import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ORGANIZATION_SAME_AS } from "@/lib/seo";

const ROOT = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|json)$/.test(name) ? [path] : [];
  });

describe("schema.org", () => {
  it("has no FAQPage anywhere in the app (pending approval of the FAQ text)", () => {
    const offenders = [...files(join(ROOT, "app")), ...files(join(ROOT, "components")), ...files(join(ROOT, "lib"))].filter((file) =>
      readFileSync(file, "utf8").includes("FAQPage"),
    );
    expect(offenders).toEqual([]);
  });

  it("links the organization to its official profiles", () => {
    expect(ORGANIZATION_SAME_AS).toContain("https://github.com/corvo-technology");
    for (const url of ORGANIZATION_SAME_AS) expect(url).toMatch(/^https:\/\//);
  });
});
