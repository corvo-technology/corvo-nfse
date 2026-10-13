import { Plan, PlanSlug } from '../domain/plan';
import { PlanOrmEntity } from './plan.orm-entity';

export class PlanMapper {
  toDomain(orm: PlanOrmEntity): Plan {
    return Plan.reconstitute({
      id: orm.id,
      slug: orm.slug as PlanSlug,
      name: orm.name,
      description: orm.description ?? '',
      monthlyCreditAllowance: orm.monthlyCreditAllowance,
      dailyLimit: orm.dailyLimit,
      maxActiveCompanies: orm.maxActiveCompanies,
      creditUnitPriceCents: orm.creditUnitPriceCents,
      throughputRps: orm.throughputRps,
      includesWebhooks: orm.includesWebhooks,
      includesXmlDownload: orm.includesXmlDownload,
      includesPdfDownload: orm.includesPdfDownload,
      includesApiKeys: orm.includesApiKeys,
      supportTier: orm.supportTier as 'community' | 'email' | 'priority',
      active: orm.active,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  toPersistence(domain: Plan): PlanOrmEntity {
    const orm = new PlanOrmEntity();
    orm.id = domain.id;
    orm.slug = domain.slug;
    orm.name = domain.name;
    orm.description = domain.description || null;
    orm.monthlyCreditAllowance = domain.monthlyCreditAllowance;
    orm.dailyLimit = domain.dailyLimit;
    orm.maxActiveCompanies = domain.maxActiveCompanies;
    orm.creditUnitPriceCents = domain.creditUnitPriceCents;
    orm.throughputRps = domain.throughputRps;
    orm.includesWebhooks = domain.includesWebhooks;
    orm.includesXmlDownload = domain.includesXmlDownload;
    orm.includesPdfDownload = domain.includesPdfDownload;
    orm.includesApiKeys = domain.includesApiKeys;
    orm.supportTier = domain.supportTier;
    orm.active = domain.active;
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.updatedAt;
    return orm;
  }
}
