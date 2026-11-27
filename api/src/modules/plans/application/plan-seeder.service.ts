import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { IPlanRepository } from '../domain/plan.repository';
import { CreatePlanInput, Plan, PlanSlug } from '../domain/plan';
import { Logger } from '@nestjs/common';

/** `self-hosted` is created by a migration, never seeded: cloud has no such plan to show. */
const SEED_DATA: Record<Exclude<PlanSlug, 'self-hosted'>, CreatePlanInput> = {
  free: {
    slug: 'free',
    name: 'Sem plano',
    description:
      'Sem plano ativo: 5 notas grátis para conta nova e notas avulsas',
    monthlyCreditAllowance: 0,
    dailyLimit: null,
    // Avulso only: one company. Every recurring plan allows unlimited companies.
    maxActiveCompanies: 1,
    creditUnitPriceCents: 99,
    throughputRps: 10,
    includesWebhooks: true,
    includesXmlDownload: true,
    includesPdfDownload: true,
    includesApiKeys: true,
    supportTier: 'community',
    active: true,
  },
  solo: {
    slug: 'solo',
    name: 'Solo',
    description: 'Para quem emite poucas notas por mês',
    monthlyCreditAllowance: 100,
    dailyLimit: null,
    maxActiveCompanies: 999999,
    creditUnitPriceCents: 99,
    throughputRps: 50,
    includesWebhooks: true,
    includesXmlDownload: true,
    includesPdfDownload: true,
    includesApiKeys: true,
    supportTier: 'email',
    active: true,
  },
  equipe: {
    slug: 'equipe',
    name: 'Equipe',
    description: 'Para equipes que emitem com frequência',
    monthlyCreditAllowance: 250,
    dailyLimit: null,
    maxActiveCompanies: 999999,
    creditUnitPriceCents: 99,
    throughputRps: 100,
    includesWebhooks: true,
    includesXmlDownload: true,
    includesPdfDownload: true,
    includesApiKeys: true,
    supportTier: 'email',
    active: true,
  },
  empresa: {
    slug: 'empresa',
    name: 'Empresa',
    description: 'Para empresas com volume recorrente',
    monthlyCreditAllowance: 600,
    dailyLimit: null,
    maxActiveCompanies: 999999,
    creditUnitPriceCents: 99,
    throughputRps: 200,
    includesWebhooks: true,
    includesXmlDownload: true,
    includesPdfDownload: true,
    includesApiKeys: true,
    supportTier: 'priority',
    active: true,
  },
  escala: {
    slug: 'escala',
    name: 'Escala',
    description: 'Para alto volume de emissão',
    monthlyCreditAllowance: 1200,
    dailyLimit: null,
    maxActiveCompanies: 999999,
    creditUnitPriceCents: 99,
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

    const planSlugs = Object.keys(SEED_DATA) as Array<keyof typeof SEED_DATA>;

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
