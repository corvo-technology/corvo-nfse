import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import type { PixCheckout } from '../domain/payment-intent';

@Entity({ name: 'payment_intents' })
@Index('uq_payment_intents_provider_ref', ['provider', 'providerRef'], {
  unique: true,
})
@Index('uq_payment_intents_tenant_key', ['tenantId', 'idempotencyKey'], {
  unique: true,
  where: 'idempotency_key IS NOT NULL',
})
export class PaymentIntentOrmEntity {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ type: 'varchar', length: 10 }) kind!: string;
  @Column({ name: 'plan_slug', type: 'varchar', nullable: true })
  planSlug!: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) cycle!:
    string | null;
  @Column({ type: 'integer', nullable: true }) units!: number | null;
  @Column({ name: 'amount_cents', type: 'integer' }) amountCents!: number;
  @Column({ type: 'varchar', length: 10 }) provider!: string;
  @Column({ name: 'provider_ref', type: 'varchar', length: 100 })
  providerRef!: string;
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  idempotencyKey!: string | null;
  @Column({ type: 'varchar', length: 12 }) status!: string;
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;
  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;
  @Column({ type: 'jsonb', nullable: true }) checkout!: PixCheckout | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
