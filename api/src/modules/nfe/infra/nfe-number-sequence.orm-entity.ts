import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Mirrors `nfe_number_sequences`: the last number used per (company, model, series). */
@Entity('nfe_number_sequences')
export class NfeNumberSequenceOrmEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @PrimaryColumn({ type: 'smallint' })
  model!: number;

  @PrimaryColumn({ type: 'integer' })
  series!: number;

  @Column({ name: 'current_number', type: 'integer', default: 0 })
  currentNumber!: number;
}
