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
      perCreditCents: 15,
      name: 'Developer',
      allowance: 200,
      dailyLimit: null,
      maxCompanies: 10,
      support: 'email',
    },
    growth: {
      basePriceCents: 8990,
      perCreditCents: 12,
      name: 'Growth',
      allowance: 750,
      dailyLimit: null,
      maxCompanies: 50,
      support: 'email',
    },
    scale: {
      basePriceCents: 24990,
      perCreditCents: 10,
      name: 'Scale',
      allowance: 2500,
      dailyLimit: null,
      maxCompanies: 500,
      support: 'priority',
    },
    volume: {
      basePriceCents: 89990,
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
    const tiers: PlanSlug[] = [
      'free',
      'developer',
      'growth',
      'scale',
      'volume',
    ];
    let chosen: PlanSlug = 'free';
    for (const slug of tiers) {
      if (this.PRICING[slug].allowance >= volume) {
        chosen = slug;
        break;
      }
      chosen = slug;
    }
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
