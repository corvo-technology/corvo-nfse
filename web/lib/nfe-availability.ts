/**
 * Whether NF-e and NFC-e issue in production, for the marketing copy. It is the same switch the API
 * and the worker read, `NFE_PRODUCTION_ENABLED` (default off), so turning it on there and here
 * changes the pages without a code change.
 *
 * Read it only from server code, at request time. It is not NEXT_PUBLIC, so it is never inlined at
 * build. The pages that use it set `revalidate`, so a value changed after the build shows up within
 * that time instead of staying frozen in the prerendered page.
 */
export function nfeProductionEnabled(): boolean {
  const value = process.env.NFE_PRODUCTION_ENABLED?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "y";
}
