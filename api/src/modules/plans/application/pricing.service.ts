import { Injectable } from '@nestjs/common';
import { PlanSlug, PaidPlanSlug, BillingCycle } from '../domain/plan';

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

  listAllQuotes(cycle: BillingCycle): PriceQuote[] {
    return PAID_PLAN_SLUGS.map((slug) => this.calculateQuote(slug, cycle));
  }
}
