import {
  ForeignKey,
  Entity,
  Column,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('nfse_dps_sequences')
@ForeignKey('CompanyOrmEntity', ['companyId'], ['id'], {
  name: 'fk_nfse_dps_sequences_company',
  onDelete: 'CASCADE',
})
export class DpsSequenceOrmEntity {
  @PrimaryColumn({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @Column({ type: 'varchar', length: 10, default: '1' })
  series!: string;

  @Column({ name: 'current_number', type: 'bigint', default: 0 })
  currentNumber!: number;

  @Column({ name: 'numbering_checked_at', type: 'timestamptz', nullable: true })
  numberingCheckedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
