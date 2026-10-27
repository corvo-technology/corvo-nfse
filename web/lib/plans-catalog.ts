/** Plan catalog, mirroring the backend PricingService (`GET /v1/plans`). Server-safe: no "use client". */

export type PlanSlug = "free" | "developer" | "growth" | "scale" | "volume";

export interface PlanTier {
  slug: PlanSlug;
  credits: number;
  basePriceCents: number;
  perCreditCents: number;
}

export const PLANS: PlanTier[] = [
  { slug: "free", credits: 15, basePriceCents: 0, perCreditCents: 0 },
  { slug: "developer", credits: 250, basePriceCents: 2990, perCreditCents: 12 },
  { slug: "growth", credits: 1500, basePriceCents: 9990, perCreditCents: 8 },
  { slug: "scale", credits: 6000, basePriceCents: 29990, perCreditCents: 5 },
  { slug: "volume", credits: 20000, basePriceCents: 69990, perCreditCents: 5 },
];
