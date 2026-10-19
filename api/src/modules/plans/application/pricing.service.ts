import { Injectable } from '@nestjs/common';
import {
  BillingCycle,
  PLAN_SLUGS,
  PAID_PLAN_SLUGS,
  PlanSlug,
} from '../domain/plan';

export interface PriceQuote {
  slug: PlanSlug;
  name: string;
  monthlyAllowance: number;
  basePriceCents: number;
  perCreditOverageCents: number;
  monthlyTotalCents: number;
  currency: 'BRL';
  maxActiveCompanies: number;
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
    dev: {
      basePriceCents: 2990,
      perCreditCents: 12,
      name: 'Dev',
      allowance: 250,
      dailyLimit: null,
      maxCompanies: 25,
      support: 'email',
    },
    pro: {
      basePriceCents: 9990,
      perCreditCents: 8,
      name: 'Pro',
      allowance: 1500,
      dailyLimit: null,
      maxCompanies: 150,
      support: 'email',
    },
    escala: {
      basePriceCents: 29990,
      perCreditCents: 5,
      name: 'Escala',
      allowance: 6000,
      dailyLimit: null,
      maxCompanies: 500,
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
      maxActiveCompanies: entry.maxCompanies,
    };
  }

  recommendPlanForVolume(volume: number): {
    planSlug: PlanSlug;
    overageCredits: number;
    overageCostCents: number;
    totalEstimatedCents: number;
  } {
    // Free while it fits (Free never bills overage); otherwise the cheapest paid
    // plan at this volume, overage included. Mirrors the web plan picker.
    const totalAt = (slug: PlanSlug) =>
      this.PRICING[slug].basePriceCents +
      Math.max(0, volume - this.PRICING[slug].allowance) *
        this.PRICING[slug].perCreditCents;
    let chosen: PlanSlug = 'free';
    if (volume > this.PRICING.free.allowance) {
      chosen = PAID_PLAN_SLUGS[0];
      for (const slug of PAID_PLAN_SLUGS)
        if (totalAt(slug) < totalAt(chosen)) chosen = slug;
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
    return PLAN_SLUGS.map((slug) => this.calculateQuote(slug, cycle));
  }
}
