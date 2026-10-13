import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IPlanRepository } from '../domain/plan.repository';
import { Plan } from '../domain/plan';
import { PlanMapper } from './plan.mapper';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { PlanOrmEntity } from './plan.orm-entity';

@Injectable()
export class TypeOrmPlanRepository implements IPlanRepository {
  private readonly mapper = new PlanMapper();

  async listPage(options: CursorQuery): Promise<CursorPage<Plan>> {
    return queryCursorPage(
      this.repo.createQueryBuilder('plan'),
      options,
      ['credit-plans'],
      (entity) => this.mapper.toDomain(entity),
      { column: 'monthlyCreditAllowance', numeric: true, direction: 'ASC' },
    );
  }

  constructor(
    @InjectRepository(PlanOrmEntity)
    private readonly repo: Repository<PlanOrmEntity>,
    @InjectRepository(TenantOrmEntity)
    private readonly tenants: Repository<TenantOrmEntity>,
  ) {}

  async findAll(): Promise<Plan[]> {
    const entities = await this.repo.find({
      order: { monthlyCreditAllowance: 'ASC' },
    });
    return entities.map((e) => this.mapper.toDomain(e));
  }

  async findById(id: string): Promise<Plan | null> {
    const entity = await this.repo.findOne({ where: { id } });
    return entity ? this.mapper.toDomain(entity) : null;
  }

  async findBySlug(slug: string): Promise<Plan | null> {
    const entity = await this.repo.findOne({ where: { slug } });
    return entity ? this.mapper.toDomain(entity) : null;
  }

  async findActiveByTenantId(tenantId: string): Promise<Plan | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const tenant = await this.tenants.findOne({
        where: { id: tenantId },
        select: { id: true, planId: true },
      });
      // Tenants without an assigned plan fall back to 'free'.
      const entity = tenant?.planId
        ? await this.repo.findOne({ where: { id: tenant.planId } })
        : await this.repo.findOne({ where: { slug: 'free' } });
      return entity ? this.mapper.toDomain(entity) : null;
    });
  }

  async save(plan: Plan): Promise<Plan> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .values(this.mapper.toPersistence(plan))
      .onConflict('("slug") DO NOTHING')
      .execute();
    const saved = await this.repo.findOneByOrFail({ slug: plan.slug });
    return this.mapper.toDomain(saved);
  }
}
