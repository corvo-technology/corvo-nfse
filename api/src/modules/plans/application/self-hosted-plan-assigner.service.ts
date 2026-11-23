import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { IPlanRepository } from '../domain/plan.repository';
import {
  TENANT_PLAN_REPOSITORY,
  type ITenantPlanRepository,
} from '../domain/tenant-plan-assignment';

export const SELF_HOSTED_PLAN_SLUG = 'self-hosted';

/**
 * Registered only in `self_hosted`. Moving an instance from `cloud` to `self_hosted` leaves
 * tenants on Free or a paid plan; on startup they are all linked to the `self-hosted` plan.
 * The way back is not supported.
 */
@Injectable()
export class SelfHostedPlanAssigner implements OnApplicationBootstrap {
  private readonly logger = new Logger(SelfHostedPlanAssigner.name);

  constructor(
    private readonly plans: IPlanRepository,
    @Inject(TENANT_PLAN_REPOSITORY)
    private readonly tenantPlans: ITenantPlanRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.reassignTenants();
  }

  async reassignTenants(): Promise<number> {
    const plan = await this.plans.findBySlug(SELF_HOSTED_PLAN_SLUG);
    if (!plan)
      throw new Error(
        `Plan '${SELF_HOSTED_PLAN_SLUG}' is missing: run the database migrations`,
      );
    const moved = await this.tenantPlans.moveAllTenantsTo(plan.id);
    if (moved > 0)
      this.logger.log(`Moved ${moved} tenant(s) to the self-hosted plan`);
    return moved;
  }
}
