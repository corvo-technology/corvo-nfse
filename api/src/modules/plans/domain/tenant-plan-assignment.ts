import { Plan } from './plan';

// DI token for ITenantPlanRepository
export const TENANT_PLAN_REPOSITORY = 'TENANT_PLAN_REPOSITORY';

export interface TenantPlanProps {
  tenantId: string;
  plan: Plan;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  downgradeToPlanId: string | null;
  billingEmail: string | null;
  billingTaxId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class TenantPlanAssignment {
  private constructor(private readonly props: TenantPlanProps) {}

  static reconstitute(props: TenantPlanProps): TenantPlanAssignment {
    return new TenantPlanAssignment(props);
  }

  get tenantId(): string {
    return this.props.tenantId;
  }
  get plan(): Plan {
    return this.props.plan;
  }
  get currentPeriodStart(): Date {
    return this.props.currentPeriodStart;
  }
  get currentPeriodEnd(): Date {
    return this.props.currentPeriodEnd;
  }
  get downgradeToPlanId(): string | null {
    return this.props.downgradeToPlanId;
  }
  get billingEmail(): string | null {
    return this.props.billingEmail;
  }
  get billingTaxId(): string | null {
    return this.props.billingTaxId;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isPeriodExpired(now: Date = new Date()): boolean {
    return this.props.currentPeriodEnd < now;
  }

  hasScheduledDowngrade(): boolean {
    return this.props.downgradeToPlanId !== null;
  }

  toSnapshot(): TenantPlanProps {
    return { ...this.props };
  }
}

export interface ITenantPlanRepository {
  findByTenantId(tenantId: string): Promise<TenantPlanAssignment | null>;
  save(
    assignment: TenantPlanAssignment,
    tenantId: string,
  ): Promise<TenantPlanAssignment>;
  /** Links every tenant not yet on `planId` to it; returns how many moved. Instance-wide, system scope. */
  moveAllTenantsTo(planId: string): Promise<number>;
  updatePeriod(tenantId: string, start: Date, end: Date): Promise<void>;
  scheduleDowngrade(tenantId: string, newPlanId: string | null): Promise<void>;
  findExpiredAssignments(
    tenantId: string,
    now: Date,
  ): Promise<TenantPlanAssignment[]>;
  setBillingInfo(tenantId: string, email: string, taxId: string): Promise<void>;
  /** True when a tenant on the free plan already uses this billing e-mail. */
  existsFreeTenantWithBillingEmail(email: string): Promise<boolean>;
  /** True when a tenant on the free plan already uses this billing tax id. */
  existsFreeTenantWithBillingTaxId(taxId: string): Promise<boolean>;
}
