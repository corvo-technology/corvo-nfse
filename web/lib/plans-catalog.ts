/** Plan catalog, mirroring the backend PricingService (`GET /v1/plans`). Server-safe: no "use client". */

export type PlanSlug = "free" | "developer" | "growth" | "scale" | "volume";

export interface PlanTier {
  slug: PlanSlug;
  credits: number;
  basePriceCents: number;
  perCreditCents: number;
}

export const PLANS: PlanTier[] = [
  { slug: "free", credits: 5, basePriceCents: 0, perCreditCents: 0 },
  { slug: "developer", credits: 200, basePriceCents: 2990, perCreditCents: 18 },
  { slug: "growth", credits: 850, basePriceCents: 9990, perCreditCents: 14 },
  { slug: "scale", credits: 3000, basePriceCents: 29990, perCreditCents: 12 },
  { slug: "volume", credits: 10000, basePriceCents: 69990, perCreditCents: 9 },
];
