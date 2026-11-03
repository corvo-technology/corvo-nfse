import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { IPlanRepository } from '../domain/plan.repository';
import { CreatePlanInput, Plan, PlanSlug } from '../domain/plan';
import { Logger } from '@nestjs/common';

const SEED_DATA: Record<PlanSlug, CreatePlanInput> = {
  free: {
    slug: 'free',
    name: 'Free',
    description: 'Perfect for testing and small projects',
    monthlyCreditAllowance: 5,
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
    description: 'Para começar a emitir NFS-e em qualquer número de empresas',
    monthlyCreditAllowance: 200,
    dailyLimit: null,
    maxActiveCompanies: 999999,
    creditUnitPriceCents: 18,
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
    description: 'Para operações em crescimento com empresas ilimitadas',
    monthlyCreditAllowance: 850,
    dailyLimit: null,
    maxActiveCompanies: 999999,
    creditUnitPriceCents: 14,
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
    description: 'Para operações de alto volume com empresas ilimitadas',
    monthlyCreditAllowance: 3000,
    dailyLimit: null,
    maxActiveCompanies: 999999,
    creditUnitPriceCents: 12,
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
    description: 'Para o maior volume, com empresas ilimitadas',
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
