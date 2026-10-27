import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CatalogEntry {
  slug: string;
  monthlyAllowance: number;
  basePriceCents: number;
  perCreditOverageCents: number;
}

/**
 * Reads the catalog behind `GET /v1/plans` straight from the API's PricingService source,
 * so the site test fails if a price or quota diverges from billing.
 */
export function readPricingCatalog(): CatalogEntry[] {
  const source = readFileSync(join(__dirname, "..", "..", "..", "api", "src", "modules", "plans", "application", "pricing.service.ts"), "utf8");
  const entries = [...source.matchAll(/(\w+): \{\s*basePriceCents: (\d+),\s*perCreditCents: (\d+),[\s\S]*?allowance: (\d+),/g)];
  return entries.map(([, slug, base, perCredit, allowance]) => ({
    slug,
    monthlyAllowance: Number(allowance),
    basePriceCents: Number(base),
    perCreditOverageCents: Number(perCredit),
  }));
}
