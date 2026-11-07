import type { ImportJob, ImportRow } from "./types";

/** Rejections that go away by topping up credits (or trying again): worth sending once more. Mirrors the API. */
export const LIMIT_CODES = [
  "ERROR_PLAN_BLOCKED",
  "ERROR_MONTHLY_LIMIT_EXCEEDED",
  "ERROR_DAILY_LIMIT_EXCEEDED",
  "ERROR_INSUFFICIENT_CREDITS",
  "ERROR_QUOTA_EXCEEDED",
  "ERROR_IMPORT_EMIT_FAILED",
];

/** "1.234,56", "1234.56", "R$ 10,5" as a number of reais; null when it is not a plain amount with up to 2 decimals. */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/R\$/i, "").replace(/\s/g, "");
  let integer: string; let cents = "";
  if (/^\d{1,3}(\.\d{3})*,\d+$/.test(clean) || /^\d+,\d+$/.test(clean)) [integer = "", cents = ""] = clean.replaceAll(".", "").split(",");
  else if (/^\d{1,3}(\.\d{3})+$/.test(clean)) integer = clean.replaceAll(".", "");
  else if (/^\d+(\.\d+)?$/.test(clean)) [integer = "", cents = ""] = clean.split(".");
  else return null;
  if (cents.length > 2) return null;
  return (Number(integer) * 100 + Number(cents.padEnd(2, "0"))) / 100;
}

export interface RowFields { customerName: string; customerTaxId: string; customerEmail: string; description: string; serviceCode: string; amount: string; competenceDate: string }

const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** The fields the user can fix, read from the invoice data the API saved for the row. */
export function rowFields(row: ImportRow): RowFields {
  const customer = record(row.data.customer); const service = record(row.data.service);
  return { customerName: text(customer.name), customerTaxId: text(customer.taxId), customerEmail: text(customer.email), description: text(service.description), serviceCode: text(service.code), amount: text(row.data.amount), competenceDate: text(row.data.competenceDate) };
}

/**
 * What to send back for a corrected row. customer and service go whole (the API merges them field by field
 * too, so either way editing the e-mail keeps the name). An amount that does not parse goes as typed, for the API to explain.
 */
export function rowPatch(fields: RowFields): Record<string, unknown> {
  const pick = (entries: [string, string][]) => Object.fromEntries(entries.filter(([, value]) => value.trim() !== "").map(([key, value]) => [key, value.trim()]));
  const customer = pick([["name", fields.customerName], ["taxId", fields.customerTaxId], ["email", fields.customerEmail]]);
  const service = pick([["description", fields.description], ["code", fields.serviceCode]]);
  const patch: Record<string, unknown> = { amount: parseMoney(fields.amount) ?? fields.amount.trim() };
  if (fields.competenceDate.trim()) patch.competenceDate = fields.competenceDate.trim();
  if (Object.keys(customer).length) patch.customer = customer;
  if (Object.keys(service).length) patch.service = service;
  return patch;
}

export type ImportStage = "upload" | "reading" | "review" | "progress" | "failed";
export function importStage(job: ImportJob | null): ImportStage {
  if (!job) return "upload";
  if (job.status === "processing") return "reading";
  if (job.status === "failed") return "failed";
  if (job.status === "ready") return "review";
  return "progress";
}

/** How much of what is being emitted already has a final answer (authorized or failed after the review). */
export function percentDone(job: ImportJob): number {
  const { total, invalid, authorized, failed } = job.counters;
  const toEmit = total - invalid;
  if (toEmit <= 0) return 0;
  return Math.min(100, Math.round(((authorized + Math.max(0, failed - invalid)) / toEmit) * 100));
}
