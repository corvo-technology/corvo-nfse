import { ApiError } from "./api";

export interface FieldIssue { field: string; code: string; message: string }

/** Per-field problems from a 400/422 response (`details: [{field, code, message}]`). */
export function fieldIssues(error: unknown): FieldIssue[] {
  if (!(error instanceof ApiError) || (error.status !== 400 && error.status !== 422)) return [];
  return (error.details ?? []).filter((item): item is FieldIssue => typeof item?.field === "string" && typeof item?.code === "string");
}

/** The API sends `ERROR_REQUIRED`; the translation tables are keyed by `required`. */
export const errorCodeKey = (code: string): string => code.replace(/^ERROR_/i, "").toLowerCase();

/**
 * The text to show for a failed request, in the user's language: the first field issue that has a
 * translation, else the top-level code's, else `fallback`. The API's own text is English and is never shown.
 */
export function apiErrorMessage(error: unknown, has: (key: string) => boolean, text: (key: string) => string, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  const codes = [...(error.details ?? []).map((item) => item.code), error.code].filter((code): code is string => typeof code === "string").map(errorCodeKey);
  const known = codes.find((code) => has(code));
  return known ? text(known) : fallback;
}

/**
 * Why an invoice was rejected or failed: our own codes get a translation; a Sefin/Receita rejection
 * (E0120 and the like) keeps its Portuguese text, which is the authority's own wording.
 */
export function invoiceErrorText(code: string | null | undefined, message: string | null | undefined, has: (key: string) => boolean, text: (key: string) => string): string {
  const key = code ? errorCodeKey(code) : "";
  return key && has(key) ? text(key) : (message ?? code ?? "");
}

/**
 * Maps API issues to `{ formField: translated message }`. `fieldMap` converts
 * API paths ("address.zip") to form field names; unmapped issues go to `_form`.
 */
export function mapIssues(error: unknown, fieldMap: Record<string, string>, translate: (code: string, fallback: string) => string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of fieldIssues(error)) {
    const key = fieldMap[issue.field] ?? "_form";
    if (!result[key]) result[key] = translate(errorCodeKey(issue.code), issue.message);
  }
  return result;
}
