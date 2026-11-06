import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { errorCodeKey } from "@/lib/api-errors";
import { INVOICE_REJECTION_CODES, REQUEST_ERRORS, VALIDATION_CODES } from "@/lib/docs/error-catalog";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";

/** The API's source is the catalogue of what it can answer: every public code in it needs a text here. */
const API_SRC = join(process.cwd(), "..", "api", "src");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
});

/** Codes that never reach a user as an error: config validation, a notice, and the ERROR_HTTP_<status> prefix. */
const NOT_USER_FACING = new Set(["custom", "declared_deduction_applied", "http_"]);

const publicCodes = (): Map<string, string> => {
  const found = new Map<string, string>();
  for (const file of walk(API_SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bcode:\s*'([A-Za-z][A-Za-z0-9_]*)'/g)) found.set(errorCodeKey(match[1]), file);
    for (const match of source.matchAll(/new BillingRuleError\(\s*'([a-z_]+)'/g)) found.set(match[1], file);
    for (const match of source.matchAll(/\b(ERROR_[A-Z0-9_]{3,})\b/g)) found.set(errorCodeKey(match[1]), file);
  }
  const union = readFileSync(join(API_SRC, "shared", "fiscal", "fiscal-validation-error.ts"), "utf8").match(/type FiscalIssueCode =([^;]+);/);
  for (const match of union?.[1].matchAll(/'([a-z_]+)'/g) ?? []) found.set(match[1], "fiscal-validation-error.ts");
  return found;
};

describe("API error catalogue", () => {
  const codes = [...publicCodes()].filter(([code]) => !NOT_USER_FACING.has(code));
  it("finds the codes in the API source (the scan is not silently empty)", () => {
    expect(codes.length).toBeGreaterThan(150);
  });
  it.each(codes)("%s has a Portuguese and an English text", (code) => {
    expect((pt.ApiErrors as Record<string, string>)[code]).toBeTruthy();
    expect((en.ApiErrors as Record<string, string>)[code]).toBeTruthy();
  });
  it("Portuguese and English have the same codes", () => {
    expect(Object.keys(pt.ApiErrors).sort()).toEqual(Object.keys(en.ApiErrors).sort());
  });
  const documented = new Set([...REQUEST_ERRORS.map((entry) => entry.code), ...VALIDATION_CODES, ...INVOICE_REJECTION_CODES]);
  it.each(codes)("%s is in the docs catalogue", (code) => {
    expect(documented.has(code)).toBe(true);
  });
});
