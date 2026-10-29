import { Injectable } from '@nestjs/common';
import { PlanSlug, BillingCycle } from '../domain/plan';

export interface PriceQuote {
  slug: PlanSlug;
  name: string;
  monthlyAllowance: number;
  basePriceCents: number;
  perCreditOverageCents: number;
  monthlyTotalCents: number;
  currency: 'BRL';
}

type PricingEntry = {
  basePriceCents: number;
  perCreditCents: number;
  name: string;
  allowance: number;
  dailyLimit: number | null;
  maxCompanies: number;
  support: 'community' | 'email' | 'priority';
};

@Injectable()
export class PricingService {
  private readonly PRICING: Record<PlanSlug, PricingEntry> = {
    free: {
      basePriceCents: 0,
      perCreditCents: 0,
      name: 'Free',
      allowance: 15,
      dailyLimit: 3,
      maxCompanies: 1,
      support: 'community',
    },
    developer: {
      basePriceCents: 2990,
      perCreditCents: 18,
      name: 'Developer',
      allowance: 200,
      dailyLimit: null,
      maxCompanies: 999999,
      support: 'email',
    },
    growth: {
      basePriceCents: 9990,
      perCreditCents: 14,
      name: 'Growth',
      allowance: 850,
      dailyLimit: null,
      maxCompanies: 999999,
      support: 'email',
    },
    scale: {
      basePriceCents: 29990,
      perCreditCents: 12,
      name: 'Scale',
      allowance: 3000,
      dailyLimit: null,
      maxCompanies: 999999,
      support: 'priority',
    },
    volume: {
      basePriceCents: 69990,
      perCreditCents: 9,
      name: 'Volume',
      allowance: 10000,
      dailyLimit: null,
      maxCompanies: 999999,
      support: 'priority',
    },
  };

  calculateQuote(
    planSlug: PlanSlug,
    cycle: BillingCycle = 'monthly',
  ): PriceQuote {
    if (cycle !== 'monthly')
      throw new Error('Only monthly billing is supported');
    const entry = this.PRICING[planSlug];
    if (!entry) throw new Error(`Unknown plan: ${planSlug}`);
    const monthly = entry.basePriceCents;
    return {
      slug: planSlug,
      name: entry.name,
      monthlyAllowance: entry.allowance,
      basePriceCents: monthly,
      perCreditOverageCents: entry.perCreditCents,
      monthlyTotalCents: monthly,
      currency: 'BRL',
    };
  }

  recommendPlanForVolume(volume: number): {
    planSlug: PlanSlug;
    overageCredits: number;
    overageCostCents: number;
    totalEstimatedCents: number;
  } {
    if (volume <= this.PRICING.free.allowance) {
      return {
        planSlug: 'free',
        overageCredits: 0,
        overageCostCents: 0,
        totalEstimatedCents: 0,
      };
    }
    const paidTiers: PlanSlug[] = ['developer', 'growth', 'scale', 'volume'];
    const chosen = paidTiers.reduce((best, candidate) => {
      const bestEntry = this.PRICING[best];
      const candidateEntry = this.PRICING[candidate];
      const total = (entry: PricingEntry) =>
        entry.basePriceCents +
        Math.max(0, volume - entry.allowance) * entry.perCreditCents;
      return total(candidateEntry) < total(bestEntry) ? candidate : best;
    });
    const allowance = this.PRICING[chosen].allowance;
    const overage = Math.max(0, volume - allowance);
    const overageCost = overage * this.PRICING[chosen].perCreditCents;
    const total = this.PRICING[chosen].basePriceCents + overageCost;
    return {
      planSlug: chosen,
      overageCredits: overage,
      overageCostCents: overageCost,
      totalEstimatedCents: total,
    };
  }

  listAllQuotes(cycle: BillingCycle): PriceQuote[] {
    return (
      ['free', 'developer', 'growth', 'scale', 'volume'] as PlanSlug[]
    ).map((slug) => this.calculateQuote(slug, cycle));
  }
}
