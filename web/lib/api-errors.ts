import { ApiError } from "./api";

export interface FieldIssue { field: string; code: string; message: string }

/** Per-field problems from a 400/422 response (`details: [{field, code, message}]`). */
export function fieldIssues(error: unknown): FieldIssue[] {
  if (!(error instanceof ApiError) || (error.status !== 400 && error.status !== 422)) return [];
  return (error.details ?? []).filter((item): item is FieldIssue => typeof item?.field === "string" && typeof item?.code === "string");
}

/**
 * Maps API issues to `{ formField: translated message }`. `fieldMap` converts
 * API paths ("address.zip") to form field names; unmapped issues go to `_form`.
 */
export function mapIssues(error: unknown, fieldMap: Record<string, string>, translate: (code: string, fallback: string) => string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of fieldIssues(error)) {
    const key = fieldMap[issue.field] ?? "_form";
    if (!result[key]) result[key] = translate(issue.code, issue.message);
  }
  return result;
}
