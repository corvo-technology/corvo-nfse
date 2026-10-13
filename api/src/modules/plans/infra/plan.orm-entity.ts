import { Index as ManagedIndex } from 'typeorm';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'plans' })
@Check(
  'ck_plans_support_tier',
  `"support_tier" IN ('community', 'email', 'priority')`,
)
@ManagedIndex('idx_plans_cursor', { synchronize: false })
export class PlanOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'slug', type: 'varchar', length: 20, unique: true })
  slug!: string;

  @Column({ name: 'name', type: 'varchar', length: 50 })
  name!: string;

  @Column({ name: 'description', type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'monthly_credit_allowance', type: 'int', default: 0 })
  monthlyCreditAllowance!: number;

  @Column({ name: 'daily_limit', type: 'int', nullable: true })
  dailyLimit!: number | null;

  @Column({ name: 'max_active_companies', type: 'int', default: 1 })
  maxActiveCompanies!: number;

  @Column({ name: 'credit_unit_price_cents', type: 'int', default: 0 })
  creditUnitPriceCents!: number;

  @Column({ name: 'throughput_rps', type: 'int', default: 10 })
  throughputRps!: number;

  @Column({ name: 'includes_webhooks', type: 'boolean', default: true })
  includesWebhooks!: boolean;

  @Column({ name: 'includes_xml_download', type: 'boolean', default: true })
  includesXmlDownload!: boolean;

  @Column({ name: 'includes_pdf_download', type: 'boolean', default: true })
  includesPdfDownload!: boolean;

  @Column({ name: 'includes_api_keys', type: 'boolean', default: true })
  includesApiKeys!: boolean;

  @Column({
    name: 'support_tier',
    type: 'varchar',
    length: 20,
    default: 'community',
  })
  supportTier!: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
