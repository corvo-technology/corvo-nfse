import { Injectable } from '@nestjs/common';
import { PlanSlug, PaidPlanSlug, BillingCycle } from '../domain/plan';
import {
  AVULSO_MIN_UNITS,
  AVULSO_UNIT_CENTS,
} from '@/modules/credits/domain/avulso';

export interface PriceQuote {
  slug: PlanSlug;
  name: string;
  monthlyAllowance: number;
  /** Full monthly price. */
  basePriceCents: number;
  /** Price per month in the chosen cycle (annual is discounted). */
  monthlyEquivalentCents: number;
  /** What the customer pays at once for the chosen cycle. */
  chargeTotalCents: number;
  currency: 'BRL';
}

type PricingEntry = {
  basePriceCents: number;
  annualMonthlyCents: number;
  name: string;
  allowance: number;
  maxCompanies: number;
  support: 'community' | 'email' | 'priority';
};

export interface NotesOption {
  /** null = no plan, avulso notes only. */
  planSlug: PaidPlanSlug | null;
  avulsoUnits: number;
  /** Cost per month in the chosen cycle. */
  totalCents: number;
}

export const MAX_RECOMMEND_NOTES = 1_000_000;

export const PAID_PLAN_SLUGS: PaidPlanSlug[] = [
  'solo',
  'equipe',
  'empresa',
  'escala',
];

@Injectable()
export class PricingService {
  private readonly PRICING: Record<PaidPlanSlug, PricingEntry> = {
    solo: {
      basePriceCents: 5990,
      annualMonthlyCents: 4190,
      name: 'Solo',
      allowance: 100,
      maxCompanies: 999999,
      support: 'email',
    },
    equipe: {
      basePriceCents: 11990,
      annualMonthlyCents: 8390,
      name: 'Equipe',
      allowance: 250,
      maxCompanies: 999999,
      support: 'email',
    },
    empresa: {
      basePriceCents: 23990,
      annualMonthlyCents: 16790,
      name: 'Empresa',
      allowance: 600,
      maxCompanies: 999999,
      support: 'priority',
    },
    escala: {
      basePriceCents: 39990,
      annualMonthlyCents: 27990,
      name: 'Escala',
      allowance: 1200,
      maxCompanies: 999999,
      support: 'priority',
    },
  };

  /** True for the four sellable plans; false for the no-plan placeholder and retired slugs. */
  isPaidPlan(slug: string): slug is PaidPlanSlug {
    return (PAID_PLAN_SLUGS as string[]).includes(slug);
  }

  /** Monthly price of a plan, or 0 when it is not sellable (no plan, or a retired plan). */
  monthlyPriceCents(slug: string): number {
    return this.isPaidPlan(slug) ? this.PRICING[slug].basePriceCents : 0;
  }

  calculateQuote(planSlug: PlanSlug, cycle: BillingCycle): PriceQuote {
    const entry = (this.PRICING as Record<string, PricingEntry | undefined>)[
      planSlug
    ];
    if (!entry) throw new Error(`Unknown plan: ${planSlug}`);
    if (cycle !== 'monthly' && cycle !== 'annual')
      throw new Error(`Unsupported billing cycle: ${String(cycle)}`);
    const monthlyEquivalent =
      cycle === 'annual' ? entry.annualMonthlyCents : entry.basePriceCents;
    return {
      slug: planSlug,
      name: entry.name,
      monthlyAllowance: entry.allowance,
      basePriceCents: entry.basePriceCents,
      monthlyEquivalentCents: monthlyEquivalent,
      chargeTotalCents:
        cycle === 'annual' ? monthlyEquivalent * 12 : monthlyEquivalent,
      currency: 'BRL',
    };
  }

  /** Cheapest way to get N notes a month: a plan, a plan plus avulso notes, or avulso only. */
  recommendForNotes(
    notesPerMonth: number,
    cycle: BillingCycle,
  ): { option: NotesOption; alternatives: NotesOption[] } {
    if (
      !Number.isInteger(notesPerMonth) ||
      notesPerMonth < 1 ||
      notesPerMonth > MAX_RECOMMEND_NOTES
    )
      throw new Error(
        `notes must be a whole number between 1 and ${MAX_RECOMMEND_NOTES}`,
      );
    // Avulso notes are sold in lots of at least AVULSO_MIN_UNITS.
    const buyable = (units: number) =>
      units === 0 ? 0 : Math.max(AVULSO_MIN_UNITS, units);
    const options: NotesOption[] = [
      {
        planSlug: null,
        avulsoUnits: buyable(notesPerMonth),
        totalCents: buyable(notesPerMonth) * AVULSO_UNIT_CENTS,
      },
      ...PAID_PLAN_SLUGS.map((slug) => {
        const quote = this.calculateQuote(slug, cycle);
        const avulsoUnits = buyable(
          Math.max(0, notesPerMonth - quote.monthlyAllowance),
        );
        return {
          planSlug: slug,
          avulsoUnits,
          totalCents:
            quote.monthlyEquivalentCents + avulsoUnits * AVULSO_UNIT_CENTS,
        };
      }),
    ].sort((a, b) => a.totalCents - b.totalCents);
    return { option: options[0], alternatives: options.slice(1, 4) };
  }

  listAllQuotes(cycle: BillingCycle): PriceQuote[] {
    return PAID_PLAN_SLUGS.map((slug) => this.calculateQuote(slug, cycle));
  }
}
