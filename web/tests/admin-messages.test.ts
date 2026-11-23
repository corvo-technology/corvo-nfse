import { describe, expect, it } from "vitest";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";

const leaves = (value: unknown, prefix = ""): [string, unknown][] =>
  value !== null && typeof value === "object"
    ? Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key))
    : [[prefix, value]];

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe("Admin messages", () => {
  const ptLeaves = leaves(pt.Admin);
  const enLeaves = leaves(en.Admin);

  it("exist in both languages with the same keys", () => {
    expect(ptLeaves.length).toBeGreaterThan(80);
    expect(ptLeaves.map(([key]) => key)).toEqual(enLeaves.map(([key]) => key));
  });
  it("have no empty text", () => {
    for (const [key, value] of [...ptLeaves, ...enLeaves]) {
      expect(typeof value === "string" && value.trim().length > 0, key).toBe(true);
    }
  });
  it("use the same placeholders in both languages", () => {
    const enByKey = new Map(enLeaves);
    for (const [key, value] of ptLeaves) {
      expect(placeholders(value as string), key).toEqual(placeholders(enByKey.get(key) as string));
    }
  });
  it("keep the placeholders the pages rely on", () => {
    expect(placeholders(pt.Admin.grant.confirm)).toEqual(["amount", "email"]);
    expect(placeholders(pt.Admin.overview.revenueNote)).toEqual(["date"]);
  });
  it("add the sidebar entry and the idempotency error", () => {
    expect(pt.Sidebar.nav.admin).toBeTruthy();
    expect(en.Sidebar.nav.admin).toBeTruthy();
    expect(pt.ApiErrors.idempotency_key_reused).toBeTruthy();
    expect(en.ApiErrors.idempotency_key_reused).toBeTruthy();
  });
  it("never name the card processor to customers", () => {
    expect(JSON.stringify(pt.Admin) + JSON.stringify(en.Admin)).not.toMatch(/stripe/i);
  });
});
