import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { Plan } from './plan';

export abstract class IPlanRepository {
  abstract listPage(options: CursorQuery): Promise<CursorPage<Plan>>;
  abstract findAll(): Promise<Plan[]>;
  abstract findById(id: string): Promise<Plan | null>;
  abstract findBySlug(slug: string): Promise<Plan | null>;
  /**
   * Resolves the active plan for the given tenant. Falls back to the
   * 'free' plan if the tenant has none assigned.
   */
  abstract findActiveByTenantId(tenantId: string): Promise<Plan | null>;
  abstract save(plan: Plan): Promise<Plan>;
}
