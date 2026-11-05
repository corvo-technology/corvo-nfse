/** Plan catalog, mirroring the backend PricingService (`GET /v1/plans`). Server-safe: no "use client". */

export type PlanSlug = "solo" | "equipe" | "empresa" | "escala";
export type BillingCycle = "monthly" | "annual";

export interface PlanTier {
  slug: PlanSlug;
  /** Notes included every month. */
  credits: number;
  /** Full monthly price, in cents. */
  monthlyCents: number;
  /** Price per month when paying the year at once (30% off), in cents. */
  annualMonthlyCents: number;
}

export const PLANS: PlanTier[] = [
  { slug: "solo", credits: 100, monthlyCents: 5990, annualMonthlyCents: 4190 },
  { slug: "equipe", credits: 250, monthlyCents: 11990, annualMonthlyCents: 8390 },
  { slug: "empresa", credits: 600, monthlyCents: 23990, annualMonthlyCents: 16790 },
  { slug: "escala", credits: 1200, monthlyCents: 39990, annualMonthlyCents: 27990 },
];

/** One-off notes: R$ 0,99 each, at least 3 per purchase. */
export const AVULSO_UNIT_CENTS = 99;
export const AVULSO_MIN_UNITS = 3;
export const MAX_CALCULATOR_NOTES = 1_000_000;

/** Price per month in the chosen cycle. */
export const perMonthCents = (plan: PlanTier, cycle: BillingCycle): number =>
  cycle === "annual" ? plan.annualMonthlyCents : plan.monthlyCents;

/** What the customer pays at once: the month, or twelve of them. */
export const chargeTotalCents = (plan: PlanTier, cycle: BillingCycle): number =>
  cycle === "annual" ? plan.annualMonthlyCents * 12 : plan.monthlyCents;

export interface NotesOption {
  /** null = no plan, avulso notes only. */
  planSlug: PlanSlug | null;
  avulsoUnits: number;
  totalCents: number;
}

/** Cheapest way to get N notes a month. Mirrors PricingService.recommendForNotes. */
export function recommendForNotes(notes: number, cycle: BillingCycle): { option: NotesOption; alternatives: NotesOption[] } | null {
  if (!Number.isInteger(notes) || notes < 1 || notes > MAX_CALCULATOR_NOTES) return null;
  const options: NotesOption[] = [
    { planSlug: null, avulsoUnits: notes, totalCents: notes * AVULSO_UNIT_CENTS },
    ...PLANS.map((plan) => {
      const avulsoUnits = Math.max(0, notes - plan.credits);
      return { planSlug: plan.slug, avulsoUnits, totalCents: perMonthCents(plan, cycle) + avulsoUnits * AVULSO_UNIT_CENTS };
    }),
  ].sort((a, b) => a.totalCents - b.totalCents);
  return { option: options[0], alternatives: options.slice(1, 4) };
}
