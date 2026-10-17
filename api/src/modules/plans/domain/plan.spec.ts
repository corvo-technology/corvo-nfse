import { Plan, PlanSlug } from './plan';

describe('Plan', () => {
  describe('create', () => {
    it('creates a plan with valid input', () => {
      const input = {
        slug: 'developer' as PlanSlug,
        name: 'Starter',
        description: 'For small businesses',
        monthlyCreditAllowance: 200,
        dailyLimit: null,
        maxActiveCompanies: 3,
        creditUnitPriceCents: 15,
        throughputRps: 10,
        includesWebhooks: true,
        includesXmlDownload: true,
        includesPdfDownload: true,
        includesApiKeys: true,
        supportTier: 'email' as const,
        active: true,
      };

      const plan = Plan.create(input);

      expect(plan.slug).toBe('developer');
      expect(plan.name).toBe('Starter');
      expect(plan.monthlyCreditAllowance).toBe(200);
      expect(plan.maxActiveCompanies).toBe(3);
      expect(plan.active).toBe(true);
      expect(plan.id).toBeDefined();
      expect(plan.createdAt).toBeInstanceOf(Date);
    });

    it('creates a free plan with minimal values', () => {
      const input = {
        slug: 'free' as PlanSlug,
        name: 'Free',
        description: 'No cost plan',
        monthlyCreditAllowance: 15,
        dailyLimit: 3,
        maxActiveCompanies: 1,
        creditUnitPriceCents: 0,
        throughputRps: 1,
        includesWebhooks: false,
        includesXmlDownload: false,
        includesPdfDownload: false,
        includesApiKeys: true,
        supportTier: 'community' as const,
        active: true,
      };

      const plan = Plan.create(input);

      expect(plan.slug).toBe('free');
      expect(plan.monthlyCreditAllowance).toBe(15);
      expect(plan.dailyLimit).toBe(3);
      expect(plan.maxActiveCompanies).toBe(1);
    });

    it('throws when slug is missing', () => {
      const input = {
        slug: '' as PlanSlug,
        name: 'Test',
        description: '',
        monthlyCreditAllowance: 100,
        dailyLimit: null,
        maxActiveCompanies: 1,
        creditUnitPriceCents: 10,
        throughputRps: 5,
        includesWebhooks: true,
        includesXmlDownload: true,
        includesPdfDownload: true,
        includesApiKeys: true,
        supportTier: 'email' as const,
        active: true,
      };

      expect(() => Plan.create(input)).toThrow('Plan.slug is required');
    });

    it('throws when monthlyCreditAllowance is negative', () => {
      const input = {
        slug: 'developer' as PlanSlug,
        name: 'Starter',
        description: '',
        monthlyCreditAllowance: -1,
        dailyLimit: null,
        maxActiveCompanies: 3,
        creditUnitPriceCents: 15,
        throughputRps: 10,
        includesWebhooks: true,
        includesXmlDownload: true,
        includesPdfDownload: true,
        includesApiKeys: true,
        supportTier: 'email' as const,
        active: true,
      };

      expect(() => Plan.create(input)).toThrow();
    });

    it('throws when maxActiveCompanies is negative', () => {
      const input = {
        slug: 'developer' as PlanSlug,
        name: 'Starter',
        description: '',
        monthlyCreditAllowance: 200,
        dailyLimit: null,
        maxActiveCompanies: -1,
        creditUnitPriceCents: 15,
        throughputRps: 10,
        includesWebhooks: true,
        includesXmlDownload: true,
        includesPdfDownload: true,
        includesApiKeys: true,
        supportTier: 'email' as const,
        active: true,
      };

      expect(() => Plan.create(input)).toThrow();
    });

    it('throws when creditUnitPriceCents is negative', () => {
      const input = {
        slug: 'developer' as PlanSlug,
        name: 'Starter',
        description: '',
        monthlyCreditAllowance: 200,
        dailyLimit: null,
        maxActiveCompanies: 3,
        creditUnitPriceCents: -5,
        throughputRps: 10,
        includesWebhooks: true,
        includesXmlDownload: true,
        includesPdfDownload: true,
        includesApiKeys: true,
        supportTier: 'email' as const,
        active: true,
      };

      expect(() => Plan.create(input)).toThrow(
        'Plan.creditUnitPriceCents must be >= 0',
      );
    });

    it('allows zero creditUnitPriceCents for free plan', () => {
      const input = {
        slug: 'free' as PlanSlug,
        name: 'Free',
        description: '',
        monthlyCreditAllowance: 15,
        dailyLimit: 3,
        maxActiveCompanies: 1,
        creditUnitPriceCents: 0,
        throughputRps: 1,
        includesWebhooks: false,
        includesXmlDownload: false,
        includesPdfDownload: false,
        includesApiKeys: true,
        supportTier: 'community' as const,
        active: true,
      };

      const plan = Plan.create(input);
      expect(plan.creditUnitPriceCents).toBe(0);
    });

    it('throws when throughputRps is not positive', () => {
      const input = {
        slug: 'developer' as PlanSlug,
        name: 'Starter',
        description: '',
        monthlyCreditAllowance: 200,
        dailyLimit: null,
        maxActiveCompanies: 3,
        creditUnitPriceCents: 15,
        throughputRps: 0,
        includesWebhooks: true,
        includesXmlDownload: true,
        includesPdfDownload: true,
        includesApiKeys: true,
        supportTier: 'email' as const,
        active: true,
      };

      expect(() => Plan.create(input)).toThrow(
        'Plan.throughputRps must be positive',
      );
    });
  });

  describe('isFree', () => {
    it('returns true only for free slug', () => {
      const freePlan = Plan.create({
        slug: 'free',
        name: 'Free',
        description: '',
        monthlyCreditAllowance: 15,
        dailyLimit: 3,
        maxActiveCompanies: 1,
        creditUnitPriceCents: 0,
        throughputRps: 1,
        includesWebhooks: false,
        includesXmlDownload: false,
        includesPdfDownload: false,
        includesApiKeys: true,
        supportTier: 'community',
        active: true,
      });

      const developerPlan = Plan.create({
        slug: 'developer',
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
      });

      expect(freePlan.isFree()).toBe(true);
      expect(developerPlan.isFree()).toBe(false);
    });
  });

  describe('isUnlimitedCompanies', () => {
    it('returns true when maxActiveCompanies is high (unlimited marker)', () => {
      const unlimitedPlan = Plan.create({
        slug: 'volume',
        name: 'Volume',
        description: '',
        monthlyCreditAllowance: 10000,
        dailyLimit: null,
        maxActiveCompanies: 999999,
        creditUnitPriceCents: 9,
        throughputRps: 50,
        includesWebhooks: true,
        includesXmlDownload: true,
        includesPdfDownload: true,
        includesApiKeys: true,
        supportTier: 'priority',
        active: true,
      });

      const limitedPlan = Plan.create({
        slug: 'developer',
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
      });

      expect(unlimitedPlan.isUnlimitedCompanies()).toBe(true);
      expect(limitedPlan.isUnlimitedCompanies()).toBe(false);
    });
  });

  describe('hasDailyLimit', () => {
    it('returns true only when dailyLimit is set', () => {
      const freePlan = Plan.create({
        slug: 'free',
        name: 'Free',
        description: '',
        monthlyCreditAllowance: 15,
        dailyLimit: 3,
        maxActiveCompanies: 1,
        creditUnitPriceCents: 0,
        throughputRps: 1,
        includesWebhooks: false,
        includesXmlDownload: false,
        includesPdfDownload: false,
        includesApiKeys: true,
        supportTier: 'community',
        active: true,
      });

      const paidPlan = Plan.create({
        slug: 'developer',
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
      });

      expect(freePlan.hasDailyLimit()).toBe(true);
      expect(paidPlan.hasDailyLimit()).toBe(false);
    });
  });

  describe('toPublicView', () => {
    it('returns public view without internal fields', () => {
      const plan = Plan.create({
        slug: 'developer',
        name: 'Starter',
        description: 'For small businesses',
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
      });

      const view = plan.toPublicView();

      expect(view.slug).toBe('developer');
      expect(view.name).toBe('Starter');
      expect(view.description).toBe('For small businesses');
      expect(view.monthlyAllowance).toBe(200);
      expect(view.dailyLimit).toBe(null);
      expect(view.maxActiveCompanies).toBe(3);
      expect(view).not.toHaveProperty('id');
      expect(view).not.toHaveProperty('creditUnitPriceCents');
      expect(view).not.toHaveProperty('createdAt');
      expect(view).not.toHaveProperty('updatedAt');
    });

    it('returns a copy, not the original props', () => {
      const plan = Plan.create({
        slug: 'developer',
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
      });

      const view = plan.toPublicView();
      view.name = 'Modified';

      expect(plan.name).toBe('Starter');
    });
  });

  describe('reconstitute', () => {
    it('reconstitutes from props without validation', () => {
      const props = {
        id: 'plan-id-123',
        slug: 'scale' as PlanSlug,
        name: 'Scale',
        description: 'For growing businesses',
        monthlyCreditAllowance: 2500,
        dailyLimit: null,
        maxActiveCompanies: 500,
        creditUnitPriceCents: 10,
        throughputRps: 25,
        includesWebhooks: true,
        includesXmlDownload: true,
        includesPdfDownload: true,
        includesApiKeys: true,
        supportTier: 'priority' as const,
        active: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };

      const plan = Plan.reconstitute(props);

      expect(plan.id).toBe('plan-id-123');
      expect(plan.slug).toBe('scale');
      expect(plan.name).toBe('Scale');
      expect(plan.monthlyCreditAllowance).toBe(2500);
      expect(plan.maxActiveCompanies).toBe(500);
    });
  });

  describe('toSnapshot', () => {
    it('returns all props', () => {
      const plan = Plan.create({
        slug: 'growth',
        name: 'Growth',
        description: 'For medium businesses',
        monthlyCreditAllowance: 750,
        dailyLimit: null,
        maxActiveCompanies: 50,
        creditUnitPriceCents: 12,
        throughputRps: 15,
        includesWebhooks: true,
        includesXmlDownload: true,
        includesPdfDownload: true,
        includesApiKeys: true,
        supportTier: 'email',
        active: true,
      });

      const snapshot = plan.toSnapshot();

      expect(snapshot.id).toBe(plan.id);
      expect(snapshot.slug).toBe('growth');
      expect(snapshot.name).toBe('Growth');
      expect(snapshot.monthlyCreditAllowance).toBe(750);
      expect(snapshot.maxActiveCompanies).toBe(50);
      expect(snapshot.active).toBe(true);
    });
  });
});
