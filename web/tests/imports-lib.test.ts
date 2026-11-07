import { describe, expect, it } from "vitest";
import { LIMIT_CODES, importStage, parseMoney, rowFields, rowPatch, percentDone } from "@/lib/imports";
import type { ImportJob, ImportRow } from "@/lib/types";

const row = (data: Record<string, unknown>): ImportRow => ({ line: 2, data, status: "invalid", errorCode: null, errorMessage: null, invoiceId: null });
const job = (status: ImportJob["status"], counters: Partial<ImportJob["counters"]> = {}): ImportJob => ({
  id: "i1", status, fileName: "n.csv", companyId: null, errorCode: null, rowsExpected: null, unknownColumns: [], emitStartedAt: null, emitFinishedAt: null, createdAt: "",
  counters: { total: 10, valid: 8, invalid: 2, accepted: 0, authorized: 0, awaitingCredits: 0, validAmount: 0, awaitingAmount: 0, failed: 2, pending: 8, ...counters },
});

describe("parseMoney", () => {
  it.each([["1.234,56", 1234.56], ["1234.56", 1234.56], ["R$ 10,5", 10.5], ["10", 10], ["0,07", 0.07]])("reads %s", (text, value) => expect(parseMoney(text)).toBe(value));
  it.each(["", "abc", "1,234,56", "-5", "10,999"])("rejects %j", (text) => expect(parseMoney(text)).toBeNull());
});

describe("rowFields and rowPatch", () => {
  const data = { amount: 1500, competenceDate: "2026-11-07", customer: { name: "Ana", taxId: "52998224725", email: "a@x.com" }, service: { description: "Consultoria", code: "010101" }, companyTaxId: "11222333000181" };
  it("reads the editable fields out of the saved invoice data", () => {
    expect(rowFields(row(data))).toEqual({ customerName: "Ana", customerTaxId: "52998224725", customerEmail: "a@x.com", description: "Consultoria", serviceCode: "010101", amount: "1500", competenceDate: "2026-11-07" });
  });
  it("copes with a row that has almost nothing", () => {
    expect(rowFields(row({ amount: "abc" }))).toMatchObject({ customerName: "", description: "", amount: "abc", competenceDate: "" });
  });
  it("builds a patch with whole customer and service objects, so editing one field keeps the others", () => {
    const patch = rowPatch({ ...rowFields(row(data)), customerEmail: "novo@x.com", amount: "1.600,00" });
    expect(patch).toEqual({ amount: 1600, competenceDate: "2026-11-07", customer: { name: "Ana", taxId: "52998224725", email: "novo@x.com" }, service: { description: "Consultoria", code: "010101" } });
    expect(patch).not.toHaveProperty("companyTaxId");
  });
  it("leaves out empty optional fields, and keeps an unreadable amount as typed so the API explains it", () => {
    const patch = rowPatch({ customerName: "", customerTaxId: "", customerEmail: "", description: "X", serviceCode: "", amount: "abc", competenceDate: "" });
    expect(patch).toEqual({ amount: "abc", service: { description: "X" } });
  });
});

describe("importStage", () => {
  it("picks the screen from the import status", () => {
    expect(importStage(null)).toBe("upload");
    expect(importStage(job("processing"))).toBe("reading");
    expect(importStage(job("failed"))).toBe("failed");
    expect(importStage(job("ready"))).toBe("review");
    expect(importStage(job("emitting"))).toBe("progress");
    expect(importStage(job("done"))).toBe("progress");
  });
});

describe("percentDone", () => {
  it("counts what is final (authorized plus failed) over the rows being emitted", () => {
    expect(percentDone(job("emitting", { total: 10, invalid: 2, authorized: 4, failed: 2, pending: 4 }))).toBe(50);
    expect(percentDone(job("done", { total: 10, invalid: 0, authorized: 10, failed: 0, pending: 0 }))).toBe(100);
    expect(percentDone(job("emitting", { total: 0, invalid: 0, authorized: 0, failed: 0, pending: 0 }))).toBe(0);
  });
});

it("a paused import (credits ran out) is not at 100%", () => {
  expect(percentDone(job("done", { total: 10, invalid: 0, authorized: 4, awaitingCredits: 6, failed: 0, pending: 0 }))).toBe(40);
});

it("knows which rejections are worth sending again", () => {
  expect(LIMIT_CODES).toContain("ERROR_MONTHLY_LIMIT_EXCEEDED");
  expect(LIMIT_CODES).toContain("ERROR_IMPORT_EMIT_FAILED");
});
