import { Plan } from './plan';

// Define TenantPlanAssignment for testing purposes
// This mirrors the expected interface from the Phase 9 plan

export type TenantPlanProps = {
  tenantId: string;
  plan: Plan;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  downgradeToPlanId: string | null;
  billingEmail: string | null;
  billingTaxId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

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

  isPeriodExpired(): boolean {
    return new Date() > this.props.currentPeriodEnd;
  }

  hasScheduledDowngrade(): boolean {
    return this.props.downgradeToPlanId !== null;
  }

  toSnapshot(): TenantPlanProps {
    return { ...this.props };
  }
}

describe('TenantPlanAssignment', () => {
  const createPlan = (
    overrides: Partial<{
      id: string;
      slug: string;
      name: string;
      monthlyCreditAllowance: number;
      dailyLimit: number | null;
      maxActiveCompanies: number;
    }> = {},
  ) =>
    Plan.create({
      slug: 'developer' as const,
      name: 'Starter',
      description: '',
      monthlyCreditAllowance: 200,
      dailyLimit: null,
      maxActiveCompanies: 3,
      creditUnitPriceCents: 15,
      throughputRps: 10,
      includesWebhooks: true,
      includesXmlDownload: true,
      includesPdfDownload: true,
      includesApiKeys: true,
      supportTier: 'email',
      active: true,
      ...overrides,
    });

  const baseProps: TenantPlanProps = {
    tenantId: 'tenant-1',
    plan: createPlan(),
    currentPeriodStart: new Date('2026-10-01'),
    currentPeriodEnd: new Date('2026-10-31'),
    downgradeToPlanId: null,
    billingEmail: null,
    billingTaxId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('reconstitute', () => {
    it('creates with given properties', () => {
      const a = TenantPlanAssignment.reconstitute(baseProps);
      expect(a.tenantId).toBe('tenant-1');
      expect(a.plan.slug).toBe('developer');
    });

    it('preserves all properties', () => {
      const a = TenantPlanAssignment.reconstitute(baseProps);
      expect(a.currentPeriodStart).toEqual(new Date('2026-10-01'));
      expect(a.currentPeriodEnd).toEqual(new Date('2026-10-31'));
      expect(a.billingEmail).toBeNull();
      expect(a.billingTaxId).toBeNull();
    });
  });

  describe('isPeriodExpired', () => {
    it('returns true when end is in past', () => {
      const past = {
        ...baseProps,
        currentPeriodEnd: new Date('2020-01-01'),
      };
      expect(TenantPlanAssignment.reconstitute(past).isPeriodExpired()).toBe(
        true,
      );
    });

    it('returns false when end is in future', () => {
      const future = {
        ...baseProps,
        currentPeriodEnd: new Date('2099-12-31'),
      };
      expect(TenantPlanAssignment.reconstitute(future).isPeriodExpired()).toBe(
        false,
      );
    });

    it('returns false when end is today', () => {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const sameDay = {
        ...baseProps,
        currentPeriodEnd: today,
      };
      expect(TenantPlanAssignment.reconstitute(sameDay).isPeriodExpired()).toBe(
        false,
      );
    });
  });

  describe('hasScheduledDowngrade', () => {
    it('returns false when downgradeToPlanId is null', () => {
      const noDown = TenantPlanAssignment.reconstitute(baseProps);
      expect(noDown.hasScheduledDowngrade()).toBe(false);
    });

    it('returns true when downgradeToPlanId is set', () => {
      const withDown = TenantPlanAssignment.reconstitute({
        ...baseProps,
        downgradeToPlanId: 'plan-2',
      });
      expect(withDown.hasScheduledDowngrade()).toBe(true);
    });
  });

  describe('plan access', () => {
    it('exposes plan properties', () => {
      const a = TenantPlanAssignment.reconstitute(baseProps);
      expect(a.plan.monthlyCreditAllowance).toBe(200);
      expect(a.plan.maxActiveCompanies).toBe(3);
      expect(a.plan.isFree()).toBe(false);
    });

    it('returns free plan correctly', () => {
      const freeProps = {
        ...baseProps,
        plan: createPlan({
          slug: 'free',
          monthlyCreditAllowance: 30,
          maxActiveCompanies: 1,
        }),
      };
      const a = TenantPlanAssignment.reconstitute(freeProps);
      expect(a.plan.isFree()).toBe(true);
      expect(a.plan.monthlyCreditAllowance).toBe(30);
    });
  });

  describe('billing info', () => {
    it('stores billing email when provided', () => {
      const withEmail = TenantPlanAssignment.reconstitute({
        ...baseProps,
        billingEmail: 'billing@example.com',
      });
      expect(withEmail.billingEmail).toBe('billing@example.com');
    });

    it('stores billing tax ID when provided', () => {
      const withTaxId = TenantPlanAssignment.reconstitute({
        ...baseProps,
        billingTaxId: '12345678000195',
      });
      expect(withTaxId.billingTaxId).toBe('12345678000195');
    });
  });

  describe('toSnapshot', () => {
    it('returns a copy of props', () => {
      const a = TenantPlanAssignment.reconstitute(baseProps);
      const snapshot = a.toSnapshot();

      expect(snapshot.tenantId).toBe('tenant-1');
      expect(snapshot.plan).toBe(baseProps.plan);
      expect(snapshot.currentPeriodStart).toEqual(new Date('2026-10-01'));
    });

    it('returns a copy, not the original', () => {
      const a = TenantPlanAssignment.reconstitute(baseProps);
      const snapshot = a.toSnapshot();
      snapshot.tenantId = 'modified';

      expect(a.tenantId).toBe('tenant-1');
    });
  });
});
