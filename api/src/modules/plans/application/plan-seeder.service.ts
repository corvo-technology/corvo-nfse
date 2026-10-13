import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { IPlanRepository } from '../domain/plan.repository';
import { CreatePlanInput, Plan, PlanSlug } from '../domain/plan';
import { Logger } from '@nestjs/common';

const SEED_DATA: Record<PlanSlug, CreatePlanInput> = {
  free: {
    slug: 'free',
    name: 'Free',
    description: 'Perfect for testing and small projects',
    monthlyCreditAllowance: 30,
    dailyLimit: 3,
    maxActiveCompanies: 1,
    creditUnitPriceCents: 0,
    throughputRps: 10,
    includesWebhooks: true,
    includesXmlDownload: true,
    includesPdfDownload: true,
    includesApiKeys: true,
    supportTier: 'community',
    active: true,
  },
  developer: {
    slug: 'developer',
    name: 'Developer',
    description: 'Ideal for developers and small teams',
    monthlyCreditAllowance: 200,
    dailyLimit: null,
    maxActiveCompanies: 10,
    creditUnitPriceCents: 15,
    throughputRps: 50,
    includesWebhooks: true,
    includesXmlDownload: true,
    includesPdfDownload: true,
    includesApiKeys: true,
    supportTier: 'email',
    active: true,
  },
  growth: {
    slug: 'growth',
    name: 'Growth',
    description: 'For growing businesses with higher volume needs',
    monthlyCreditAllowance: 750,
    dailyLimit: null,
    maxActiveCompanies: 50,
    creditUnitPriceCents: 12,
    throughputRps: 100,
    includesWebhooks: true,
    includesXmlDownload: true,
    includesPdfDownload: true,
    includesApiKeys: true,
    supportTier: 'email',
    active: true,
  },
  scale: {
    slug: 'scale',
    name: 'Scale',
    description: 'Enterprise-grade for high-volume operations',
    monthlyCreditAllowance: 2500,
    dailyLimit: null,
    maxActiveCompanies: 500,
    creditUnitPriceCents: 10,
    throughputRps: 200,
    includesWebhooks: true,
    includesXmlDownload: true,
    includesPdfDownload: true,
    includesApiKeys: true,
    supportTier: 'priority',
    active: true,
  },
  volume: {
    slug: 'volume',
    name: 'Volume',
    description: 'Maximum volume with best per-credit pricing',
    monthlyCreditAllowance: 10000,
    dailyLimit: null,
    maxActiveCompanies: 999999,
    creditUnitPriceCents: 9,
    throughputRps: 500,
    includesWebhooks: true,
    includesXmlDownload: true,
    includesPdfDownload: true,
    includesApiKeys: true,
    supportTier: 'priority',
    active: true,
  },
};

@Injectable()
export class PlanSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlanSeederService.name);

  constructor(private readonly planRepo: IPlanRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedIfMissing();
  }

  async seedIfMissing(): Promise<void> {
    this.logger.log('Seeding plans if missing...');

    const planSlugs = Object.keys(SEED_DATA) as PlanSlug[];

    for (const slug of planSlugs) {
      const existing = await this.planRepo.findBySlug(slug);
      if (existing) {
        this.logger.debug(`Plan '${slug}' already exists, skipping.`);
        continue;
      }

      const input = SEED_DATA[slug];
      const plan = await this.planRepo.save(Plan.create(input));
      this.logger.log(`Seeded plan: ${plan.slug} (${plan.name})`);
    }

    this.logger.log('Plan seeding complete.');
  }
}
