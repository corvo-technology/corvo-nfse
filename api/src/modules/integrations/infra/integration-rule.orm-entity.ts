import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('integration_rules')
export class IntegrationRuleOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'connection_id', type: 'uuid' }) connectionId!: string;
  @Column({
    name: 'external_product_id',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  externalProductId!: string | null;
  @Column({ type: 'jsonb' }) service!: Record<string, unknown>;
  @Column({ name: 'send_email', type: 'boolean' }) sendEmail!: boolean;
  @Column({ name: 'allow_anonymous_customer', type: 'boolean' })
  allowAnonymousCustomer!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
