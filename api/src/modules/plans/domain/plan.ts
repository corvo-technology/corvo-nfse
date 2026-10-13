import { randomUUID } from 'crypto';

export type PlanSlug = 'free' | 'developer' | 'growth' | 'scale' | 'volume';

export type SupportTier = 'community' | 'email' | 'priority';
export type BillingCycle = 'monthly';

export interface PlanProps {
  id: string;
  slug: PlanSlug;
  name: string;
  description: string;
  monthlyCreditAllowance: number; // PRIMARY identifier
  dailyLimit: number | null;
  maxActiveCompanies: number;
  creditUnitPriceCents: number; // overage per credit
  throughputRps: number;
  includesWebhooks: boolean;
  includesXmlDownload: boolean;
  includesPdfDownload: boolean;
  includesApiKeys: boolean;
  supportTier: SupportTier;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePlanInput = Omit<PlanProps, 'id' | 'createdAt' | 'updatedAt'>;

export class Plan {
  private constructor(private readonly props: PlanProps) {}

  static create(input: CreatePlanInput): Plan {
    if (!input.slug) {
      throw new Error('Plan.slug is required');
    }
    if (input.monthlyCreditAllowance < 0) {
      throw new Error('Plan.monthlyCreditAllowance must be >= 0');
    }
    if (input.maxActiveCompanies < 0) {
      throw new Error('Plan.maxActiveCompanies must be >= 0');
    }
    if (input.throughputRps <= 0) {
      throw new Error('Plan.throughputRps must be positive');
    }
    if (input.creditUnitPriceCents < 0) {
      throw new Error('Plan.creditUnitPriceCents must be >= 0');
    }
    const now = new Date();
    return new Plan({
      id: randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: PlanProps): Plan {
    return new Plan(props);
  }

  get id(): string {
    return this.props.id;
  }
  get slug(): PlanSlug {
    return this.props.slug;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string {
    return this.props.description;
  }
  get monthlyCreditAllowance(): number {
    return this.props.monthlyCreditAllowance;
  }
  get dailyLimit(): number | null {
    return this.props.dailyLimit;
  }
  get maxActiveCompanies(): number {
    return this.props.maxActiveCompanies;
  }
  get creditUnitPriceCents(): number {
    return this.props.creditUnitPriceCents;
  }
  get throughputRps(): number {
    return this.props.throughputRps;
  }
  get includesWebhooks(): boolean {
    return this.props.includesWebhooks;
  }
  get includesXmlDownload(): boolean {
    return this.props.includesXmlDownload;
  }
  get includesPdfDownload(): boolean {
    return this.props.includesPdfDownload;
  }
  get includesApiKeys(): boolean {
    return this.props.includesApiKeys;
  }
  get supportTier(): SupportTier {
    return this.props.supportTier;
  }
  get active(): boolean {
    return this.props.active;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isFree(): boolean {
    return this.props.slug === 'free';
  }

  isUnlimitedCompanies(): boolean {
    return this.props.maxActiveCompanies >= 999999;
  }

  hasDailyLimit(): boolean {
    return this.props.dailyLimit !== null;
  }

  toPublicView(): {
    slug: PlanSlug;
    name: string;
    description: string;
    monthlyAllowance: number;
    dailyLimit: number | null;
    maxActiveCompanies: number;
    throughputRps: number;
    includesWebhooks: boolean;
    includesXmlDownload: boolean;
    includesPdfDownload: boolean;
    includesApiKeys: boolean;
    supportTier: SupportTier;
  } {
    return {
      slug: this.props.slug,
      name: this.props.name,
      description: this.props.description,
      monthlyAllowance: this.props.monthlyCreditAllowance,
      dailyLimit: this.props.dailyLimit,
      maxActiveCompanies: this.props.maxActiveCompanies,
      throughputRps: this.props.throughputRps,
      includesWebhooks: this.props.includesWebhooks,
      includesXmlDownload: this.props.includesXmlDownload,
      includesPdfDownload: this.props.includesPdfDownload,
      includesApiKeys: this.props.includesApiKeys,
      supportTier: this.props.supportTier,
    };
  }

  toSnapshot(): PlanProps {
    return { ...this.props };
  }
}
