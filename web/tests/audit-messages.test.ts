import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@/lib/audit";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";

function apiActionCodes(): string[] {
  const source = readFileSync(join(__dirname, "../../api/src/modules/account-audit/domain/account-audit-action.ts"), "utf8");
  const list = source.slice(source.indexOf("["), source.indexOf("] as const"));
  return [...list.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((match) => match[1]);
}

describe("audit action labels", () => {
  it("has a pt and en label for every action the API records", () => {
    const codes = apiActionCodes();
    expect(codes.length).toBeGreaterThan(0);
    expect([...AUDIT_ACTIONS].sort()).toEqual([...codes].sort());
    for (const messages of [pt, en]) {
      // Messages nest "invoice.issued" as actions.invoice.issued.
      const labels = Object.entries(messages.Audit.actions as Record<string, Record<string, string>>).flatMap(([group, items]) =>
        Object.entries(items).map(([name, label]) => [`${group}.${name}`, label] as const));
      const byCode = Object.fromEntries(labels);
      for (const code of codes) expect(byCode[code], code).toBeTruthy();
      expect(Object.keys(byCode).sort()).toEqual([...codes].sort());
    }
  });
});
